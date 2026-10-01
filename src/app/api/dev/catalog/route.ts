// 개발 확인용 — 스키마 카탈로그 조회(?table=&account=), 이름 생략 시 목록과 설명·계정·조회 함수 설정 불일치, 운영 빌드에선 404
import { accountDrift, getAccount } from "@/lib/accounts";
import { CatalogError, catalogDrift, describeTable, listDatasets, listTableNames } from "@/lib/catalog";
import { listQueries } from "@/lib/queries";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const table = params.get("table");
  const accountId = params.get("account");
  const account = accountId ? getAccount(accountId) : null;
  if (accountId && !account) return Response.json({ error: `알 수 없는 계정입니다: ${accountId}` }, { status: 400 });
  const allowed = account?.allowedTables;
  if (!table) {
    const names = await listTableNames();
    // 조회 함수 선언 테이블 중 실제 스키마에 없는 이름
    const queries = listQueries().flatMap((q) => q.tables.filter((t) => !names.includes(t)).map((t) => `${q.name}: 없는 테이블 ${t}`));
    return Response.json({
      datasets: await listDatasets(allowed),
      drift: { ...(await catalogDrift()), accounts: accountDrift(names), queries },
    });
  }
  try {
    return Response.json(await describeTable(table, allowed));
  } catch (e) {
    if (e instanceof CatalogError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
