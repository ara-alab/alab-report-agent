// Agent 대화 진입점 — 대화 이력·계정 검증 후 tool 루프 진행 상황과 응답을 NDJSON 으로 중계
import { getAccount } from "@/lib/accounts";
import { runAgent, type ChatTurn } from "@/lib/agent/run";
import { PREMIUM_MODEL } from "@/lib/llm/client";
import { aiJsonResponse, runAiRequest } from "@/lib/llm/request";

const ROUTE = "agent";
const MAX_TURNS = 20;
const MAX_CHARS = 4000;

// 대화 이력 형식 검증 — 역할·길이·마지막 발화 주체
function parseMessages(body: unknown): ChatTurn[] | null {
  const list = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TURNS) return null;
  const turns = list.map((m) => m as Partial<ChatTurn>);
  const valid = turns.every(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "" && m.content.length <= MAX_CHARS,
  );
  if (!valid || turns[turns.length - 1].role !== "user") return null;
  return turns as ChatTurn[];
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const messages = parseMessages(body);
  if (!messages) return Response.json({ error: "대화 형식이 올바르지 않습니다.", code: "bad_request" }, { status: 400 });
  const accountId = (body as { account?: unknown }).account;
  const account = accountId === undefined || typeof accountId === "string" ? getAccount(accountId) : null;
  if (!account) return Response.json({ error: "알 수 없는 계정입니다.", code: "bad_account" }, { status: 400 });

  return runAiRequest(request, { route: ROUTE, timeoutMs: 180_000 }, async () =>
    aiJsonResponse(async (line) => {
      line({ type: "start", model: PREMIUM_MODEL, account: account.id });
      await runAgent(ROUTE, account, messages, line);
    }),
  );
}
