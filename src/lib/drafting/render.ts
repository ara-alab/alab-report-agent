// 서식 렌더러 — 키별 구조화 채움 값을 서식 HTML 자리표시자에 기입, 모든 문자열은 이스케이프
import type { KeySpec } from "./templates";

export type Cell = string | number | null;
export type Align = "l" | "c" | "n";
export type Tone = "good" | "bad" | "warn";

// 서술 안 수치 위치 — 치환된 값의 시작·길이와 수치 키
export type NumMark = { at: number; len: number; key: string };

// 키 종류별 채움 값 — 저장·다른 출력 형식 변환의 공통 단위
export type Fill =
  | { kind: "meta" | "text"; text: string; nums?: NumMark[] }
  | { kind: "value"; value: number; digits?: number; unit?: string }
  | { kind: "stats"; items: { label: string; value: number | string; unit?: string; digits?: number; tone?: Tone }[] }
  | { kind: "table"; columns: { label: string; align?: Align }[]; rows: Cell[][]; sum?: Cell[] }
  | { kind: "list"; items: { text: string; when?: string; lead?: boolean; nums?: NumMark[] }[] };

export type Fills = Record<string, Fill>;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// 숫자 표기 — 천 단위 구분, 소수 자릿수 지정 시 고정
export function formatNumber(n: number, digits?: number) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", digits === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const cellText = (c: Cell) => (c === null ? "-" : typeof c === "number" ? formatNumber(c) : c);
const unitSpan = (u?: string) => (u ? `<span class="u">${esc(u)}</span>` : "");

// 수치 표시 — 출처 기록이 있는 수치만 수치 키 래퍼로 감쌈, 지면의 근거 선택 단위
type NumMarker = (key: string, html: string) => string;
const noMark: NumMarker = (_key, html) => html;
const markerOf = (numKeys?: ReadonlySet<string>): NumMarker =>
  numKeys ? (key, html) => (numKeys.has(key) ? `<span class="rpt-num" data-num="${esc(key)}">${html}</span>` : html) : noMark;

// 서술 수치 경계 — 이스케이프·문단 분할 뒤 래퍼로 바꿀 사용자 영역 문자
const NUM_OPEN = "\uE000";
const NUM_CLOSE = "\uE001";

// 서술 문자열에 수치 경계 삽입 — 위치가 문자열과 어긋난 표시는 무시
function withMarks(text: string, nums: NumMark[] | undefined, mark: NumMarker) {
  const clean = text.replace(/[\uE000\uE001]/g, "");
  if (mark === noMark || !nums?.length || clean !== text) return { text: clean, keys: [] as string[] };
  let out = "";
  let last = 0;
  const keys: string[] = [];
  for (const n of [...nums].sort((a, b) => a.at - b.at)) {
    if (n.at < last || n.at + n.len > text.length || n.len < 1) continue;
    out += text.slice(last, n.at) + NUM_OPEN + text.slice(n.at, n.at + n.len) + NUM_CLOSE;
    last = n.at + n.len;
    keys.push(n.key);
  }
  return { text: out + text.slice(last), keys };
}

// 이스케이프된 서술의 수치 경계를 래퍼로 치환 — 경계 순서대로 수치 키 대응
const markEscaped = (html: string, keys: string[], mark: NumMarker) => {
  let i = 0;
  return html.replace(/\uE000([^\uE000\uE001]*)\uE001/g, (_all, inner: string) => mark(keys[i++], inner));
};

const inlineText = (text: string, nums: NumMark[] | undefined, mark: NumMarker) => {
  const m = withMarks(text, nums, mark);
  return markEscaped(esc(m.text), m.keys, mark);
};

// 서술 문단 — 빈 줄 기준 문단, 줄바꿈은 그대로 유지
function textBlock(text: string, nums: NumMark[] | undefined, mark: NumMarker) {
  const m = withMarks(text, nums, mark);
  const paras = m.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const body = paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div class="rpt-text">${markEscaped(body, m.keys, mark)}</div>`;
}

function statsBlock(key: string, f: Extract<Fill, { kind: "stats" }>, mark: NumMarker) {
  const head = f.items.map((x) => `<th>${esc(x.label)}</th>`).join("");
  const body = f.items
    .map((x, i) => {
      const v = typeof x.value === "number" ? mark(`${key}[${i}]`, esc(formatNumber(x.value, x.digits))) : esc(x.value);
      return `<td${x.tone ? ` class="${x.tone}"` : ""}>${v}${unitSpan(x.unit)}</td>`;
    })
    .join("");
  return `<table class="rpt-stat"><tr>${head}</tr><tr>${body}</tr></table>`;
}

function tableBlock(key: string, f: Extract<Fill, { kind: "table" }>, mark: NumMarker) {
  // 열 정렬 — 지정이 없으면 숫자 열은 오른쪽, 그 외 가운데
  const align = f.columns.map((c, i) => c.align ?? (f.rows.every((r) => r[i] === null || typeof r[i] === "number") ? "n" : "c"));
  const tr = (r: Cell[], at: (i: number) => string, cls = "") =>
    `<tr${cls}>${f.columns.map((_, i) => `<td class="${align[i]}">${mark(at(i), esc(cellText(r[i] ?? null)))}</td>`).join("")}</tr>`;
  const head = f.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = f.rows.map((r, ri) => tr(r, (i) => `${key}[${ri}][${i}]`)).join("") + (f.sum ? tr(f.sum, (i) => `${key}.sum[${i}]`, ' class="sum"') : "");
  return `<table class="rpt-grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function listBlock(f: Extract<Fill, { kind: "list" }>, mark: NumMarker) {
  const li = f.items
    .map((x) => `<li${x.lead ? ' class="lead"' : ""}>${x.when ? `<span class="when">${esc(x.when)}</span>` : ""}${inlineText(x.text, x.nums, mark)}</li>`)
    .join("");
  return `<div class="rpt-note"><ul>${li}</ul></div>`;
}

// 채움 값 렌더 — 키와 수치 키 목록이 있으면 출처 기록 수치를 수치 래퍼로 표시
export function renderFill(f: Fill, key = "", numKeys?: ReadonlySet<string>): string {
  const mark = key ? markerOf(numKeys) : noMark;
  switch (f.kind) {
    case "meta":
      return inlineText(f.text, f.nums, mark);
    case "text":
      return textBlock(f.text, f.nums, mark);
    case "value":
      return mark(key, esc(formatNumber(f.value, f.digits))) + unitSpan(f.unit);
    case "stats":
      return statsBlock(key, f, mark);
    case "table":
      return tableBlock(key, f, mark);
    case "list":
      return listBlock(f, mark);
  }
}

const missing = (s: KeySpec) => `<span class="rpt-missing">${esc(s.label)} 미작성</span>`;

// 채움 값과 키 선언 대조 — 선언 없는 키, 종류 불일치, 필수 누락
export function fillIssues(keys: Record<string, KeySpec>, fills: Fills) {
  const issues: string[] = [];
  for (const [k, f] of Object.entries(fills)) {
    const s = keys[k];
    if (!s) issues.push(`선언되지 않은 키: ${k}`);
    else if (s.kind !== f.kind) issues.push(`${k}: ${s.kind} 키에 ${f.kind} 값`);
  }
  for (const [k, s] of Object.entries(keys)) if (s.required && !fills[k]) issues.push(`필수 키 누락: ${k}(${s.label})`);
  return issues;
}

// 블록 키 — 문단·지표·표·목록, 화면의 섹션 선택 단위
const BLOCK_KINDS = new Set(["text", "stats", "table", "list"]);

// 서식 렌더 — 미작성 키는 표시용 자리표시로, 선언 없는 자리표시자는 원문 유지, 블록 키·LLM 서술 메타는 data-key 래퍼로 식별
export function renderTemplate(html: string, keys: Record<string, KeySpec>, fills: Fills, numKeys?: ReadonlySet<string>) {
  return html.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (all, k: string) => {
    const s = keys[k];
    if (!s) return all;
    const f = fills[k];
    const body = f?.kind === s.kind ? renderFill(f, k, numKeys) : missing(s);
    const attrs = `class="rpt-key" data-key="${esc(k)}" data-label="${esc(s.label)}"`;
    if (BLOCK_KINDS.has(s.kind)) return `<div ${attrs}>${body}</div>`;
    return s.kind === "meta" && s.by === "llm" ? `<span ${attrs}>${body}</span>` : body;
  });
}
