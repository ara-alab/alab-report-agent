// 보고서 정합성 검증 — 저장 수치를 출처 조회 재실행 결과와 대조, 조회 범위는 단건 조회와 동일
import { getAccount } from "@/lib/accounts";
import { VerifyError, verifyReport } from "@/lib/provenance/verify";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]/verify">) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const started = Date.now();
  try {
    const out = await verifyReport(id, account);
    // 검증 기록 — 판정별 건수와 재조회 수, 수치 값은 미기록
    console.log(JSON.stringify({ type: "report_verify", reportId: id, account: account.id, ...out.summary, durationMs: Date.now() - started }));
    return Response.json(out);
  } catch (e) {
    if (e instanceof VerifyError) return Response.json({ error: e.message, code: e.status === 404 ? "not_found" : "not_verifiable" }, { status: e.status });
    throw e;
  }
}
