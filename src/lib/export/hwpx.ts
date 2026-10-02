// HWPX 변환 — 렌더된 서식 HTML과 서식 스타일시트(<style>)를 해석해 글자 크기·굵기·색·정렬·표 테두리·배경을 한글 문서로 옮김
import { zip } from "./zip";

// 화면 px → HWPUNIT(1/7200 inch, 96 dpi 기준)
const PX = 75;
// A4 용지와 서식 여백(px) — 화면 지면 여백과 같은 비율
const PAGE = { width: 59528, height: 84188, top: 42, right: 50, bottom: 36, left: 50 };
const BODY_W = PAGE.width - (PAGE.left + PAGE.right) * PX;
const LINE_SPACING = 150;

// ── HTML·CSS 해석
type El = { tag: string; classes: string[]; attrs: Record<string, string>; children: Node[]; parent: El | null };
type Node = El | { text: string };
const isEl = (n: Node): n is El => "tag" in n;

const VOID = new Set(["br", "img", "hr", "meta", "link", "input"]);
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_a, k: string) => ENT[k]);

function parseHtml(html: string): El {
  const root: El = { tag: "root", classes: [], attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[4] !== undefined) {
      cur.children.push({ text: unescape(m[4]) });
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let p: El | null = cur; p && p !== root; p = p.parent) if (p.tag === tag) { cur = p.parent ?? root; break; }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = unescape(a[2]);
    const el: El = { tag, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!VOID.has(tag) && !m[3].trim().endsWith("/")) cur = el;
  }
  return root;
}

const textOf = (n: Node): string => (isEl(n) ? n.children.map(textOf).join("") : n.text);

type Compound = { tag?: string; classes: string[]; lastChild: boolean };
type Rule = { parts: Compound[]; spec: number; order: number; decls: Record<string, string> };

function parseCss(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    for (const sel of m[1].split(",")) {
      const parts: Compound[] = [];
      let ok = true;
      for (const p of sel.trim().split(/\s+/)) {
        const cm = /^([a-z0-9]+)?((?:\.[a-zA-Z0-9_-]+)*)(:last-child)?$/.exec(p);
        if (!cm) { ok = false; break; }
        parts.push({ tag: cm[1], classes: cm[2].split(".").filter(Boolean), lastChild: !!cm[3] });
      }
      if (!ok || !parts.length) continue;
      const spec = parts.reduce((n, c) => n + c.classes.length * 10 + (c.tag ? 1 : 0) + (c.lastChild ? 10 : 0), 0);
      rules.push({ parts, spec, order: order++, decls });
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
}

const lastElementChild = (el: El) => {
  const sibs = (el.parent?.children ?? []).filter(isEl);
  return sibs[sibs.length - 1] === el;
};
const matchOne = (c: Compound, el: El) => (!c.tag || c.tag === el.tag) && c.classes.every((k) => el.classes.includes(k)) && (!c.lastChild || lastElementChild(el));

function matches(rule: Rule, el: El) {
  const parts = rule.parts;
  if (!matchOne(parts[parts.length - 1], el)) return false;
  let node = el.parent;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchOne(parts[i], node)) node = node.parent;
    if (!node) return false;
    node = node.parent;
  }
  return true;
}

// ── 계산된 스타일
type Side = { w: number; color: string } | null;
type Style = {
  size: number; bold: boolean; color: string; align: string; spacing: number; mono: boolean;
  bg: string | null; border: { l: Side; r: Side; t: Side; b: Side }; pad: [number, number, number, number];
  width: number | null; marginBottom: number; display: string; flex: string; valign: string | null;
};

const BASE: Style = {
  size: 15, bold: false, color: "#111111", align: "LEFT", spacing: 0, mono: false,
  bg: null, border: { l: null, r: null, t: null, b: null }, pad: [0, 0, 0, 0], width: null, marginBottom: 0, display: "", flex: "", valign: null,
};

// 브라우저 기본값 중 서식에 쓰이는 항목
const UA: Record<string, Record<string, string>> = {
  h1: { "font-size": "32px", "font-weight": "700" },
  h2: { "font-size": "24px", "font-weight": "700" },
  th: { "font-weight": "700", "text-align": "center" },
  b: { "font-weight": "700" },
  strong: { "font-weight": "700" },
};

const px = (v: string) => {
  const m = /(-?[\d.]+)px/.exec(v);
  return m ? Number(m[1]) : 0;
};
const hex = (v: string) => {
  const m = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(v);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return "#" + h.toUpperCase();
};
const side = (v: string): Side => (/none/.test(v) || px(v) <= 0 ? null : { w: px(v), color: hex(v) ?? "#000000" });
const box = (v: string): [number, number, number, number] => {
  const n = v.split(/\s+/).map(px);
  return [n[0], n[1] ?? n[0], n[2] ?? n[0], n[3] ?? n[1] ?? n[0]];
};

function apply(s: Style, d: Record<string, string>) {
  for (const [k, v] of Object.entries(d)) {
    if (k === "font-size") s.size = px(v) || s.size;
    else if (k === "font-weight") s.bold = /bold|[6-9]00/.test(v);
    else if (k === "color") s.color = hex(v) ?? s.color;
    else if (k === "text-align") s.align = ({ left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFY" } as Record<string, string>)[v] ?? s.align;
    else if (k === "letter-spacing") s.spacing = px(v);
    else if (k === "font-family") s.mono = /monospace|Consolas|Coding/i.test(v);
    else if (k === "background" || k === "background-color") s.bg = hex(v);
    else if (k === "border") s.border = { l: side(v), r: side(v), t: side(v), b: side(v) };
    else if (k === "border-left") s.border = { ...s.border, l: side(v) };
    else if (k === "border-right") s.border = { ...s.border, r: side(v) };
    else if (k === "border-top") s.border = { ...s.border, t: side(v) };
    else if (k === "border-bottom") s.border = { ...s.border, b: side(v) };
    else if (k === "padding") s.pad = box(v);
    else if (k === "padding-left") s.pad = [s.pad[0], s.pad[1], s.pad[2], px(v)];
    else if (k === "width") s.width = /px/.test(v) ? px(v) : null;
    else if (k === "margin") s.marginBottom = box(v)[2];
    else if (k === "margin-bottom") s.marginBottom = px(v);
    else if (k === "display") s.display = v;
    else if (k === "flex") s.flex = v;
    else if (k === "vertical-align") s.valign = v;
  }
}

class Styler {
  private cache = new Map<El, Style>();
  constructor(private rules: Rule[]) {}
  of(el: El): Style {
    const hit = this.cache.get(el);
    if (hit) return hit;
    const p = el.parent ? this.of(el.parent) : BASE;
    const s: Style = { ...BASE, size: p.size, bold: p.bold, color: p.color, align: p.align, spacing: p.spacing, mono: p.mono };
    if (UA[el.tag]) apply(s, UA[el.tag]);
    for (const r of this.rules) if (matches(r, el)) apply(s, r.decls);
    this.cache.set(el, s);
    return s;
  }
}

// ── 문서 모형
type Run = { text: string; st: Style } | { br: true; st: Style };
// table — 문단 안 글자처럼 취급하는 표(셀 안 오른쪽 정렬 표 등)
type Para = { kind: "p"; runs: Run[]; align: string; after: number; table?: Table };
type Cell = { blocks: Block[]; st: Style; border: Style["border"]; bg: string | null; pad: Style["pad"]; valign: string };
type Table = { kind: "t"; rows: Cell[][]; widths: number[]; after: number };
type Block = Para | Table;

const BLOCK_TAGS = new Set(["div", "p", "h1", "h2", "h3", "ul", "ol", "li", "table", "section"]);
const SKIP = new Set(["style", "script", "head"]);

class Layout {
  constructor(private css: Styler) {}

  // 요소의 직속 내용 — 인라인은 문단으로 모으고 블록 자식은 각자 변환
  blocks(el: El, width: number): Block[] {
    const out: Block[] = [];
    let runs: Run[] = [];
    const st = this.css.of(el);
    const flush = () => {
      const trimmed = trimRuns(runs);
      if (trimmed.length) out.push({ kind: "p", runs: trimmed, align: st.align, after: 0 });
      runs = [];
    };
    const inline = (n: Node, parentSt: Style) => {
      if (!isEl(n)) {
        const t = n.text.replace(/\s+/g, " ");
        if (t) runs.push({ text: t, st: parentSt });
        return;
      }
      if (n.tag === "br") return void runs.push({ br: true, st: parentSt });
      if (SKIP.has(n.tag)) return;
      if (BLOCK_TAGS.has(n.tag)) {
        flush();
        out.push(...this.block(n, width));
        return;
      }
      const cs = this.css.of(n);
      for (const c of n.children) inline(c, cs);
    };
    for (const c of el.children) inline(c, st);
    flush();
    return out;
  }

  block(el: El, width: number): Block[] {
    const st = this.css.of(el);
    let res: Block[];
    if (el.tag === "table") res = [this.table(el, width)];
    else if (st.display === "flex") res = [this.flex(el, width)];
    else if (hasBox(st)) res = [this.boxed(el, width)];
    else res = this.blocks(el, width);
    if (st.marginBottom && res.length) {
      const last = res[res.length - 1];
      last.after = Math.max(last.after, st.marginBottom);
    }
    return res;
  }

  private cell(el: El, width: number, st = this.css.of(el), valign = "CENTER"): Cell {
    const inner = Math.max(width - (st.pad[1] + st.pad[3]) * PX, 1000);
    const blocks = this.blocks(el, inner);
    return { blocks, st, border: st.border, bg: st.bg, pad: st.pad, valign: st.valign === "top" ? "TOP" : valign };
  }

  table(el: El, width: number): Table {
    const trs: El[] = [];
    const collect = (n: El) => n.children.filter(isEl).forEach((c) => (c.tag === "tr" ? trs.push(c) : c.tag !== "table" && collect(c)));
    collect(el);
    const cellsOf = (tr: El) => tr.children.filter(isEl).filter((c) => c.tag === "td" || c.tag === "th");
    const cols = Math.max(1, ...trs.map((tr) => cellsOf(tr).length));
    // 열 너비 — 지정 px 우선, 나머지는 열 최대 글자 수 비중, 지정 너비 표가 공간보다 좁으면 그 합으로
    const fixed: (number | null)[] = Array.from({ length: cols }, (_, i) => {
      for (const tr of trs) {
        const c = cellsOf(tr)[i];
        const w = c && this.css.of(c).width;
        if (w) return (w + 2) * PX;
      }
      return null;
    });
    const weight = Array.from({ length: cols }, (_, i) => Math.min(Math.max(...trs.map((tr) => textOf(cellsOf(tr)[i] ?? { text: "" }).trim().length), 4), 24));
    const allFixed = fixed.every((f) => f !== null);
    const total = allFixed ? Math.min(width, fixed.reduce<number>((a, b) => a + (b ?? 0), 0)) : width;
    const free = total - fixed.reduce<number>((a, b) => a + (b ?? 0), 0);
    const wsum = weight.reduce((a, b, i) => a + (fixed[i] === null ? b : 0), 0) || 1;
    const widths = fixed.map((f, i) => Math.round(f ?? (free * weight[i]) / wsum));
    widths[cols - 1] += total - widths.reduce((a, b) => a + b, 0);
    const rows = trs.map((tr) => {
      const cs = cellsOf(tr).map((c, i) => this.cell(c, widths[i]));
      while (cs.length < cols) cs.push(emptyCell(this.css.of(tr)));
      return cs;
    });
    return { kind: "t", rows, widths, after: 0 };
  }

  // 가로 배치 컨테이너 — 테두리 없는 한 줄 표, 고정 폭 자식은 내용 표 너비, 나머지가 남은 폭 차지
  flex(el: El, width: number): Table {
    const kids = el.children.filter(isEl);
    const natural = (k: El) => (k.tag === "table" ? this.table(k, width).widths.reduce((a, b) => a + b, 0) + 8 * PX : Math.round(width / 3));
    const fixedW = kids.map((k) => (/^0 0/.test(this.css.of(k).flex) ? natural(k) : null));
    const flexCnt = fixedW.filter((w) => w === null).length || 1;
    const rest = width - fixedW.reduce<number>((a, b) => a + (b ?? 0), 0);
    const widths = fixedW.map((w) => w ?? Math.round(rest / flexCnt));
    widths[widths.length - 1] += width - widths.reduce((a, b) => a + b, 0);
    const none = { l: null, r: null, t: null, b: null };
    const row = kids.map((k, i): Cell => {
      const st = this.css.of(k);
      const blocks: Block[] = k.tag === "table" ? [{ kind: "p", runs: [], align: "RIGHT", after: 0, table: this.table(k, widths[i] - 8 * PX) }] : this.blocks(k, widths[i]);
      return { blocks, st, border: none, bg: null, pad: [0, 0, 0, 0], valign: "TOP" };
    });
    return { kind: "t", rows: [row], widths, after: 0 };
  }

  // 테두리·배경이 있는 블록 — 한 칸 표, 목록은 항목별 행
  boxed(el: El, width: number): Table {
    const st = this.css.of(el);
    const list = el.children.filter(isEl).find((c) => c.tag === "ul" || c.tag === "ol");
    if (list) {
      const items = list.children.filter(isEl).filter((c) => c.tag === "li");
      const rows = items.map((li, i): Cell[] => {
        const ls = this.css.of(li);
        const c = this.cell(li, width, ls);
        c.border = { l: st.border.l, r: st.border.r, t: i === 0 ? st.border.t : null, b: i === items.length - 1 ? st.border.b : ls.border.b };
        c.bg = ls.bg ?? st.bg;
        return [c];
      });
      return { kind: "t", rows: rows.length ? rows : [[emptyCell(st)]], widths: [width], after: 0 };
    }
    const inner = Math.max(width - (st.pad[1] + st.pad[3]) * PX, 1000);
    const blocks = this.blocks(el, inner);
    return { kind: "t", rows: [[{ blocks, st, border: st.border, bg: st.bg, pad: st.pad, valign: "CENTER" }]], widths: [width], after: 0 };
  }
}

const hasBox = (s: Style) => !!(s.bg || s.border.l || s.border.r || s.border.t || s.border.b);
const emptyCell = (st: Style): Cell => ({ blocks: [], st, border: st.border, bg: st.bg, pad: st.pad, valign: "CENTER" });

function trimRuns(runs: Run[]) {
  const out = runs.filter((r) => "br" in r || r.text.length);
  while (out.length && "text" in out[0] && !out[0].text.trim()) out.shift();
  while (out.length && "text" in out[out.length - 1] && !(out[out.length - 1] as { text: string }).text.trim()) out.pop();
  if (out.length && "text" in out[0]) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
  const l = out.length - 1;
  if (l >= 0 && "text" in out[l]) out[l] = { ...out[l], text: (out[l] as { text: string }).text.replace(/\s+$/, "") };
  return out;
}

// ── 머리 정보(글자·문단·테두리 모양) 등록
class Refs {
  chars: string[] = [];
  paras: string[] = [];
  fills: string[] = [];
  private keys = { c: new Map<string, number>(), p: new Map<string, number>(), f: new Map<string, number>() };

  constructor() {
    this.fill({ l: null, r: null, t: null, b: null }, null);
    this.char(BASE);
    this.para("LEFT", 0);
  }

  char(s: Style) {
    const height = Math.round(s.size * PX);
    const sp = Math.max(-50, Math.min(50, Math.round((s.spacing / s.size) * 100)));
    const font = s.mono ? 1 : 0;
    const key = [height, s.bold, s.color, sp, font].join("|");
    return getOr(this.keys.c, key, () => {
      const id = this.chars.length;
      const langs = (attr: string) => LANGS.map((l) => `${l.toLowerCase()}="${attr}"`).join(" ");
      this.chars.push(
        `<hh:charPr id="${id}" height="${height}" textColor="${s.color}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">` +
          `<hh:fontRef ${langs(String(font))}/><hh:ratio ${langs("100")}/><hh:spacing ${langs(String(sp))}/><hh:relSz ${langs("100")}/><hh:offset ${langs("0")}/>` +
          (s.bold ? "<hh:bold/>" : "") +
          `<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>`,
      );
      return id;
    });
  }

  para(align: string, after: number) {
    const next = Math.round(after * PX);
    return getOr(this.keys.p, `${align}|${next}`, () => {
      const id = this.paras.length;
      const m = (n: string, v = 0) => `<hc:${n} value="${v}" unit="HWPUNIT"/>`;
      this.paras.push(
        `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
          `<hh:align horizontal="${align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
          `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
          `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin>${m("intent")}${m("left")}${m("right")}${m("prev")}${m("next", next)}</hh:margin>` +
          `<hh:lineSpacing type="PERCENT" value="${LINE_SPACING}" unit="HWPUNIT"/><hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`,
      );
      return id;
    });
  }

  fill(b: Style["border"], bg: string | null) {
    const sd = (s: Side) => (s ? `SOLID|${mm(s.w)}|${s.color}` : "NONE");
    const key = [sd(b.l), sd(b.r), sd(b.t), sd(b.b), bg ?? "none"].join("/");
    return getOr(this.keys.f, key, () => {
      const id = this.fills.length + 1;
      const line = (n: string, s: Side) => `<hh:${n} type="${s ? "SOLID" : "NONE"}" width="${s ? mm(s.w) : "0.1 mm"}" color="${s?.color ?? "#000000"}"/>`;
      this.fills.push(
        `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
          `<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
          line("leftBorder", b.l) + line("rightBorder", b.r) + line("topBorder", b.t) + line("bottomBorder", b.b) +
          `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>` +
          (bg ? `<hc:fillBrush><hc:winBrush faceColor="${bg}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : "") +
          `</hh:borderFill>`,
      );
      return id;
    });
  }
}

const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];
const MM = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
// 테두리 굵기 — px 를 한글 허용 굵기 중 가장 가까운 값으로
const mm = (w: number) => {
  const v = w * 0.2646;
  const best = MM.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return `${best === Math.trunc(best) ? best.toFixed(1) : best} mm`;
};
function getOr<K, V>(m: Map<K, V>, k: K, make: () => V) {
  if (!m.has(k)) m.set(k, make());
  return m.get(k)!;
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F-]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── 본문 XML
class Writer {
  private pid = 0;
  private tid = 0;
  constructor(private refs: Refs) {}

  para(p: Para, lead = ""): string {
    const pp = this.refs.para(p.align, p.after);
    let body = lead;
    if (p.table) body += `<hp:run charPrIDRef="0">${this.table(p.table)}</hp:run>`;
    for (const r of p.runs) {
      const c = this.refs.char(r.st);
      body += "br" in r ? `<hp:run charPrIDRef="${c}"><hp:t><hp:lineBreak/></hp:t></hp:run>` : `<hp:run charPrIDRef="${c}"><hp:t>${xml(r.text)}</hp:t></hp:run>`;
    }
    if (!body) body = `<hp:run charPrIDRef="0"/>`;
    return `<hp:p id="${this.pid++}" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>`;
  }

  block(b: Block, lead = ""): string {
    if (b.kind === "p") return this.para(b, lead);
    return this.para({ kind: "p", runs: [], align: "LEFT", after: b.after, table: b }, lead);
  }

  table(t: Table): string {
    const id = 1000 + this.tid++;
    const width = t.widths.reduce((a, b) => a + b, 0);
    const heights = t.rows.map((row) => Math.max(...row.map((c, i) => cellHeight(c, t.widths[i]))));
    const rows = t.rows
      .map((row, ri) =>
        `<hp:tr>${row
          .map((c, ci) => {
            const bf = this.refs.fill(c.border, c.bg);
            const paras = c.blocks.length ? c.blocks.map((b) => this.block(b)).join("") : this.para({ kind: "p", runs: [], align: "LEFT", after: 0 });
            const [pt, pr, pb, pl] = c.pad.map((v) => Math.round(v * PX));
            return (
              `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
              `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.valign}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList>` +
              `<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${t.widths[ci]}" height="${heights[ri]}"/>` +
              `<hp:cellMargin left="${pl}" right="${pr}" top="${pt}" bottom="${pb}"/></hp:tc>`
            );
          })
          .join("")}</hp:tr>`,
      )
      .join("");
    const height = heights.reduce((a, b) => a + b, 0);
    return (
      `<hp:tbl id="${id}" zOrder="${id}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${t.rows.length}" colCnt="${t.widths.length}" cellSpacing="0" borderFillIDRef="1" noAdjust="0">` +
      `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>${rows}</hp:tbl>`
    );
  }
}

// 행 높이 추정 — 한글이 내용에 맞춰 다시 늘리는 최소 높이
function cellHeight(c: Cell, width: number): number {
  const inner = Math.max(width - (c.pad[1] + c.pad[3]) * PX, 1000);
  let h = (c.pad[0] + c.pad[2]) * PX;
  for (const b of c.blocks) {
    if (b.kind === "t") { h += b.rows.reduce((a, row) => a + Math.max(...row.map((x, i) => cellHeight(x, b.widths[i]))), 0); continue; }
    const nested = b.table;
    if (nested) { h += nested.rows.reduce((a, row) => a + Math.max(...row.map((x, i) => cellHeight(x, nested.widths[i]))), 0); continue; }
    const size = Math.max(c.st.size, ...b.runs.map((r) => r.st.size));
    const chars = b.runs.reduce((a, r) => a + ("text" in r ? r.text.length : 0), 0);
    const lines = Math.max(1, Math.ceil((chars * size * 0.95 * PX) / inner)) + b.runs.filter((r) => "br" in r).length;
    h += Math.round(lines * size * (LINE_SPACING / 100) * PX) + b.after * PX;
  }
  return Math.max(Math.round(h), 600);
}

// ── 패키지
const NS =
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" ' +
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" ' +
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" ' +
  'xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

function secPr() {
  const m = (v: number) => v * PX;
  const note = (place: string, len: number) =>
    `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="${len}" type="SOLID" width="0.12 mm" color="#000000"/>` +
    `<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="${place}" beneathText="0"/>`;
  const border = (t: string) => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`;
  return (
    `<hp:run charPrIDRef="0"><hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
    `<hp:pagePr landscape="WIDELY" width="${PAGE.width}" height="${PAGE.height}" gutterType="LEFT_ONLY"><hp:margin header="0" footer="0" gutter="0" left="${m(PAGE.left)}" right="${m(PAGE.right)}" top="${m(PAGE.top)}" bottom="${m(PAGE.bottom)}"/></hp:pagePr>` +
    `<hp:footNotePr>${note("EACH_COLUMN", -1)}</hp:footNotePr><hp:endNotePr>${note("END_OF_DOCUMENT", 14692344)}</hp:endNotePr>` +
    `${border("BOTH")}${border("EVEN")}${border("ODD")}</hp:secPr>` +
    `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run>`
  );
}

function header(refs: Refs) {
  const fonts = LANGS.map(
    (l) =>
      `<hh:fontface lang="${l}" fontCnt="2">` +
      `<hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>` +
      `<hh:font id="1" face="Consolas" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>` +
      `</hh:fontface>`,
  ).join("");
  return (
    `${DECL}<hh:head ${NS} version="1.2" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList>` +
    `<hh:fontfaces itemCnt="${LANGS.length}">${fonts}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="${refs.fills.length}">${refs.fills.join("")}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${refs.chars.length}">${refs.chars.join("")}</hh:charProperties>` +
    `<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>` +
    `<hh:paraProperties itemCnt="${refs.paras.length}">${refs.paras.join("")}</hh:paraProperties>` +
    `<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>` +
    `</hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
    `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`
  );
}

// 서식 HTML(<style> 포함) → HWPX 바이트
export function htmlToHwpx(html: string, title: string) {
  const root = parseHtml(html);
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const styler = new Styler(parseCss(css));
  const blocks = new Layout(styler).blocks(root, BODY_W);
  const refs = new Refs();
  const w = new Writer(refs);
  const body = (blocks.length ? blocks : [{ kind: "p", runs: [], align: "LEFT", after: 0 } as Para]).map((b, i) => w.block(b, i === 0 ? secPr() : "")).join("");
  const section = `${DECL}<hs:sec ${NS}>${body}</hs:sec>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const hpf =
    `${DECL}<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${xml(title)}</opf:title><opf:language>ko</opf:language>` +
    `<opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata>` +
    `<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest>` +
    `<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0"/></opf:spine></opf:package>`;
  return zip([
    { name: "mimetype", data: "application/hwp+zip", store: true },
    { name: "version.xml", data: `${DECL}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.2" application="Hancom Office Hangul" appVersion="11, 0, 0, 2129 WIN32LEWindows_8"/>` },
    { name: "Contents/header.xml", data: header(refs) },
    { name: "Contents/section0.xml", data: section },
    { name: "settings.xml", data: `${DECL}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>` },
    { name: "META-INF/container.xml", data: `${DECL}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>` },
    { name: "META-INF/manifest.xml", data: `${DECL}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>` },
    { name: "Contents/content.hpf", data: hpf },
  ]);
}
