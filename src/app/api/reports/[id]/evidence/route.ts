// 수치 근거 — 저장 수치 1건의 원본 재조회 값·조회 조건·원천 테이블, 조회 범위는 단건 조회와 동일
import { getAccount } from "@/lib/accounts";
import { numberEvidence } from "@/lib/provenance/evidence";
import { VerifyError } from "@/lib/provenance/verify";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]/evidence">) {
  const params = new URL(request.url).searchParams;
  const account = getAccount(params.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  // 수치 키 — 대괄호·#·마침표를 포함하므로 경로 대신 쿼리 파라미터로 수신
  const key = params.get("key");
  if (!key || key.length > 120) return Response.json({ error: "수치 키가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const started = Date.now();
  try {
    const out = await numberEvidence(id, key, account);
    // 근거 조회 기록 — 판정과 출처 도구, 수치 값은 미기록
    console.log(JSON.stringify({ type: "report_evidence", reportId: id, account: account.id, key, status: out.number.status, tool: out.source?.tool ?? null, durationMs: Date.now() - started }));
    return Response.json(out);
  } catch (e) {
    if (e instanceof VerifyError) return Response.json({ error: e.message, code: e.status === 404 ? "not_found" : "not_verifiable" }, { status: e.status });
    throw e;
  }
}
