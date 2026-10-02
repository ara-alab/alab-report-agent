// 보고서 파일 내보내기 — 저장 값으로 다시 그린 서식 지면을 HWPX 로 변환, 계정 조회 범위 밖이면 없는 보고서로 응답
import { getAccount } from "@/lib/accounts";
import { renderSaved } from "@/lib/drafting/draft";
import { htmlToHwpx } from "@/lib/export/hwpx";
import { getReport } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[id]/export">) {
  const params = new URL(request.url).searchParams;
  const account = getAccount(params.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const format = params.get("format") ?? "hwpx";
  if (format !== "hwpx") return Response.json({ error: "지원하지 않는 파일 형식입니다.", code: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const report = await getReport(id, account);
  if (!report) return Response.json({ error: "보고서를 찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  const html = await renderSaved(report.templateId, report.fills);
  if (!html) return Response.json({ error: "보고서 서식을 찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  const file = htmlToHwpx(html, report.title);
  // 파일 이름 — 문서번호
  const name = `${report.docNo}.hwpx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/hwp+zip",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
