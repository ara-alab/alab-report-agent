// 데이터셋 목록 — 계정 조회 범위의 테이블과 업무 이름·분류·설명·적재 기간
import { getAccount } from "@/lib/accounts";
import { dataPeriods, listDatasets } from "@/lib/catalog";

export async function GET(request: Request) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });
  const [datasets, periods] = await Promise.all([listDatasets(account.allowedTables), dataPeriods(account.allowedTables)]);
  const byTable = new Map(periods.map((p) => [p.table, p]));
  return Response.json({
    datasets: datasets.map((d) => {
      const p = byTable.get(d.table);
      return { ...d, period: p ? { column: p.column, min: p.min, max: p.max } : null };
    }),
  });
}
