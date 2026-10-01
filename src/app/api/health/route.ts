// 서버 상태 확인 — DB 연결과 LLM 키 설정 여부, 모델 호출 없음
import { pingDb } from "@/lib/db";

export async function GET() {
  const db = await pingDb();
  const llm = { configured: !!process.env.ANTHROPIC_API_KEY };
  return Response.json({ ok: db.ok && llm.configured, db, llm }, { status: db.ok ? 200 : 503 });
}
