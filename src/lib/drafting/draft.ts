// 보고서 기안 — LLM 이 준 키별 입력(수치는 조회 참조)을 코드가 해석해 채움 값·수치 출처·렌더 HTML 생성
import "server-only";
import type { Account } from "@/lib/accounts";
import type { ReportNumber } from "@/lib/reports";
import { parseFills } from "./fills";
import { accountFills, systemFills } from "./meta";
import { RefError, bareNumbers, inlineRefs, knownLabels, resolveArray, resolveRef, walk, type Resolved, type RunCache } from "./refs";
import { fillIssues, formatNumber, renderTemplate, type Align, type Cell, type Fill, type Fills, type NumMark, type Tone } from "./render";
import { getTemplate, listTemplates, templateSource, type KeySpec } from "./templates";

export class DraftError extends Error {}

export type Draft = {
  template: { id: string; name: string };
  title: string;
  period: { label: string; from: string; to: string };
  fills: Fills;
  numbers: ReportNumber[];
  html: string;
  warnings: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TONES: readonly Tone[] = ["good", "bad", "warn"];
const ALIGNS: readonly Align[] = ["l", "c", "n"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 입력 글자 수 상한 — 검증과 서식 목록 안내가 같은 값 사용
export const LIMITS = {
  title: 200,
  periodLabel: 60,
  meta: 200,
  text: 4000,
  listItem: 1000,
  listWhen: 40,
  statLabel: 60,
  statText: 40,
  columnLabel: 60,
  cell: 200,
} as const;

// 기안 1회 상태 — 수치 출처 누적과 오류 수집
class Builder {
  numbers: ReportNumber[] = [];
  errors: string[] = [];
  private known: string[] | null = null;
  constructor(private cache: RunCache) {}

  // 서술 문자열 — 근거 없는 숫자 검사, [[참조]] 와 [[참조|자릿수]] 를 값으로 치환
  text(raw: unknown, at: string, max: number = LIMITS.text): string {
    return this.marked(raw, at, max).text;
  }

  // 서술 문자열과 수치 위치 — 치환된 숫자 값의 시작·길이와 수치 키, 지면의 수치 선택 단위
  marked(raw: unknown, at: string, max: number = LIMITS.text): { text: string; nums?: NumMark[] } {
    // 목록 항목 형식({text})으로 감싼 서술은 본문 문자열로 수용
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && Object.keys(raw).length === 1 && typeof (raw as { text?: unknown }).text === "string") raw = (raw as { text: string }).text;
    if (typeof raw !== "string") {
      this.errors.push(`${at}: 문자열이어야 합니다`);
      return { text: "" };
    }
    this.known ??= knownLabels(this.cache);
    const bare = bareNumbers(raw, this.known);
    if (bare.length) this.errors.push(`${at}: 참조 없는 숫자 ${[...new Set(bare)].join(", ")} — 수치는 [[조회ID:경로]] 로 적고, 날짜는 M월 D일·MM-DD 형식으로 적으세요`);
    let n = 0;
    let out = "";
    let last = 0;
    const nums: NumMark[] = [];
    for (const m of raw.matchAll(inlineRefs())) {
      out += raw.slice(last, m.index);
      last = m.index + m[0].length;
      const key = `${at}#${++n}`;
      const r = this.resolve(m[1], key);
      const shown = r === null ? "?" : this.show(r.value, m[2] === undefined ? undefined : Number(m[2]));
      if (r && typeof r.value === "number") nums.push({ at: out.length, len: shown.length, key });
      out += shown;
    }
    out += raw.slice(last);
    if (out.length > max) this.errors.push(`${at}: ${max}자를 넘습니다`);
    return nums.length ? { text: out, nums } : { text: out };
  }

  show(v: number | string, digits?: number) {
    return typeof v === "number" ? formatNumber(v, digits) : v;
  }

  // 참조 해석 — 숫자 값은 수치 목록에 출처와 함께 기록
  resolve(ref: unknown, key: string, label?: string, unit?: string): Resolved | null {
    if (typeof ref !== "string") {
      this.errors.push(`${key}: ref 는 "조회ID:경로" 문자열이어야 합니다`);
      return null;
    }
    try {
      const r = resolveRef(this.cache, ref);
      if (typeof r.value === "number") this.record(key, r, label, unit);
      return r;
    } catch (e) {
      if (!(e instanceof RefError)) throw e;
      this.errors.push(`${key}: ${e.message}`);
      return null;
    }
  }

  record(key: string, r: Resolved, label?: string, unit?: string) {
    this.numbers.push({
      key,
      ...(label ? { label } : {}),
      value: r.value as number,
      ...(r.numerator !== undefined ? { numerator: r.numerator, denominator: r.denominator } : {}),
      ...(unit ? { unit } : {}),
      queryId: r.queryId,
      path: r.path,
      call: r.call,
    });
  }

  digitsOf(v: unknown, at: string): number | undefined {
    if (v === undefined) return undefined;
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6) return v as number;
    this.errors.push(`${at}: digits 는 0~6 정수입니다`);
    return undefined;
  }

  // 키 종류별 입력 변환
  fill(key: string, spec: KeySpec, raw: unknown): Fill | null {
    switch (spec.kind) {
      case "meta":
        return { kind: "meta", ...this.marked(raw, key, LIMITS.meta) };
      case "text":
        return { kind: "text", ...this.marked(raw, key) };
      case "value": {
        const o = typeof raw === "string" ? { ref: raw } : isObj(raw) ? raw : null;
        if (!o) return this.fail(`${key}: {ref, digits?, unit?} 객체여야 합니다`);
        const digits = this.digitsOf(o.digits, `${key}.digits`);
        const unit = typeof o.unit === "string" ? o.unit : undefined;
        const r = this.resolve(o.ref, key, spec.label, unit);
        if (!r) return null;
        if (typeof r.value !== "number") return this.fail(`${key}: 숫자 값이 아닙니다`);
        return { kind: "value", value: r.value, digits, unit };
      }
      case "stats": {
        if (!Array.isArray(raw)) return this.fail(`${key}: [{label, ref|text, unit?, digits?, tone?}] 배열이어야 합니다`);
        const items = raw.map((x, i) => {
          const at = `${key}[${i}]`;
          if (!isObj(x)) return this.fail(`${at}: 객체여야 합니다`);
          const label = this.text(x.label, `${at}.label`, LIMITS.statLabel);
          const unit = typeof x.unit === "string" ? x.unit : undefined;
          const digits = this.digitsOf(x.digits, `${at}.digits`);
          const tone = TONES.find((v) => v === x.tone);
          if (x.ref !== undefined) {
            const r = this.resolve(x.ref, at, label, unit);
            return r ? { label, value: r.value, unit, digits, tone } : null;
          }
          return { label, value: this.text(x.text, `${at}.text`, LIMITS.statText), unit, digits, tone };
        });
        return items.every(Boolean) ? { kind: "stats", items: items as NonNullable<(typeof items)[number]>[] } : null;
      }
      case "table":
        return this.table(key, raw);
      case "list": {
        if (!Array.isArray(raw)) return this.fail(`${key}: [{text, when?, lead?}] 배열이어야 합니다`);
        return {
          kind: "list",
          items: raw.map((x, i) => {
            const o = typeof x === "string" ? { text: x } : isObj(x) ? x : { text: "" };
            // 강조 행 표시 — 참·거짓 외 값은 내용 소실 방지를 위해 거부
            if (o.lead !== undefined && typeof o.lead !== "boolean") this.fail(`${key}[${i}].lead: 참·거짓 값이어야 합니다(강조 행 표시). 소제목은 text 에 포함하세요`);
            return {
              ...this.marked(o.text, `${key}[${i}]`, LIMITS.listItem),
              when: o.when === undefined ? undefined : this.text(o.when, `${key}[${i}].when`, LIMITS.listWhen),
              lead: o.lead === true ? true : undefined,
            };
          }),
        };
      }
    }
  }

  fail(msg: string): null {
    this.errors.push(msg);
    return null;
  }

  // 표 — 행 원천 배열 참조(from + 열 path) 또는 칸 단위 입력(rows), 칸은 문자열 또는 {ref, digits?}
  table(key: string, raw: unknown): Fill | null {
    if (!isObj(raw) || !Array.isArray(raw.columns)) return this.fail(`${key}: {columns, from?, rows?, sum?} 객체여야 합니다`);
    const cols = raw.columns.map((c, j) => (isObj(c) ? c : (this.fail(`${key}.columns[${j}]: 객체여야 합니다`), {})));
    const columns = cols.map((c, j) => ({
      label: this.text(c.label, `${key}.columns[${j}].label`, LIMITS.columnLabel),
      align: ALIGNS.find((v) => v === c.align),
    }));
    const cellOf = (x: unknown, at: string): Cell => {
      if (x === null) return null;
      if (isObj(x)) {
        const digits = this.digitsOf(x.digits, `${at}.digits`);
        const r = this.resolve(x.ref, at);
        return r ? (typeof r.value === "number" && digits !== undefined ? formatNumber(r.value, digits) : r.value) : null;
      }
      return this.text(x, at, LIMITS.cell);
    };
    const rowOf = (r: unknown, at: string) => (Array.isArray(r) ? r.map((x, j) => cellOf(x, `${at}[${j}]`)) : (this.fail(`${at}: 배열이어야 합니다`), []));

    let rows: Cell[][] = [];
    if (raw.from !== undefined) {
      if (typeof raw.from !== "string") return this.fail(`${key}.from: "조회ID:배열경로" 문자열이어야 합니다`);
      let src;
      try {
        src = resolveArray(this.cache, raw.from);
      } catch (e) {
        if (!(e instanceof RefError)) throw e;
        return this.fail(`${key}.from: ${e.message}`);
      }
      rows = src.rows.map((row, i) =>
        cols.map((c, j) => {
          const at = `${key}[${i}][${j}]`;
          if (typeof c.path !== "string") return this.fail(`${key}.columns[${j}].path: from 을 쓰면 열마다 path 가 필요합니다`);
          try {
            const { value: v, parent } = walk(row, c.path);
            const digits = this.digitsOf(c.digits, `${key}.columns[${j}].digits`);
            if (typeof v === "number" && Number.isFinite(v)) {
              const ratio = isObj(parent) && typeof parent.numerator === "number" && typeof parent.denominator === "number";
              this.record(at, { value: v, queryId: src.queryId, path: `${src.path}[${i}].${c.path}`, call: src.call, ...(ratio ? { numerator: parent.numerator as number, denominator: parent.denominator as number } : {}) }, columns[j].label);
              return digits !== undefined ? formatNumber(v, digits) : v;
            }
            if (v === null || typeof v === "string") return v;
            return this.fail(`${at}: ${c.path} 값이 숫자·문자열이 아닙니다`);
          } catch (e) {
            if (!(e instanceof RefError)) throw e;
            return this.fail(`${at}: ${e.message}`);
          }
        }),
      );
    }
    if (raw.rows !== undefined) {
      if (!Array.isArray(raw.rows)) return this.fail(`${key}.rows: 배열이어야 합니다`);
      rows = rows.concat(raw.rows.map((r, i) => rowOf(r, `${key}[${rows.length + i}]`)));
    }
    if (raw.from === undefined && raw.rows === undefined) return this.fail(`${key}: from 또는 rows 가 필요합니다`);
    const sum = raw.sum === undefined ? undefined : rowOf(raw.sum, `${key}.sum`);
    return { kind: "table", columns, rows, sum };
  }
}

// 서식 후보 — 서식별 용도·섹션과 기안 입력 대상 키(조회·LLM 채움), 계정 기본 서식, 입력 글자 수 상한 표시
export async function templateCatalog(account: Account) {
  return {
    defaultTemplate: account.defaultTemplate,
    limits: LIMITS,
    templates: (await listTemplates()).map((t) => ({
      id: t.id,
      name: t.name,
      purpose: t.purpose,
      sections: t.sections,
      keys: Object.fromEntries(
        Object.entries(t.keys)
          .filter(([k, s]) => (s.by === "llm" || s.by === "query") && !k.startsWith("period_") && k !== "doc_title")
          .map(([k, s]) => [k, { kind: s.kind, label: s.label, required: s.required, ...(s.guide ? { guide: s.guide } : {}) }]),
      ),
    })),
  };
}

// 기안 — 오류가 하나라도 있으면 초안 없이 오류 목록으로 실패, 필수 키 누락은 경고로 초안 생성
// 저장 보고서 지면 — 저장된 채움 값으로 서식 재렌더, 조회 재실행 없음, 수치 키 목록으로 수치 표시
export async function renderSaved(templateId: string, fills: Fills, numKeys?: ReadonlySet<string>) {
  const t = await getTemplate(templateId);
  return t ? renderTemplate(await templateSource(t), t.keys, fills, numKeys) : null;
}

export async function draftReport(input: Record<string, unknown>, account: Account, cache: RunCache): Promise<Draft> {
  const t = await getTemplate(String(input.template ?? ""));
  if (!t) throw new DraftError(`알 수 없는 서식입니다: ${String(input.template)} — recommend_templates 결과의 id 를 쓰세요`);
  const b = new Builder(cache);
  const period = isObj(input.period) ? input.period : {};
  const from = String(period.from ?? "");
  const to = String(period.to ?? "");
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) b.errors.push("period: {label, from, to} 의 from·to 는 YYYY-MM-DD 이고 from ≤ to 여야 합니다");
  const title = b.text(input.title, "title", LIMITS.title);
  const label = b.text(period.label, "period.label", LIMITS.periodLabel);

  const given = isObj(input.fills) ? input.fills : {};
  if (!isObj(input.fills)) b.errors.push("fills: 키별 입력 객체가 필요합니다");
  const warnings: string[] = [];
  const fills: Fills = {};
  for (const [k, raw] of Object.entries(given)) {
    const spec = t.keys[k];
    if (!spec) b.errors.push(`${k}: 서식에 없는 키입니다`);
    else if (spec.by === "system" || spec.by === "account" || k.startsWith("period_") || k === "doc_title") warnings.push(`${k}: 코드가 채우는 키라 입력을 무시했습니다`);
    else {
      const f = b.fill(k, spec, raw);
      if (f) fills[k] = f;
    }
  }
  if (b.errors.length) throw new DraftError(b.errors.join("\n"));

  Object.assign(fills, {
    doc_title: { kind: "meta", text: title },
    period_label: { kind: "meta", text: label },
    period_from: { kind: "meta", text: from },
    period_to: { kind: "meta", text: to },
    ...accountFills(account),
  } satisfies Fills);
  const parsed = parseFills(fills);
  if (!parsed.ok) throw new DraftError(parsed.error);
  const issues = fillIssues(t.keys, { ...fills, ...systemFills(null) });
  const html = renderTemplate(await templateSource(t), t.keys, { ...fills, ...systemFills(null) }, new Set(b.numbers.map((x) => x.key)));
  return { template: { id: t.id, name: t.name }, title, period: { label, from, to }, fills, numbers: b.numbers, html, warnings: [...warnings, ...issues] };
}
