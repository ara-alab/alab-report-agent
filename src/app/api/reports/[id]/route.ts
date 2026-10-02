// 보고서 단건 — 채움 값·수치와 저장 값으로 다시 그린 지면 HTML, 계정 조회 범위 밖이면 없는 보고서로 응답
import { getAccount } from "@/lib/accounts";
import { reportEditable } from "@/lib/agent/run";
import { renderSaved } from "@/lib/drafting/draft";
import { getReport, getReportDraft } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const report = await getReport(id, account);
  if (!report) return Response.json({ error: "보고서를 찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  // 수정 가능 표시 — 기안 기록 존재에 더해 현재 데이터·검증 규칙으로 다시 검증되는 경우만
  if (report.editable && !(await reportEditable(await getReportDraft(id, account), account))) {
    report.editable = false;
    report.editBlock = "not_replayable";
  }
  // 수치 표시 — 저장된 출처 기록 수치 키만 근거 선택 대상
  const numKeys = new Set(report.numbers.map((n) => n.key));
  return Response.json({ report, html: await renderSaved(report.templateId, report.fills, numKeys) });
}
