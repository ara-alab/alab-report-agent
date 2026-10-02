// Agent 요청 본문 검증 — 대화 이력(턴별 조회·초안 이력 포함)·계정·작성 모드·서식 지정, 운영 route 와 개발 재생 route 공용
import "server-only";
import { getAccount, type Account } from "@/lib/accounts";
import { getTemplate } from "@/lib/drafting/templates";
import { isReusableQuery } from "./tools";

const MAX_TURNS = 20;
const MAX_CHARS = 4000;
// 이전 턴 조회 이력 상한 — 턴당·전체 건수, 입력 1건 JSON 길이
const MAX_TURN_QUERIES = 30;
const MAX_TOTAL_QUERIES = 60;
const MAX_QUERY_INPUT_CHARS = 2000;
// 이전 턴 초안 기안 입력 JSON 길이 상한
const MAX_DRAFT_INPUT_CHARS = 40_000;

export type HistoryQuery = { name: string; input: Record<string, unknown> };
// 이전 턴 초안 — 서버가 검증한 기안 입력(draft 이벤트 input)과 저장 결과
export type HistoryDraft = { input: Record<string, unknown>; saved?: { id: number; docNo: string } };
export type ChatTurn = { role: "user" | "assistant"; content: string; queries?: HistoryQuery[]; draft?: HistoryDraft };
// 작성 모드 — draft 는 초안 작성, ask 는 대화 답변, 미지정은 모델 판단
export type AgentMode = "draft" | "ask";
export type AgentOptions = { mode?: AgentMode; template?: { id: string; name: string } };

export class AgentRequestError extends Error {
  constructor(message: string, readonly code = "bad_request") {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseQueries(raw: unknown, at: number): HistoryQuery[] {
  if (!Array.isArray(raw) || raw.length > MAX_TURN_QUERIES) throw new AgentRequestError(`messages[${at}].queries 는 ${MAX_TURN_QUERIES}건 이하 배열이어야 합니다.`);
  return raw.map((q, i) => {
    if (!isObj(q) || typeof q.name !== "string" || !isObj(q.input) || JSON.stringify(q.input).length > MAX_QUERY_INPUT_CHARS) {
      throw new AgentRequestError(`messages[${at}].queries[${i}] 는 {name, input} 이고 input 은 ${MAX_QUERY_INPUT_CHARS}자 이하여야 합니다.`);
    }
    return { name: q.name, input: q.input };
  });
}

function parseDraft(raw: unknown, at: number): HistoryDraft {
  const bad = () => new AgentRequestError(`messages[${at}].draft 는 {input, saved?} 이고 input 은 ${MAX_DRAFT_INPUT_CHARS}자 이하 객체여야 합니다.`);
  if (!isObj(raw) || !isObj(raw.input) || JSON.stringify(raw.input).length > MAX_DRAFT_INPUT_CHARS) throw bad();
  if (raw.saved === undefined) return { input: raw.input };
  const s = raw.saved;
  if (!isObj(s) || !Number.isSafeInteger(s.id) || typeof s.docNo !== "string") throw bad();
  return { input: raw.input, saved: { id: Number(s.id), docNo: s.docNo } };
}

// 대화 형식 검증 — 역할·길이·마지막 발화 주체, 조회·초안 이력은 assistant 턴에만
function parseTurns(list: unknown): ChatTurn[] {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TURNS) throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
  let total = 0;
  const turns = list.map((m, i): ChatTurn => {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || m.content.trim() === "" || m.content.length > MAX_CHARS) {
      throw new AgentRequestError("대화 형식이 올바르지 않습니다.");
    }
    if (m.queries === undefined && m.draft === undefined) return { role: m.role, content: m.content };
    if (m.role !== "assistant") throw new AgentRequestError(`messages[${i}].queries·draft 는 assistant 발화에만 둘 수 있습니다.`);
    const turn: ChatTurn = { role: m.role, content: m.content };
    if (m.queries !== undefined) {
      turn.queries = parseQueries(m.queries, i);
      total += turn.queries.length;
    }
    if (m.draft !== undefined) turn.draft = parseDraft(m.draft, i);
    return turn;
  });
  if (total > MAX_TOTAL_QUERIES) throw new AgentRequestError(`이전 턴 조회 이력은 전체 ${MAX_TOTAL_QUERIES}건 이하여야 합니다.`);
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
  for (const t of turns) {
    const bad = t.queries?.find((q) => !isReusableQuery(q.name, account));
    if (bad) throw new AgentRequestError(`이전 턴 조회로 재실행할 수 없는 도구입니다: ${bad.name}`);
  }
  return { account, turns, options: await parseOptions(body) };
}
