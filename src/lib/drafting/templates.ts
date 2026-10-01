// 서식 레지스트리 — 서식 목록·키 선언·서식 HTML 로드, 서식 내용은 데이터 계층(public 서식 파일) 소관
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 키 종류 — 채움 값의 구조, 출력 형식(HTML·기안문 등)과 무관한 단위
export type KeyKind = "meta" | "value" | "text" | "stats" | "table" | "list";
// 키 채움 주체 — 시스템 발급, 계정 설정, 조회 결과 참조, LLM 서술
export type KeySource = "system" | "account" | "query" | "llm";

export type KeySpec = { kind: KeyKind; by: KeySource; label: string; required: boolean };

export type TemplateDef = {
  id: string;
  name: string;
  // 문서번호 접두어 — 접두어-작성일-일련번호 형식
  docPrefix: string;
  file: string;
  purpose: string;
  sections: string[];
  keys: Record<string, KeySpec>;
};

type Registry = { style: string; common: Record<string, KeySpec>; templates: TemplateDef[] };

const ROOT = path.join(process.cwd(), "public", "report-mockup");
const KINDS = new Set<KeyKind>(["meta", "value", "text", "stats", "table", "list"]);
const SOURCES = new Set<KeySource>(["system", "account", "query", "llm"]);

let cached: Promise<Registry> | null = null;

// 서식 파일 경로 — 서식 디렉터리 밖 경로 차단
function resolveFile(rel: string) {
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(path.join(ROOT, "data", "templates") + path.sep)) throw new Error(`서식 경로가 올바르지 않습니다: ${rel}`);
  return full;
}

function checkKeys(owner: string, keys: Record<string, KeySpec>) {
  for (const [k, s] of Object.entries(keys)) {
    if (!/^[a-z][a-z0-9_]*$/.test(k)) throw new Error(`${owner}: 키 이름이 올바르지 않습니다: ${k}`);
    if (!KINDS.has(s.kind) || !SOURCES.has(s.by)) throw new Error(`${owner}: 키 선언이 올바르지 않습니다: ${k}`);
  }
}

async function loadRegistry(): Promise<Registry> {
  const raw = JSON.parse(await readFile(path.join(ROOT, "data", "templates", "index.json"), "utf8")) as Registry;
  checkKeys("common", raw.common);
  for (const t of raw.templates) {
    checkKeys(t.id, t.keys);
    if (!/^[A-Z][A-Z0-9-]{1,19}$/.test(t.docPrefix ?? "")) throw new Error(`${t.id}: 문서번호 접두어가 올바르지 않습니다`);
    const dup = Object.keys(t.keys).filter((k) => k in raw.common);
    if (dup.length) throw new Error(`${t.id}: 공통 키와 겹치는 키가 있습니다: ${dup.join(", ")}`);
  }
  return raw;
}

// 개발 중 서식 수정 반영 — 운영 빌드만 캐시
function registry() {
  if (process.env.NODE_ENV !== "production") return loadRegistry();
  cached ??= loadRegistry().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

// 서식별 전체 키 — 공통 메타 키와 서식 고유 키의 합
export async function listTemplates() {
  const r = await registry();
  return r.templates.map((t) => ({ ...t, keys: { ...r.common, ...t.keys } }));
}

export async function getTemplate(id: string) {
  return (await listTemplates()).find((t) => t.id === id) ?? null;
}

// 서식 HTML — 공용 스타일을 앞에 붙인 렌더 원본
export async function templateSource(t: TemplateDef) {
  const r = await registry();
  const [css, html] = await Promise.all([readFile(resolveFile(r.style), "utf8"), readFile(resolveFile(t.file), "utf8")]);
  return `<style>\n${css}</style>\n${html}`;
}

// 서식 HTML의 자리표시자와 키 선언 불일치 — 선언 없는 자리표시자, 자리표시자 없는 선언
export function placeholderDrift(html: string, keys: Record<string, KeySpec>) {
  const used = new Set([...html.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]));
  return {
    undeclared: [...used].filter((k) => !(k in keys)),
    unused: Object.keys(keys).filter((k) => !used.has(k)),
  };
}
