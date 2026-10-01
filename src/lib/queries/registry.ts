// 조회 함수 등록부 — Agent tool 정의와 실행의 단일 원천
import "server-only";
import { createHash } from "node:crypto";
import type { QueryResult } from "@/lib/db";

// 파라미터 검증 실패 — route 는 400, Agent 는 tool 오류로 처리
export class QueryParamError extends Error {}

export type QueryDef<P extends Record<string, unknown>> = {
  name: string;
  description: string;
  // Anthropic tool input_schema 로 그대로 전달하는 JSON Schema
  inputSchema: Record<string, unknown>;
  // 참조 테이블 — 계정 조회 범위 밖 테이블을 쓰는 함수는 tool 목록에서 제외
  tables: readonly string[];
  parse: (raw: Record<string, unknown>) => P;
  run: (params: P) => Promise<QueryResult<Record<string, unknown>>>;
};

export type QueryOutput = QueryResult<Record<string, unknown>> & {
  queryId: string;
  name: string;
  params: Record<string, unknown>;
};

const registry = new Map<string, QueryDef<Record<string, unknown>>>();

export function defineQuery<P extends Record<string, unknown>>(def: QueryDef<P>): QueryDef<P> {
  registry.set(def.name, def as unknown as QueryDef<Record<string, unknown>>);
  return def;
}

export function listQueries(): QueryDef<Record<string, unknown>>[] {
  return [...registry.values()];
}

// 출처 ID — 함수명과 키 정렬 파라미터로 결정, 같은 조회는 같은 ID
export function queryIdOf(name: string, params: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.keys(params).sort().filter((k) => params[k] !== undefined).map((k) => [k, params[k]]));
  return `${name}#${createHash("sha1").update(canonical).digest("hex").slice(0, 10)}`;
}

export async function runQuery(name: string, raw: Record<string, unknown>): Promise<QueryOutput> {
  const def = registry.get(name);
  if (!def) throw new QueryParamError(`등록되지 않은 조회 함수입니다: ${name}`);
  const params = def.parse(raw);
  const result = await def.run(params);
  return { queryId: queryIdOf(name, params), name, params, ...result };
}

// ── 공용 파라미터 검증

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 코드값은 바인딩 파라미터로만 전달 — 제어 문자만 제외하고 한글·공백·기호 허용
const CODE_RE = /^[^\p{Cc}]{1,50}$/u;

export function dateParam(raw: unknown, key: string): string {
  const v = String(raw ?? "");
  const d = new Date(`${v}T00:00:00Z`);
  if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new QueryParamError(`${key} 는 YYYY-MM-DD 형식의 날짜여야 합니다.`);
  }
  return v;
}

export function periodParams(raw: Record<string, unknown>): { from: string; to: string } {
  const from = dateParam(raw.from, "from");
  const to = dateParam(raw.to, "to");
  if (from > to) throw new QueryParamError("from 은 to 보다 늦을 수 없습니다.");
  return { from, to };
}

export function codeParam(raw: unknown, key: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw);
  if (!CODE_RE.test(v)) throw new QueryParamError(`${key} 값 형식이 올바르지 않습니다.`);
  return v;
}

export function enumParam<T extends string>(raw: unknown, key: string, allowed: readonly T[], fallback: T): T {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (!allowed.includes(raw as T)) throw new QueryParamError(`${key} 는 ${allowed.join(", ")} 중 하나여야 합니다.`);
  return raw as T;
}
