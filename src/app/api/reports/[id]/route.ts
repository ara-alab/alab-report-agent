// 보고서 단건 — 계정 조회 범위 밖이면 없는 보고서로 응답
import { getAccount } from "@/lib/accounts";
import { getReport } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const report = await getReport(id, account);
  if (!report) return Response.json({ error: "보고서를 찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  return Response.json({ report });
}
