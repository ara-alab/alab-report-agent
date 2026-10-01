// 샘플 계정 목록 — 화면 계정 칩 전환용
import { ACCOUNTS, DEFAULT_ACCOUNT_ID, publicAccount } from "@/lib/accounts";

export function GET() {
  return Response.json({ defaultId: DEFAULT_ACCOUNT_ID, accounts: ACCOUNTS.map(publicAccount) });
}
