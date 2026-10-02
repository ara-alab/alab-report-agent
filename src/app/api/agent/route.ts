// Agent 대화 진입점 — 대화 이력·계정·작성 모드 검증 후 tool 루프 진행 상황과 응답을 NDJSON 으로 중계
import { runRecordEnabled, startRunRecord } from "@/lib/agent/record";
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
      // 실행 기록 — 환경변수 설정 시 화면에 보내는 이벤트를 그대로 보관, 기록 ID는 start 이벤트로 전달
      const record = runRecordEnabled()
        ? startRunRecord({
            route: ROUTE,
            account: account.id,
            request: turns[turns.length - 1]?.content ?? "",
            mode: options.mode ?? null,
            template: options.template?.id ?? null,
            report: options.report?.id ?? null,
            section: options.section ?? null,
            turns: turns.length,
          })
        : null;
      const out = record
        ? (value: unknown) => {
            record.push(value);
            line(value);
          }
        : line;
      let completed = false;
      try {
        out({ type: "start", model: PREMIUM_MODEL, account: account.id, ...(record ? { runId: record.id } : {}) });
        await runAgent(ROUTE, account, turns, out, options);
        completed = true;
      } finally {
        await record?.finish(!completed);
      }
    }),
  );
}
