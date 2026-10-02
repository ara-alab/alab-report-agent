// 채움 값 구조 검증 — 외부 입력(JSON)을 키 종류별 Fill 로 변환, 실패 시 사유 반환
import type { Align, Cell, Fill, Fills, NumMark, Tone } from "./render";

const MAX_TEXT = 4000;
const MAX_ROWS = 200;
const MAX_COLS = 20;
const MAX_ITEMS = 40;
const MAX_NUMS = 100;

class FillError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, what: string, max = MAX_TEXT): string {
  if (typeof v !== "string") throw new FillError(`${what}: 문자열이 아닙니다`);
  if (v.length > max) throw new FillError(`${what}: ${max}자를 넘습니다`);
  return v;
}

function optStr(v: unknown, what: string, max = 40) {
  return v === undefined ? undefined : str(v, what, max);
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new FillError(`${what}: 유한한 숫자가 아닙니다`);
  return v;
}

function optDigits(v: unknown, what: string) {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 6) throw new FillError(`${what}: 소수 자릿수는 0~6 정수입니다`);
  return v as number;
}

function arr(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new FillError(`${what}: 배열이 아닙니다`);
  if (v.length > max) throw new FillError(`${what}: ${max}개를 넘습니다`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T | undefined {
  if (v === undefined) return undefined;
  if (!allowed.includes(v as T)) throw new FillError(`${what}: ${allowed.join("·")} 중 하나여야 합니다`);
  return v as T;
}

function cell(v: unknown, what: string): Cell {
  if (v === null || typeof v === "string") return v === null ? null : str(v, what, 200);
  return num(v, what);
}

// 서술 수치 위치 — 서술 범위 안의 겹치지 않는 구간, 수치 키 형식 제한
function nums(v: unknown, text: string, what: string): { nums?: NumMark[] } {
  if (v === undefined) return {};
  let last = 0;
  const out = arr(v, what, MAX_NUMS).map((x, i) => {
    const w = `${what}[${i}]`;
    if (!isObj(x)) throw new FillError(`${w}: 객체가 아닙니다`);
    const { at, len } = x;
    if (!Number.isInteger(at) || !Number.isInteger(len) || (at as number) < last || (len as number) < 1 || (at as number) + (len as number) > text.length)
      throw new FillError(`${w}: 위치가 서술 범위를 벗어나거나 겹칩니다`);
    last = (at as number) + (len as number);
    const key = str(x.key, `${w}.key`, 120);
    if (!/^[a-z][a-z0-9_]*[\w.[\]#]*$/.test(key)) throw new FillError(`${w}.key: 수치 키 형식이 아닙니다`);
    return { at: at as number, len: len as number, key };
  });
  return out.length ? { nums: out } : {};
}

function fill(v: unknown, at: string): Fill {
  if (!isObj(v)) throw new FillError(`${at}: 객체가 아닙니다`);
  switch (v.kind) {
    case "meta": {
      const text = str(v.text, `${at}.text`, 200);
      return { kind: "meta", text, ...nums(v.nums, text, `${at}.nums`) };
    }
    case "text": {
      const text = str(v.text, `${at}.text`);
      return { kind: "text", text, ...nums(v.nums, text, `${at}.nums`) };
    }
    case "value":
      return { kind: "value", value: num(v.value, `${at}.value`), digits: optDigits(v.digits, `${at}.digits`), unit: optStr(v.unit, `${at}.unit`) };
    case "stats":
      return {
        kind: "stats",
        items: arr(v.items, `${at}.items`, 12).map((x, i) => {
          const w = `${at}.items[${i}]`;
          if (!isObj(x)) throw new FillError(`${w}: 객체가 아닙니다`);
          return {
            label: str(x.label, `${w}.label`, 60),
            value: typeof x.value === "string" ? str(x.value, `${w}.value`, 40) : num(x.value, `${w}.value`),
            unit: optStr(x.unit, `${w}.unit`),
            digits: optDigits(x.digits, `${w}.digits`),
            tone: oneOf<Tone>(x.tone, ["good", "bad", "warn"], `${w}.tone`),
          };
        }),
      };
    case "table": {
      const columns = arr(v.columns, `${at}.columns`, MAX_COLS).map((c, i) => {
        const w = `${at}.columns[${i}]`;
        if (!isObj(c)) throw new FillError(`${w}: 객체가 아닙니다`);
        return { label: str(c.label, `${w}.label`, 60), align: oneOf<Align>(c.align, ["l", "c", "n"], `${w}.align`) };
      });
      const row = (r: unknown, w: string) => {
        const cells = arr(r, w, MAX_COLS);
        if (cells.length !== columns.length) throw new FillError(`${w}: 열 수(${columns.length})와 칸 수(${cells.length})가 다릅니다`);
        return cells.map((c, j) => cell(c, `${w}[${j}]`));
      };
      return {
        kind: "table",
        columns,
        rows: arr(v.rows, `${at}.rows`, MAX_ROWS).map((r, i) => row(r, `${at}.rows[${i}]`)),
        sum: v.sum === undefined ? undefined : row(v.sum, `${at}.sum`),
      };
    }
    case "list":
      return {
        kind: "list",
        items: arr(v.items, `${at}.items`, MAX_ITEMS).map((x, i) => {
          const w = `${at}.items[${i}]`;
          if (!isObj(x)) throw new FillError(`${w}: 객체가 아닙니다`);
          if (x.lead !== undefined && typeof x.lead !== "boolean") throw new FillError(`${w}.lead: 참·거짓 값이 아닙니다`);
          const text = str(x.text, `${w}.text`, 1000);
          return { text, when: optStr(x.when, `${w}.when`), lead: x.lead as boolean | undefined, ...nums(x.nums, text, `${w}.nums`) };
        }),
      };
    default:
      throw new FillError(`${at}.kind: 알 수 없는 종류입니다`);
  }
}

// 키별 채움 값 묶음 검증 — 키 이름 형식·종류별 구조
export function parseFills(raw: unknown): { ok: true; fills: Fills } | { ok: false; error: string } {
  try {
    if (!isObj(raw)) throw new FillError("채움 값이 객체가 아닙니다");
    const fills: Fills = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(k)) throw new FillError(`키 이름이 올바르지 않습니다: ${k}`);
      fills[k] = fill(v, k);
    }
    return { ok: true, fills };
  } catch (e) {
    if (e instanceof FillError) return { ok: false, error: e.message };
    throw e;
  }
}
