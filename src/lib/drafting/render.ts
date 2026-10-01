// 서식 렌더러 — 키별 구조화 채움 값을 서식 HTML 자리표시자에 기입, 모든 문자열은 이스케이프
import type { KeySpec } from "./templates";

export type Cell = string | number | null;
export type Align = "l" | "c" | "n";
export type Tone = "good" | "bad" | "warn";

// 키 종류별 채움 값 — 저장·다른 출력 형식 변환의 공통 단위
export type Fill =
  | { kind: "meta" | "text"; text: string }
  | { kind: "value"; value: number; digits?: number; unit?: string }
  | { kind: "stats"; items: { label: string; value: number | string; unit?: string; digits?: number; tone?: Tone }[] }
  | { kind: "table"; columns: { label: string; align?: Align }[]; rows: Cell[][]; sum?: Cell[] }
  | { kind: "list"; items: { text: string; when?: string; lead?: boolean }[] };

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

// 서술 문단 — 빈 줄 기준 문단, 줄바꿈은 그대로 유지
function textBlock(text: string) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return `<div class="rpt-text">${paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

function statsBlock(f: Extract<Fill, { kind: "stats" }>) {
  const head = f.items.map((x) => `<th>${esc(x.label)}</th>`).join("");
  const body = f.items
    .map((x) => {
      const v = typeof x.value === "number" ? formatNumber(x.value, x.digits) : x.value;
      return `<td${x.tone ? ` class="${x.tone}"` : ""}>${esc(v)}${unitSpan(x.unit)}</td>`;
    })
    .join("");
  return `<table class="rpt-stat"><tr>${head}</tr><tr>${body}</tr></table>`;
}

function tableBlock(f: Extract<Fill, { kind: "table" }>) {
  // 열 정렬 — 지정이 없으면 숫자 열은 오른쪽, 그 외 가운데
  const align = f.columns.map((c, i) => c.align ?? (f.rows.every((r) => r[i] === null || typeof r[i] === "number") ? "n" : "c"));
  const tr = (r: Cell[], cls = "") =>
    `<tr${cls}>${f.columns.map((_, i) => `<td class="${align[i]}">${esc(cellText(r[i] ?? null))}</td>`).join("")}</tr>`;
  const head = f.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = f.rows.map((r) => tr(r)).join("") + (f.sum ? tr(f.sum, ' class="sum"') : "");
  return `<table class="rpt-grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function listBlock(f: Extract<Fill, { kind: "list" }>) {
  const li = f.items
    .map((x) => `<li${x.lead ? ' class="lead"' : ""}>${x.when ? `<span class="when">${esc(x.when)}</span>` : ""}${esc(x.text)}</li>`)
    .join("");
  return `<div class="rpt-note"><ul>${li}</ul></div>`;
}

export function renderFill(f: Fill): string {
  switch (f.kind) {
    case "meta":
      return esc(f.text);
    case "text":
      return textBlock(f.text);
    case "value":
      return esc(formatNumber(f.value, f.digits)) + unitSpan(f.unit);
    case "stats":
      return statsBlock(f);
    case "table":
      return tableBlock(f);
    case "list":
      return listBlock(f);
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

// 서식 렌더 — 미작성 키는 표시용 자리표시로, 선언 없는 자리표시자는 원문 유지
export function renderTemplate(html: string, keys: Record<string, KeySpec>, fills: Fills) {
  return html.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (all, k: string) => {
    const s = keys[k];
    if (!s) return all;
    const f = fills[k];
    return f?.kind === s.kind ? renderFill(f) : missing(s);
  });
}
