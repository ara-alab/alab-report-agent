// 개발 확인용 — 분석 tool 직접 호출(POST {name, input, account}), 입력 오류는 400, 운영 빌드에선 404
import { getAccount } from "@/lib/accounts";
import { runAnalysis } from "@/lib/analysis";
import { QueryParamError } from "@/lib/queries";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; input?: unknown; account?: unknown };
  const account = typeof body.account === "string" || body.account === undefined ? getAccount(body.account) : null;
  if (!account) return Response.json({ error: "알 수 없는 계정입니다." }, { status: 400 });
  const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;
  try {
    const out = await runAnalysis(String(body.name ?? ""), input, account);
    return out ? Response.json(out) : Response.json({ error: `사용할 수 없는 분석 도구입니다: ${String(body.name)}` }, { status: 400 });
  } catch (e) {
    if (e instanceof QueryParamError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
