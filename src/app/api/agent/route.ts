// Agent 대화 진입점 — 대화 이력·계정·작성 모드 검증 후 tool 루프 진행 상황과 응답을 NDJSON 으로 중계
import { AgentRequestError, parseAgentRequest } from "@/lib/agent/request";
import { runAgent } from "@/lib/agent/run";
import { PREMIUM_MODEL } from "@/lib/llm/client";
import { aiJsonResponse, runAiRequest } from "@/lib/llm/request";

const ROUTE = "agent";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  let parsed: Awaited<ReturnType<typeof parseAgentRequest>>;
  try {
    parsed = await parseAgentRequest(body);
  } catch (e) {
    if (e instanceof AgentRequestError) return Response.json({ error: e.message, code: e.code }, { status: 400 });
    throw e;
  }
  const { account, turns, options } = parsed;

  return runAiRequest(request, { route: ROUTE, timeoutMs: 300_000 }, async () =>
    aiJsonResponse(async (line) => {
      line({ type: "start", model: PREMIUM_MODEL, account: account.id });
      await runAgent(ROUTE, account, turns, line, options);
    }),
  );
}
