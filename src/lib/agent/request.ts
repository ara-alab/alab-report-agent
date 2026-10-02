// Agent 요청 본문 검증 — 대화 이력·계정·작성 모드·서식 지정, 운영 route 와 개발 재생 route 공용
import "server-only";
import { getAccount, type Account } from "@/lib/accounts";
import { getTemplate } from "@/lib/drafting/templates";

const MAX_TURNS = 20;
const MAX_CHARS = 4000;

export type ChatTurn = { role: "user" | "assistant"; content: string };
// 작성 모드 — draft 는 초안 작성, ask 는 대화 답변, 미지정은 모델 판단
export type AgentMode = "draft" | "ask";
export type AgentOptions = { mode?: AgentMode; template?: { id: string; name: string } };

export class AgentRequestError extends Error {
  constructor(message: string, readonly code = "bad_request") {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 대화 형식 검증 — 역할·길이·마지막 발화 주체
function parseTurns(list: unknown): ChatTurn[] {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TURNS) throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
  const turns = list.map((m): ChatTurn => {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || m.content.trim() === "" || m.content.length > MAX_CHARS) {
      throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
    }
    return { role: m.role, content: m.content };
  });
  if (turns[turns.length - 1].role !== "user") throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
  return turns;
}

// 작성 모드·서식 지정 — 서식 지정은 작성 모드에서만
async function parseOptions(body: Record<string, unknown>): Promise<AgentOptions> {
  const { mode, template } = body;
  if (mode !== undefined && mode !== "draft" && mode !== "ask") throw new AgentRequestError('mode 는 "draft" 또는 "ask" 여야 합니다.');
  if (template !== undefined && mode !== "draft") throw new AgentRequestError('template 은 mode 가 "draft" 일 때만 쓸 수 있습니다.');
  const opts: AgentOptions = { mode };
  if (template !== undefined) {
    const t = typeof template === "string" ? await getTemplate(template) : null;
    if (!t) throw new AgentRequestError(`알 수 없는 서식입니다: ${String(template)}`);
    opts.template = { id: t.id, name: t.name };
  }
  return opts;
}

export async function parseAgentRequest(body: unknown): Promise<{ account: Account; turns: ChatTurn[]; options: AgentOptions }> {
  if (!isObj(body)) throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
  const turns = parseTurns(body.messages);
  const account = body.account === undefined || typeof body.account === "string" ? getAccount(body.account) : null;
  if (!account) throw new AgentRequestError("알 수 없는 계정입니다.", "bad_account");
  return { account, turns, options: await parseOptions(body) };
}
