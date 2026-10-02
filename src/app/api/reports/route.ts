// 보고서 목록·저장 — 계정별 조회 범위 적용, 저장 시 문서번호 발번
import { getAccount } from "@/lib/accounts";
import { ReportError, listReports, saveReport, type SaveInput } from "@/lib/reports";

const badAccount = () => Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });

export async function GET(request: Request) {
  const account = getAccount(new URL(request.url).searchParams.get("account"));
  if (!account) return badAccount();
  return Response.json({ reports: await listReports(account) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (SaveInput & { account?: unknown }) | null;
  if (!body || typeof body !== "object") return Response.json({ error: "요청 형식이 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const account = body.account === undefined || typeof body.account === "string" ? getAccount(body.account) : null;
  if (!account) return badAccount();
  if (body.id !== undefined && !Number.isSafeInteger(body.id)) return Response.json({ error: "보고서 ID가 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  try {
    return Response.json({ report: await saveReport(body, account) });
  } catch (e) {
    if (e instanceof ReportError) return Response.json({ error: e.message, code: "bad_report" }, { status: e.status });
    throw e;
  }
}
