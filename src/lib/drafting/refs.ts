// 수치 참조 해석 — "조회ID:경로" 를 실행 캐시의 전체 조회 결과에서 찾아 값과 출처로 변환
// 경로 문법: 점 구분 필드, [n] 위치, [필드=값] 조건 선택, 배열 뒤 length 는 원소 수

// 실행 단위 조회 결과 — 조회 ID별 도구 이름·입력·전체 결과
export type CachedResult = { name: string; input: unknown; result: unknown };
export type RunCache = Map<string, CachedResult>;

export class RefError extends Error {}

export type Resolved = {
  value: number | string;
  queryId: string;
  path: string;
  call: { name: string; input: unknown };
  numerator?: number;
  denominator?: number;
};

type Step = { field?: string; index?: number; match?: [string, string] };

// 경로 토큰화 — 대괄호 안의 점·등호는 구분자로 보지 않음
function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  const re = /([A-Za-z_][\w]*)|\[([^\]]*)\]|(\.)/gy;
  let pos = 0;
  let expectField = true;
  while (pos < path.length) {
    re.lastIndex = pos;
    const m = re.exec(path);
    if (!m) throw new RefError(`경로를 해석할 수 없습니다: ${path}`);
    if (m[1] !== undefined) {
      if (!expectField) throw new RefError(`경로 구분자(.)가 필요합니다: ${path}`);
      steps.push({ field: m[1] });
      expectField = false;
    } else if (m[2] !== undefined) {
      const inner = m[2].trim();
      if (/^\d+$/.test(inner)) steps.push({ index: Number(inner) });
      else {
        const eq = inner.indexOf("=");
        if (eq < 1) throw new RefError(`대괄호 안은 위치 번호 또는 필드=값 이어야 합니다: [${inner}]`);
        steps.push({ match: [inner.slice(0, eq).trim(), inner.slice(eq + 1).trim()] });
      }
      expectField = false;
    } else {
      if (expectField) throw new RefError(`경로 구분자가 연속됩니다: ${path}`);
      expectField = true;
    }
    pos = re.lastIndex;
  }
  if (!steps.length || expectField) throw new RefError(`경로가 비었거나 구분자로 끝납니다: ${path}`);
  return steps;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 경로 탐색 — 마지막 값과 그 값을 담은 객체 반환
export function walk(root: unknown, path: string): { value: unknown; parent: unknown; last: Step } {
  let cur: unknown = root;
  let parent: unknown = undefined;
  const steps = parsePath(path);
  for (const s of steps) {
    parent = cur;
    if (s.field !== undefined) {
      if (Array.isArray(cur) && s.field === "length") cur = cur.length;
      else if (isObj(cur) && s.field in cur) cur = cur[s.field];
      else throw new RefError(`"${s.field}" 필드가 없습니다${isObj(cur) ? ` (있는 필드: ${Object.keys(cur).join(", ")})` : ""}`);
    } else if (s.index !== undefined) {
      if (!Array.isArray(cur) || s.index >= cur.length) throw new RefError(`[${s.index}] 위치에 원소가 없습니다`);
      cur = cur[s.index];
    } else {
      const [f, v] = s.match!;
      if (!Array.isArray(cur)) throw new RefError(`[${f}=${v}] 조건은 배열에만 쓸 수 있습니다`);
      const hits = cur.filter((x) => isObj(x) && String(x[f]) === v);
      if (hits.length !== 1) throw new RefError(`[${f}=${v}] 조건에 맞는 원소가 ${hits.length}개입니다 (1개여야 함)`);
      cur = hits[0];
    }
  }
  return { value: cur, parent, last: steps[steps.length - 1] };
}

// 같은 이름 필드의 위치 — 경로 오류 안내용, 배열 원소는 [n] 으로 묶어 최대 limit 개
function fieldPlaces(root: unknown, name: string, limit = 3): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, at: string) => {
    if (out.size >= limit) return;
    if (Array.isArray(v)) v.forEach((x) => visit(x, `${at}[n]`));
    else if (isObj(v))
      for (const [k, x] of Object.entries(v)) {
        const here = at ? `${at}.${k}` : k;
        if (k === name) out.add(here);
        visit(x, here);
      }
  };
  visit(root, "");
  return [...out].slice(0, limit);
}

// 경로 탐색 실패 안내 — 없는 필드면 같은 이름 필드 위치 병기
function walkError(root: unknown, ref: string, e: RefError): RefError {
  const name = /^"([^"]+)" 필드가 없습니다/.exec(e.message)?.[1];
  const places = name ? fieldPlaces(root, name) : [];
  return new RefError(`${ref}: ${e.message}${places.length ? ` — 같은 이름 필드 위치: ${places.join(", ")}` : ""}`);
}

// 참조 문자열 분해 — 조회ID:경로
export function splitRef(ref: string): { queryId: string; path: string } {
  const i = ref.indexOf(":");
  if (i < 1 || i === ref.length - 1) throw new RefError(`참조는 "조회ID:경로" 형식이어야 합니다: ${ref}`);
  return { queryId: ref.slice(0, i).trim(), path: ref.slice(i + 1).trim() };
}

function cached(cache: RunCache, queryId: string) {
  const hit = cache.get(queryId);
  if (!hit) throw new RefError(`이번 요청에서 실행되지 않은 조회입니다: ${queryId} — 같은 조건으로 다시 조회한 뒤 그 결과의 조회 ID를 참조하세요`);
  return hit;
}

// 단일 값 참조 — 숫자·문자열만 허용, 비율 값은 같은 객체의 분자·분모를 함께 기록
export function resolveRef(cache: RunCache, ref: string): Resolved {
  const { queryId, path } = splitRef(ref);
  const hit = cached(cache, queryId);
  let found;
  try {
    found = walk(hit.result, path);
  } catch (e) {
    if (e instanceof RefError) throw walkError(hit.result, ref, e);
    throw e;
  }
  const v = found.value;
  if (!(typeof v === "number" && Number.isFinite(v)) && typeof v !== "string") throw new RefError(`${ref}: 값이 숫자나 문자열이 아닙니다`);
  const out: Resolved = { value: v, queryId, path, call: { name: hit.name, input: hit.input } };
  const p = found.parent;
  if (typeof v === "number" && isObj(p) && typeof p.numerator === "number" && typeof p.denominator === "number") {
    out.numerator = p.numerator;
    out.denominator = p.denominator;
  }
  return out;
}

// 배열 참조 — 표 축약형의 행 원천
export function resolveArray(cache: RunCache, ref: string): { rows: unknown[]; queryId: string; path: string; call: { name: string; input: unknown } } {
  const { queryId, path } = splitRef(ref);
  const hit = cached(cache, queryId);
  let found;
  try {
    found = walk(hit.result, path);
  } catch (e) {
    if (e instanceof RefError) throw walkError(hit.result, ref, e);
    throw e;
  }
  if (!Array.isArray(found.value)) throw new RefError(`${ref}: 배열이 아닙니다`);
  return { rows: found.value, queryId, path, call: { name: hit.name, input: hit.input } };
}

// 서술 안 참조 — [[참조]] 또는 [[참조|소수자릿수]], 참조 경로 안의 한 겹 대괄호([n]·[필드=값]) 허용
export const inlineRefs = () => /\[\[((?:[^\[\]|]|\[[^\[\]]*\])+)(?:\|(\d))?\]\]/g;

// 서술 안 근거 없는 숫자 — 참조·조회 ID·날짜(끝 일자만 적은 범위 포함)·한글 날짜·주차·분기·시각·차수·영문자로 시작하는 식별자 코드·목록 번호를 지운 뒤 남은 숫자
// 날짜와 이어지지 않은 일·주·개월·시간 숫자(기간·횟수)는 남겨 참조 요구
const ALLOWED_NUMERIC = [
  /\w*#[0-9a-f]{6,}\b/g,
  /(?:\d{4}-)?\d{1,2}[-/]\d{1,2}\s*~\s*\d{1,2}(?![\d.,:/-])/g,
  /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g,
  /[A-Za-z]+[\w-]*\d[\w-]*/g,
  /\b\d{1,2}[-/]\d{1,2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /(?:\d{4}\s*년\s*)?\d{1,2}\s*월(?:\s*\d{1,2}(?:\s*(?:일|주차|주))?\s*~\s*\d{1,2}\s*(?:일|주차|주)|\s*\d{1,2}\s*(?:일|주차|주))?/g,
  /\d{4}\s*년/g,
  /\d{1,2}\s*주차/g,
  /[1-4]\s*분기/g,
  /\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분)?(?:\s*\d{1,2}\s*초)?/g,
  /\d+\s*(?:차(?!례)|번째)/g,
  /^\s*\d+[.)]/gm,
];

// 조회 결과의 문자열 값 중 숫자를 품은 이름·코드 — 서술에 그대로 옮긴 경우 허용, 숫자만으로 된 문자열은 제외
export function knownLabels(cache: RunCache): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      if (v.length >= 2 && v.length <= 100 && /\d/.test(v) && /[^\d\s.,:%+-]/.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) Object.values(v).forEach(visit);
  };
  for (const hit of cache.values()) visit(hit.result);
  return [...out].sort((a, b) => b.length - a.length);
}

export function bareNumbers(text: string, known: readonly string[] = []): string[] {
  let rest = text.replace(inlineRefs(), " ");
  for (const k of known) if (rest.includes(k)) rest = rest.split(k).join(" ");
  for (const re of ALLOWED_NUMERIC) rest = rest.replace(re, " ");
  return [...rest.matchAll(/\d[\d,.]*%?/g)].map((m) => m[0]);
}
