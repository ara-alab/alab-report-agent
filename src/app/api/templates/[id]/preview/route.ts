// 서식 틀 — 채움 값 없이 계정·시스템 키만 채운 지면 HTML, 초안 도착 전 지면 표시용
import { getAccount } from "@/lib/accounts";
import { accountFills, systemFills } from "@/lib/drafting/meta";
import { renderTemplate } from "@/lib/drafting/render";
import { getTemplate, templateSource } from "@/lib/drafting/templates";

export async function GET(request: Request, ctx: RouteContext<"/api/templates/[id]/preview">) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const t = await getTemplate((await ctx.params).id);
  if (!t) return Response.json({ error: "서식을 찾을 수 없습니다.", code: "not_found" }, { status: 404 });
  const html = renderTemplate(await templateSource(t), t.keys, { ...accountFills(account), ...systemFills(null) });
  return Response.json({ template: { id: t.id, name: t.name }, html });
}
