// KPI 계산 — 분자·분모를 같은 원천·같은 범위의 한 SQL 로 집계하고 비율·직전 기간 증감을 코드로 산출
import "server-only";
import type { Account } from "@/lib/accounts";
import { KPIS, METRIC_SOURCES, type KpiDef, type MetricSource } from "@/lib/catalog";
import { roQuery } from "@/lib/db";
import { QueryParamError, codeParam, dateParam, periodParams, queryIdOf } from "@/lib/queries/registry";

const DATE_DIMS = ["day", "week", "month"] as const;
const DAY_MS = 86_400_000;

// 모든 원천의 필터 키 합집합 — tool 입력 스키마와 검증 공용
export const FILTER_KEYS = [...new Set(Object.values(METRIC_SOURCES).flatMap((s) => Object.keys(s.filters)))];

type Period = { from: string; to: string };
type Ratio = { numerator: number; denominator: number; value: number | null };
type Filter = { key: string; expr: string; value: string };

// 계정 조회 범위 안의 원천을 쓰는 KPI
export const allowedKpis = (a: Account) => KPIS.filter((k) => METRIC_SOURCES[k.source].tables.every((t) => a.allowedTables.includes(t)));

export const formulaOf = (k: KpiDef) => {
  const wrap = (label: string) => (/[+\-]/.test(label) ? `(${label})` : label);
  return `${wrap(k.numerator.label)} ÷ ${wrap(k.denominator.label)} × ${k.scale.toLocaleString("en-US")}`;
};

const dayOf = (src: MetricSource) => (src.date.type === "date" ? src.date.expr : `DATE(${src.date.expr})`);

function groupExpr(src: MetricSource, dim: string): string {
  const d = dayOf(src);
  if (dim === "day") return d;
  if (dim === "week") return `DATE_SUB(${d}, INTERVAL WEEKDAY(${d}) DAY)`;
  if (dim === "month") return `DATE_FORMAT(${d}, '%Y-%m')`;
  return src.dimensions[dim];
}

const periodWhere = (src: MetricSource) =>
  src.date.type === "date" ? `${src.date.expr} BETWEEN ? AND ?` : `${src.date.expr} >= ? AND ${src.date.expr} < DATE_ADD(?, INTERVAL 1 DAY)`;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// 직전 비교 기간 — 달력 월 단위 기간(1일~말일)은 직전 같은 개월 수, 그 밖은 직전 같은 일수
function previousPeriod({ from, to }: Period): Period {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  const fd = new Date(f);
  const td = new Date(t);
  if (fd.getUTCDate() === 1 && new Date(t + DAY_MS).getUTCDate() === 1) {
    const months = (td.getUTCFullYear() - fd.getUTCFullYear()) * 12 + td.getUTCMonth() - fd.getUTCMonth() + 1;
    return { from: iso(Date.UTC(fd.getUTCFullYear(), fd.getUTCMonth() - months, 1)), to: iso(f - DAY_MS) };
  }
  return { from: iso(f - (t - f + DAY_MS)), to: iso(f - DAY_MS) };
}

// 부호 대칭 반올림 — 음수 증감도 절댓값 기준으로 반올림
const roundTo = (v: number, d: number) => {
  const k = 10 ** d;
  return (Math.sign(v) * Math.round(Math.abs(v) * k)) / k;
};

function ratio(k: KpiDef, num: unknown, den: unknown): Ratio {
  const numerator = Number(num ?? 0);
  const denominator = Number(den ?? 0);
  return { numerator, denominator, value: denominator > 0 ? roundTo((numerator / denominator) * k.scale, k.decimals) : null };
}

async function aggregate(k: KpiDef, src: MetricSource, dim: string | undefined, period: Period, filters: Filter[]) {
  const g = dim ? groupExpr(src, dim) : null;
  const { rows, truncated, elapsedMs } = await roQuery(
    `SELECT ${g ? `${g} AS group_key, ` : ""}${k.numerator.expr} AS num, ${k.denominator.expr} AS den
       FROM ${src.from}
      WHERE ${periodWhere(src)}${filters.map((f) => ` AND ${f.expr} = ?`).join("")}
      ${g ? "GROUP BY group_key ORDER BY group_key" : ""}`,
    [period.from, period.to, ...filters.map((f) => f.value)],
  );
  return { rows: rows.map((r) => ({ group: g ? String(r.group_key) : null, ratio: ratio(k, r.num, r.den) })), truncated, elapsedMs };
}

function change(k: KpiDef, cur: Ratio | undefined, prev: Ratio | undefined) {
  if (cur?.value == null || prev?.value == null) return { change: null, trend: null };
  const diff = roundTo(cur.value - prev.value, k.decimals);
  const trend = diff === 0 ? "변동 없음" : diff > 0 === (k.better === "higher") ? "개선" : "악화";
  return { change: diff, trend };
}

export async function analyzeKpi(raw: Record<string, unknown>, account: Account) {
  const kpi = allowedKpis(account).find((k) => k.id === raw.kpi);
  if (!kpi) throw new QueryParamError(`kpi 는 ${allowedKpis(account).map((k) => k.id).join(", ")} 중 하나여야 합니다.`);
  const src = METRIC_SOURCES[kpi.source];
  const period = periodParams(raw);

  const dims = [...DATE_DIMS, ...Object.keys(src.dimensions)];
  const groupBy = raw.groupBy === undefined || raw.groupBy === null || raw.groupBy === "" ? undefined : String(raw.groupBy);
  if (groupBy && !dims.includes(groupBy)) throw new QueryParamError(`${kpi.id} 의 groupBy 는 ${dims.join(", ")} 중 하나여야 합니다.`);

  // 원천이 지원하지 않는 필터는 무시하지 않고 오류 — 조건 누락 결과를 막음
  const filters: Filter[] = [];
  for (const key of FILTER_KEYS) {
    const value = codeParam(raw[key], key);
    if (value === undefined) continue;
    const f = src.filters[key];
    if (!f) throw new QueryParamError(`${kpi.id} 는 ${key} 필터를 지원하지 않습니다. 가능한 필터: ${Object.keys(src.filters).join(", ")}`);
    filters.push({ key, expr: f.expr, value });
  }
  const scope = filters.map((f) => ({ filter: f.key, value: f.value, basis: "요청" }));
  const ds = src.defaultScope;
  // 범위 구분별 분해 조회 — 구분을 섞은 합계 비율은 산출하지 않음
  const splitByScope = !!ds && !filters.some((f) => f.key === ds.filter) && groupBy === ds.filter;
  if (ds && !filters.some((f) => f.key === ds.filter) && groupBy !== ds.filter) {
    filters.push({ key: ds.filter, expr: src.filters[ds.filter].expr, value: ds.value });
    scope.push({ filter: ds.filter, value: ds.value, basis: `기본 범위 — ${ds.reason}` });
  }

  let compare: Period | null = null;
  if (raw.compare !== false) {
    compare = raw.compareFrom || raw.compareTo
      ? { from: dateParam(raw.compareFrom, "compareFrom"), to: dateParam(raw.compareTo, "compareTo") }
      : previousPeriod(period);
    if (compare.from > compare.to) throw new QueryParamError("compareFrom 은 compareTo 보다 늦을 수 없습니다.");
  }

  // 날짜 단위 행은 두 기간의 키가 겹치지 않아 행별 비교 없음 — 비교는 합계로만
  const rowsCompared = !!groupBy && !(DATE_DIMS as readonly string[]).includes(groupBy);
  const [curRows, curTotal, prevRows, prevTotal] = await Promise.all([
    groupBy ? aggregate(kpi, src, groupBy, period, filters) : null,
    aggregate(kpi, src, undefined, period, filters),
    rowsCompared && compare ? aggregate(kpi, src, groupBy, compare, filters) : null,
    compare ? aggregate(kpi, src, undefined, compare, filters) : null,
  ]);

  const curMap = new Map((curRows?.rows ?? []).map((r) => [r.group, r.ratio]));
  const prevMap = new Map((prevRows?.rows ?? []).map((r) => [r.group, r.ratio]));
  const rows = rowsCompared
    ? [...new Set([...curMap.keys(), ...prevMap.keys()])].map((group) => ({ group, current: curMap.get(group) ?? null, previous: prevMap.get(group) ?? null, ...change(kpi, curMap.get(group), prevMap.get(group)) }))
    : [...curMap].map(([group, current]) => ({ group, current }));
  const cur = curTotal!.rows[0]?.ratio;
  const prev = prevTotal?.rows[0]?.ratio;

  const params = { kpi: kpi.id, ...period, groupBy, compare, filters: Object.fromEntries(filters.map((f) => [f.key, f.value])) };
  return {
    queryId: queryIdOf("analyze_kpi", params),
    kpi: { id: kpi.id, name: kpi.name, formula: formulaOf(kpi), unit: kpi.unit, changeUnit: kpi.unit === "%" ? "%p" : kpi.unit, better: kpi.better === "higher" ? "높을수록 좋음" : "낮을수록 좋음" },
    scope,
    period,
    comparePeriod: compare,
    groupBy: groupBy ?? null,
    rowsCompared,
    total: splitByScope
      ? { omitted: `${ds!.filter} 구분이 섞인 합계 비율은 산출하지 않음 — 구분별 값만 유효` }
      : { current: cur ?? null, previous: prev ?? null, ...change(kpi, cur, prev) },
    rows,
    truncated: [curRows, curTotal, prevRows, prevTotal].some((r) => r?.truncated),
    elapsedMs: Math.max(curTotal!.elapsedMs, curRows?.elapsedMs ?? 0, prevRows?.elapsedMs ?? 0, prevTotal?.elapsedMs ?? 0),
  };
}
