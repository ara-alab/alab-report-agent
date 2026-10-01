// 개발 확인용 — 조회 함수 직접 호출(?name=&from=&to=...), 운영 빌드에선 404
import { QueryParamError, listQueries, runQuery } from "@/lib/queries";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { name, ...raw } = params;
  if (!name) return Response.json({ queries: listQueries().map((q) => ({ name: q.name, description: q.description, inputSchema: q.inputSchema })) });
  try {
    return Response.json(await runQuery(name, raw));
  } catch (e) {
    if (e instanceof QueryParamError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
