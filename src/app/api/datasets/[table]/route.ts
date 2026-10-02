// 데이터셋 상세 — 컬럼 구조·설명, 행 수, 날짜 범위, 표본 3행, 계정 조회 범위 밖 테이블은 거부
import { getAccount } from "@/lib/accounts";
import { CatalogError, describeTable } from "@/lib/catalog";

export async function GET(request: Request, ctx: RouteContext<"/api/datasets/[table]">) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const { table } = await ctx.params;
  try {
    return Response.json(await describeTable(table, account.allowedTables));
  } catch (e) {
    if (e instanceof CatalogError) return Response.json({ error: e.message, code: "bad_table" }, { status: 400 });
    throw e;
  }
}
