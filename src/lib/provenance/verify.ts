// 정합성 검증 — 저장 수치의 출처 조회를 작성 계정 권한으로 다시 실행해 저장 값과 원본 값 대조
import "server-only";
import { getAccount, type Account } from "@/lib/accounts";
import { executeTool } from "@/lib/agent/tools";
import { RefError, walk } from "@/lib/drafting/refs";
import type { DraftContext } from "@/lib/drafting/tools";
import { getReport, type StoredNumber } from "@/lib/reports";

// 재조회 상한 — 보고서 1건의 서로 다른 출처 조회 수
const MAX_CALLS = 60;

export type VerifyStatus = "match" | "mismatch" | "missing" | "no_source";

export type VerifiedNumber = {
  key: string;
  label: string | null;
  status: VerifyStatus;
  stored: { value: number; numerator: number | null; denominator: number | null };
  current: { value: number; numerator: number | null; denominator: number | null } | null;
  queryId: string | null;
  path: string | null;
  reason?: string;
};

export type VerifySummary = { total: number; match: number; mismatch: number; missing: number; noSource: number; rate: number | null; calls: number };

export class VerifyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
// 저장 컬럼 DECIMAL(24,6) 기준 비교 — 원본 값을 소수 6자리로 반올림
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const same = (stored: number | null, current: number | null) => (stored === null || current === null ? stored === current : Math.abs(round6(current) - stored) < 5e-7);

export type Rerun = { result: unknown; queryId?: string } | { error: string };

// 작성 계정 확인 — 출처 조회는 작성 당시 계정 권한으로 재실행
export function authorOf(accountId: string): Account {
  const author = getAccount(accountId);
  if (!author) throw new VerifyError(`작성 계정을 찾을 수 없어 재조회할 수 없습니다: ${accountId}`);
  return author;
}

// 출처 조회 1건 재실행 — 새 실행 캐시에서 원본 전체 결과 확인
export async function rerunCall(call: { name: string; input: unknown }, author: Account): Promise<Rerun> {
  const ctx: DraftContext = { cache: new Map() };
  const outcome = await executeTool(call.name, call.input, author, ctx);
  const hit = outcome.queryId ? ctx.cache.get(outcome.queryId) : undefined;
  return outcome.isError || !hit ? { error: outcome.isError ? outcome.content.slice(0, 200) : "재조회 결과가 없습니다" } : { result: hit.result, queryId: outcome.queryId };
}

// 저장 수치 판정 — 재조회 결과에서 출처 경로 값을 찾아 값·분자·분모 대조, 찾은 값의 상위 객체 함께 반환
export function judgeNumber(n: StoredNumber, r: Rerun | null): { verified: VerifiedNumber; parent: unknown } {
  const stored = { value: Number(n.value), numerator: num(n.numerator), denominator: num(n.denominator) };
  const base = { key: n.key, label: n.label, stored, queryId: n.queryId, path: n.path };
  const fail = (status: VerifyStatus, reason?: string) => ({ verified: { ...base, status, current: null, ...(reason ? { reason } : {}) }, parent: null });
  if (!n.call || !n.path || !r) return fail("no_source");
  if ("error" in r) return fail("missing", r.error);
  if (n.queryId && r.queryId !== n.queryId) return fail("missing", `조회 ID 불일치: ${r.queryId}`);
  let found;
  try {
    found = walk(r.result, n.path);
  } catch (e) {
    if (!(e instanceof RefError)) throw e;
    return fail("missing", e.message);
  }
  if (typeof found.value !== "number" || !Number.isFinite(found.value)) return fail("missing", "원본 값이 숫자가 아닙니다");
  const p = found.parent as Record<string, unknown> | null;
  const ratio = stored.numerator !== null && p && typeof p.numerator === "number" && typeof p.denominator === "number";
  const current = { value: found.value, numerator: ratio ? (p.numerator as number) : null, denominator: ratio ? (p.denominator as number) : null };
  const ok = same(stored.value, current.value) && same(stored.numerator, current.numerator) && same(stored.denominator, current.denominator);
  return { verified: { ...base, status: ok ? "match" : "mismatch", current }, parent: found.parent };
}

export async function verifyReport(id: number, viewer: Account) {
  const report = await getReport(id, viewer);
  if (!report) throw new VerifyError("보고서를 찾을 수 없습니다.", 404);
  const author = authorOf(report.accountId);
  const numbers = report.numbers;
  const callKey = (c: { name: string; input: unknown }) => JSON.stringify([c.name, c.input]);
  const calls = new Map<string, { name: string; input: unknown }>();
  for (const n of numbers) if (n.call) calls.set(callKey(n.call), n.call);
  if (calls.size > MAX_CALLS) throw new VerifyError(`출처 조회가 ${calls.size}건으로 재조회 상한 ${MAX_CALLS}건을 넘습니다.`);
  // 출처 조회 재실행 — 서로 다른 조회만 순차 실행
  const reruns = new Map<string, Rerun>();
  for (const [k, c] of calls) reruns.set(k, await rerunCall(c, author));
  const out: VerifiedNumber[] = numbers.map((n) => judgeNumber(n, n.call ? reruns.get(callKey(n.call))! : null).verified);
  const count = (s: VerifyStatus) => out.filter((n) => n.status === s).length;
  const checked = count("match") + count("mismatch") + count("missing");
  const summary: VerifySummary = {
    total: out.length,
    match: count("match"),
    mismatch: count("mismatch"),
    missing: count("missing"),
    noSource: count("no_source"),
    // 일치율 — 출처 있는 수치 중 원본과 일치한 비율
    rate: checked ? count("match") / checked : null,
    calls: calls.size,
  };
  return { report: { id: report.id, docNo: report.docNo, accountId: report.accountId }, summary, numbers: out };
}
