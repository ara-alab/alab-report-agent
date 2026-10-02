// 개발 확인용 — LLM 없이 tool 호출 순서를 그대로 실행(POST {account, calls:[{name, input}]}), 한 실행 문맥 공유, 운영 빌드에선 404
import { getAccount } from "@/lib/accounts";
import { executeTool } from "@/lib/agent/tools";
import type { DraftContext } from "@/lib/drafting/tools";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { account?: unknown; calls?: unknown; request?: unknown };
  const account = typeof body.account === "string" || body.account === undefined ? getAccount(body.account) : null;
  if (!account) return Response.json({ error: "알 수 없는 계정입니다." }, { status: 400 });
  if (!Array.isArray(body.calls)) return Response.json({ error: "calls 배열이 필요합니다." }, { status: 400 });
  const ctx: DraftContext = { cache: new Map(), requestText: typeof body.request === "string" ? body.request : undefined };
  const results = [];
  for (const c of body.calls as { name?: unknown; input?: unknown }[]) {
    const out = await executeTool(String(c?.name ?? ""), c?.input ?? {}, account, ctx);
    results.push({ name: c?.name, ok: !out.isError, queryId: out.queryId, errorKind: out.errorKind, issues: out.issues, content: out.content.length > 4000 ? out.content.slice(0, 4000) + "…" : out.content });
  }
  return Response.json({ results, draft: ctx.draft ?? null, saved: ctx.saved ?? null });
}
