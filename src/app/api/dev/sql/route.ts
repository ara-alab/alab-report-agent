// 개발 확인용 — run_sql 직접 호출(POST {sql, account}), 가드 거부·실행 오류는 400, 운영 빌드에선 404
import { getAccount } from "@/lib/accounts";
import { SqlGuardError, runSql } from "@/lib/queries/sql";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { sql?: unknown; account?: unknown };
  const account = typeof body.account === "string" || body.account === undefined ? getAccount(body.account) : null;
  if (!account) return Response.json({ error: "알 수 없는 계정입니다." }, { status: 400 });
  if (typeof body.sql !== "string") return Response.json({ error: "sql 문자열이 필요합니다." }, { status: 400 });
  try {
    return Response.json(await runSql(body.sql, account));
  } catch (e) {
    if (e instanceof SqlGuardError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
