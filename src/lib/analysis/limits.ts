// 규격 이탈 판정 — 측정값을 규격 테이블의 하한·상한과 대조해 대상별 이탈 항목·시각과 경보 대조 결과 산출
import "server-only";
import type { Account } from "@/lib/accounts";
import { LIMIT_SOURCE } from "@/lib/catalog";
import { roQuery } from "@/lib/db";
import { QueryParamError, codeParam, periodParams, queryIdOf } from "@/lib/queries/registry";
import { namesOf } from "./names";

type Spec = { type: string; item: string; name: string; lower: number | null; upper: number | null; unit: string | null };

const q = (id: string) => "`" + id.replace(/`/g, "``") + "`";
const num = (v: unknown) => (v === null ? null : Number(v));

export const limitsAllowed = (a: Account) => LIMIT_SOURCE.tables.every((t) => a.allowedTables.includes(t));

export async function checkLimits(raw: Record<string, unknown>, account: Account) {
  if (!limitsAllowed(account)) throw new QueryParamError("현재 계정의 조회 범위로는 규격 판정을 할 수 없습니다.");
  const src = LIMIT_SOURCE;
  const s = src.spec;
  const it = src.items;
  const r = src.readings;
  const period = periodParams(raw);
  const filters = Object.entries(src.filters).flatMap(([key, f]) => {
    const value = codeParam(raw[key], key);
    return value === undefined ? [] : [{ key, expr: f.expr, value }];
  });

  // 규격 행과 항목 마스터 — 마스터에 없는 항목은 판정 제외 목록으로 반환
  const specRows = await roQuery(
    `SELECT sp.${q(s.type)} AS type, sp.${q(s.item)} AS item, sp.${q(s.lower)} AS lower_limit, sp.${q(s.upper)} AS upper_limit,
            mi.${q(it.name)} AS name, mi.${q(it.unit)} AS unit, mi.${q(it.code)} IS NOT NULL AS known
       FROM ${q(s.table)} sp LEFT JOIN ${q(it.table)} mi ON mi.${q(it.code)} = sp.${q(s.item)}
      ORDER BY type, item`,
  );
  const all = specRows.rows.map((x) => ({
    spec: {
      type: String(x.type),
      item: String(x.item),
      name: x.name === null ? String(x.item) : String(x.name),
      lower: num(x.lower_limit),
      upper: num(x.upper_limit),
      unit: x.unit === null ? null : String(x.unit),
    } satisfies Spec,
    known: Number(x.known) === 1,
  }));
  const specs = all.filter((x) => x.known).map((x) => x.spec);
  const invalidSpecs = all.filter((x) => !x.known).map((x) => `${x.spec.type}.${x.spec.item}`);

  const where = `${src.time} >= ? AND ${src.time} < DATE_ADD(?, INTERVAL 1 DAY)${filters.map((f) => ` AND ${f.expr} = ?`).join("")}`;
  const whereParams = [period.from, period.to, ...filters.map((f) => f.value)];

  // 측정값과 대상 구분 규격 조인 — 이탈은 하한 미만 또는 상한 초과, 규격 미등록 항목은 조인에서 제외
  const specJoin = `JOIN ${q(s.table)} sp ON sp.${q(s.type)} = ${src.entityType} AND sp.${q(s.item)} = ${r.item}
                    JOIN ${q(it.table)} mi ON mi.${q(it.code)} = sp.${q(s.item)}`;
  const bad = `((sp.${q(s.lower)} IS NOT NULL AND ${r.value} < sp.${q(s.lower)}) OR (sp.${q(s.upper)} IS NOT NULL AND ${r.value} > sp.${q(s.upper)}))`;

  // 대상별 로그·경보 건수와 규격 이탈로 설명되지 않는 경보 건수
  const summary = roQuery(
    `SELECT ${src.entity} AS entity, ${src.entityType} AS entity_type, COUNT(*) AS readings, SUM(${src.flag}) AS flagged,
            SUM(${src.flag} AND NOT EXISTS (SELECT 1 FROM ${q(r.table)} ${r.alias} ${specJoin} WHERE ${r.on} AND ${bad})) AS flagged_unexplained
       FROM ${src.from} WHERE ${where}
      GROUP BY entity, entity_type ORDER BY entity`,
    whereParams,
  );

  // 대상·규격 항목별 이탈 건수·극값·최초/최종 이탈 시각 — 항목 수와 무관한 단일 조인 집계
  const items = roQuery(
    `SELECT entity, item, COUNT(*) AS readings, SUM(bad) AS violations, MIN(v) AS min_value, MAX(v) AS max_value,
            MIN(CASE WHEN bad THEN ts END) AS first_at, MAX(CASE WHEN bad THEN ts END) AS last_at
       FROM (SELECT ${src.entity} AS entity, ${r.item} AS item, ${r.value} AS v, ${src.time} AS ts, ${bad} AS bad
               FROM ${src.from} JOIN ${q(r.table)} ${r.alias} ON ${r.on} ${specJoin}
              WHERE ${where}) x
      GROUP BY entity, item`,
    whereParams,
  );
  // 대상·항목·일자별 이탈 분포 — 이탈이 있는 일자만, 일 단위 실적과 대조하는 영향 분석 근거
  const days = roQuery(
    `SELECT entity, item, DATE(ts) AS day, SUM(bad) AS violations, MIN(CASE WHEN bad THEN ts END) AS first_at, MAX(CASE WHEN bad THEN ts END) AS last_at
       FROM (SELECT ${src.entity} AS entity, ${r.item} AS item, ${src.time} AS ts, ${bad} AS bad
               FROM ${src.from} JOIN ${q(r.table)} ${r.alias} ON ${r.on} ${specJoin}
              WHERE ${where}) x
      GROUP BY entity, item, day HAVING SUM(bad) > 0
      ORDER BY entity, item, day`,
    whereParams,
  );
  const [sum, itemRows, dayRows] = await Promise.all([summary, items, days]);
  // 대상·대상 구분 코드 명칭 — 명칭 원천이 선언된 경우만
  const [entityNames, typeNames] = await Promise.all([
    namesOf(src.names.entity, sum.rows.map((x) => x.entity), account),
    namesOf(src.names.entityType, sum.rows.map((x) => x.entity_type), account),
  ]);

  const rows = sum.rows.map((row) => {
    const entity = String(row.entity);
    const checks = specs
      .filter((x) => x.type === row.entity_type)
      .map((x) => {
        const hit = itemRows.rows.find((i) => String(i.entity) === entity && i.item === x.item);
        return {
          item: x.item,
          name: x.name,
          lower: x.lower,
          upper: x.upper,
          unit: x.unit,
          readings: Number(hit?.readings ?? 0),
          violations: Number(hit?.violations ?? 0),
          min: hit?.min_value ?? null,
          max: hit?.max_value ?? null,
          firstViolationAt: hit?.first_at ?? null,
          lastViolationAt: hit?.last_at ?? null,
          violationDays: dayRows.rows
            .filter((d) => String(d.entity) === entity && d.item === x.item)
            .map((d) => ({ date: String(d.day), violations: Number(d.violations), firstAt: d.first_at, lastAt: d.last_at })),
        };
      });
    return {
      entity,
      ...(src.names.entity ? { entityName: entityNames.get(entity) ?? null } : {}),
      entityType: String(row.entity_type),
      ...(src.names.entityType ? { entityTypeName: typeNames.get(String(row.entity_type)) ?? null } : {}),
      readings: Number(row.readings),
      flagged: Number(row.flagged ?? 0),
      flaggedWithoutViolation: Number(row.flagged_unexplained ?? 0),
      violations: checks.filter((c) => c.violations > 0),
      withinSpec: checks.filter((c) => c.readings > 0 && c.violations === 0).map((c) => c.item),
      // 기간 내 측정값이 없어 판정하지 못한 항목
      unmeasured: checks.filter((c) => c.readings === 0).map((c) => c.item),
    };
  });

  const params = { ...period, filters: Object.fromEntries(filters.map((f) => [f.key, f.value])) };
  return {
    queryId: queryIdOf("check_limits", params),
    period,
    specs,
    invalidSpecs,
    rows,
    truncated: sum.truncated || itemRows.truncated || dayRows.truncated,
    elapsedMs: Math.max(specRows.elapsedMs, sum.elapsedMs, itemRows.elapsedMs, dayRows.elapsedMs),
  };
}
