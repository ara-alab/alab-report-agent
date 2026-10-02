// Agent 루프 — 모델 응답의 tool 호출을 실행해 결과를 돌려주는 과정을 상한 내에서 반복
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { Account } from "@/lib/accounts";
import { getAnthropic, withPremiumModel } from "@/lib/llm/client";
import { aiRequestOptions } from "@/lib/llm/request-context";
import { consumeAiStream } from "@/lib/llm/stream";
import { DraftError, LIMITS } from "@/lib/drafting/draft";
import { draftRecord, isDraftingTool, restoreDraft, sectionField, type DraftContext } from "@/lib/drafting/tools";
import { getTemplate, type KeySpec } from "@/lib/drafting/templates";
import { systemPrompt } from "./prompt";
import type { AgentOptions, ChatTurn, ReportContext } from "./request";
import { buildTools, executeTool, isReusableQuery } from "./tools";

// 모델 호출 상한 — 마지막 호출은 tool 없이 답변만 강제
const MAX_STEPS = 10;
// 호출당 출력 상한 — 초과 시 잘린 응답은 버리고 축약 재작성 지시
const MAX_TOKENS = 8000;
// 잘린 tool 입력 로그 상한
const TRUNCATED_LOG_CHARS = 20_000;
const RETRY_NOTE = "직전 응답이 출력 한도에 걸려 잘렸습니다. 더 짧게 다시 작성하세요. 조회 결과 배열을 옮기는 표는 from 방식으로, 서술은 섹션당 2~4문장으로 씁니다.";

// 마지막 사용자 발화에 지시 문단 추가 — 문자열 발화는 블록 배열로 변환
function appendNote(messages: Anthropic.MessageParam[], text: string) {
  const tail = messages[messages.length - 1];
  const blocks = typeof tail.content === "string" ? [{ type: "text" as const, text: tail.content }] : tail.content;
  tail.content = [...blocks, { type: "text", text }];
}

// 프롬프트 캐시 중단점 — 마지막 발화의 끝 블록에 지정, 단계마다 대화 끝으로 이동해 이전 단계까지 재사용
function withCacheTail(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const tail = messages[messages.length - 1];
  const blocks = typeof tail.content === "string" ? [{ type: "text" as const, text: tail.content }] : tail.content;
  const last = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...tail, content: [...blocks.slice(0, -1), last] }];
}

// 모델 스트림 생성 — 기본은 API 호출, 개발 검증에서 재생 스트림으로 교체
export type OpenStream = (params: Anthropic.MessageStreamParams) => MessageStream;
const openApiStream: OpenStream = (params) => getAnthropic().messages.stream(params, aiRequestOptions());

// 작성 모드 지시 — tool 정의·시스템 프롬프트는 모드와 무관하게 공통, 지시는 마지막 사용자 발화 끝에만 추가
function modeNote(opts: AgentOptions): string | null {
  if (opts.mode === "ask") return "[질문 모드] 이번 요청은 대화 답변 요청입니다. 보고서 초안을 작성·저장하지 않고 조회 결과로 답합니다.";
  if (opts.mode !== "draft") return null;
  const fixed = opts.template ? ` 서식은 ${opts.template.name}(${opts.template.id})로 지정되어 있으며 다른 서식으로 바꾸지 않습니다.` : "";
  return `[작성 모드] 이번 요청은 보고서 초안 작성 요청입니다. 필요한 조회를 마친 뒤 draft_report 로 초안을 작성합니다.${fixed}`;
}
// 섹션 수정 지시 — 화면에서 고른 키 하나만 revise 로 교체
// 섹션 글자 수 상한 — 제목·메타·문단은 키 전체, 목록은 항목당, 지표·표는 미표시
function sectionLimit(key: string, spec: KeySpec): string {
  if (key === "doc_title") return ` 글자 수 상한 ${LIMITS.title}자.`;
  if (spec.kind === "meta") return ` 글자 수 상한 ${LIMITS.meta}자.`;
  if (spec.kind === "text") return ` 글자 수 상한 ${LIMITS.text}자.`;
  if (spec.kind === "list") return ` 글자 수 상한 항목당 ${LIMITS.listItem}자.`;
  return "";
}
const sectionNote = (key: string, spec: KeySpec) =>
  `[섹션 수정] 이번 요청은 현재 초안의 「${spec.label}」(${key}) 섹션 수정 요청입니다. 필요하면 조회를 추가한 뒤 draft_report 를 revise: true 와 ${sectionField(key)} 만으로 호출하고, 다른 키는 바꾸지 않습니다. 기존 값의 문체·길이·구성을 유지하되 작성 방법과 다른 부분은 작성 방법을 따르고 요청한 부분만 바꿉니다.${sectionLimit(key, spec)}${spec.guide ? ` 작성 방법: ${spec.guide}` : ""} 응답은 수정한 섹션과 변경 요지 1~2줄만 적습니다.`;

// 저장본 재검증 — 기안 기록의 조회를 다시 실행하고 기안 입력을 다시 검증, 호출·결과 블록과 제외 조회·초안 오류 반환
async function replayReport(report: ReportContext, account: Account, ctx: DraftContext) {
  const uses: Anthropic.ToolUseBlockParam[] = [];
  const results: Anthropic.ToolResultBlockParam[] = [];
  const drops: { name: string; error: string }[] = [];
  for (const [n, q] of report.draft.queries.entries()) {
    const outcome = isReusableQuery(q.name, account) ? await executeTool(q.name, q.input, account, ctx) : null;
    if (!outcome || outcome.isError || !outcome.queryId) {
      drops.push({ name: q.name, error: outcome?.content.slice(0, 500) ?? "재실행할 수 없는 도구" });
      continue;
    }
    const id = `toolu_report_${n}`;
    uses.push({ type: "tool_use", id, name: q.name, input: q.input as Record<string, unknown> });
    results.push({ type: "tool_result", tool_use_id: id, content: outcome.content });
  }
  try {
    const content = await restoreDraft(report.draft.input, { id: report.id, docNo: report.docNo }, report.requestText, account, ctx);
    uses.push({ type: "tool_use", id: "toolu_report_draft", name: "draft_report", input: report.draft.input });
    results.push({ type: "tool_result", tool_use_id: "toolu_report_draft", content });
    return { uses, results, drops, error: null };
  } catch (e) {
    if (!(e instanceof DraftError)) throw e;
    return { uses, results, drops, error: e.message };
  }
}

// 저장본 수정 가능 여부 — 현재 데이터와 검증 규칙으로 기안 기록이 다시 검증되는지
export async function reportEditable(report: ReportContext, account: Account) {
  return (await replayReport(report, account, { cache: new Map() })).error === null;
}

// 저장본 복원 — 재검증한 기안 기록을 대화 앞에 저장본 열기 턴으로 배치, 실패 시 갱신 대상 미설정
async function restoreReport(route: string, report: ReportContext, account: Account, ctx: DraftContext): Promise<Anthropic.MessageParam[]> {
  const r = await replayReport(report, account, ctx);
  for (const d of r.drops) console.log(JSON.stringify({ type: "agent_history_drop", route, report: report.id, ...d }));
  if (r.error !== null) {
    console.log(JSON.stringify({ type: "agent_history_drop", route, report: report.id, name: "draft_report", error: r.error.slice(0, 500) }));
    return [];
  }
  ctx.target = { id: report.id, docNo: report.docNo };
  return [
    { role: "user", content: `[저장 보고서 ${report.docNo} 열기] 기안 요청: ${report.requestText ?? "(기록 없음)"}` },
    { role: "assistant", content: r.uses },
    { role: "user", content: r.results },
    { role: "assistant", content: `저장 보고서 ${report.docNo}의 초안을 불러왔습니다.` },
  ];
}
// 작성 모드 재지시 — 이번 실행에서 초안 작성·저장 없이 끝나려 할 때 1회
const DRAFT_NUDGE = "작성 모드 요청인데 초안이 아직 작성되지 않았습니다. 조회 결과로 draft_report 를 호출해 초안을 작성하세요.";
const PICK_TEMPLATE = "서식을 선택해 주세요.";

// 이전 턴 복원 — assistant 턴의 조회를 다시 실행해 캐시에 넣고 tool 호출·결과 블록으로 재구성, 실패 조회는 제외하고 기록
// 초안은 가장 최근 턴의 기안 입력 하나만 그때까지 복원한 조회로 다시 검증해 기안 문맥에 복원
async function restoreHistory(route: string, turns: ChatTurn[], account: Account, ctx: DraftContext): Promise<Anthropic.MessageParam[]> {
  const messages: Anthropic.MessageParam[] = [];
  let draftTurn = -1;
  turns.forEach((turn, t) => {
    if (turn.draft) draftTurn = t;
  });
  for (const [t, turn] of turns.entries()) {
    const uses: Anthropic.ToolUseBlockParam[] = [];
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const [n, q] of (turn.queries ?? []).entries()) {
      const outcome = isReusableQuery(q.name, account) ? await executeTool(q.name, q.input, account, ctx) : null;
      if (!outcome || outcome.isError || !outcome.queryId) {
        console.log(JSON.stringify({ type: "agent_history_drop", route, turn: t, name: q.name, error: outcome?.content.slice(0, 500) ?? "재실행할 수 없는 도구" }));
        continue;
      }
      const id = `toolu_hist_${t}_${n}`;
      uses.push({ type: "tool_use", id, name: q.name, input: q.input });
      results.push({ type: "tool_result", tool_use_id: id, content: outcome.content });
    }
    if (t === draftTurn && turn.draft) {
      try {
        const content = await restoreDraft(turn.draft.input, turn.draft.saved, turns[t - 1]?.content, account, ctx);
        const id = `toolu_hist_${t}_draft`;
        uses.push({ type: "tool_use", id, name: "draft_report", input: turn.draft.input });
        results.push({ type: "tool_result", tool_use_id: id, content });
      } catch (e) {
        if (!(e instanceof DraftError)) throw e;
        console.log(JSON.stringify({ type: "agent_history_drop", route, turn: t, name: "draft_report", error: e.message.slice(0, 500) }));
      }
    }
    if (uses.length) messages.push({ role: "assistant", content: uses }, { role: "user", content: results });
    messages.push({ role: turn.role, content: turn.content });
  }
  return messages;
}

type RunOptions = AgentOptions & { openStream?: OpenStream };

export async function runAgent(route: string, account: Account, turns: ChatTurn[], line: (value: unknown) => void, opts: RunOptions = {}) {
  const openStream = opts.openStream ?? openApiStream;
  // 시스템 프롬프트 캐시 — tool 정의와 시스템 프롬프트 접두를 요청 내 단계 간 재사용
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: await systemPrompt(account), cache_control: { type: "ephemeral" } }];
  const tools = buildTools(account);
  // 기안 문맥 — 조회 결과 캐시는 이전 턴 조회 재실행분과 이번 실행분, 작성 모드·고정 서식
  const ctx: DraftContext = { cache: new Map(), requestText: turns[turns.length - 1]?.content, mode: opts.mode, fixedTemplate: opts.template?.id, section: opts.section };
  const opened = opts.report ? await restoreReport(route, opts.report, account, ctx) : [];
  const messages = [...opened, ...(await restoreHistory(route, turns, account, ctx))];
  // 복원 초안·저장 상태 — 이번 실행의 새 초안·저장 여부 판정 기준
  const restored = { draft: ctx.draft, saved: ctx.saved };
  // 실행 조건 기록 — 모드·서식 지정과 이전 턴 조회·초안의 전송·복원 건수, 요청·답변 본문은 미기록
  const histUses = messages.flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_use");
  console.log(
    JSON.stringify({
      type: "agent_run",
      route,
      account: account.id,
      mode: opts.mode ?? null,
      template: opts.template?.id ?? null,
      report: opts.report?.id ?? null,
      section: opts.section ?? null,
      turns: turns.length,
      historyQueries: turns.reduce((n, t) => n + (t.queries?.length ?? 0), 0),
      restoredQueries: histUses.filter((b) => b.name !== "draft_report").length,
      historyDraft: turns.some((t) => t.draft),
      restoredDraft: Boolean(restored.draft),
      savedId: restored.saved?.id ?? null,
    }),
  );
  // 실행 전 거부 — 저장본 복원 실패, 수정할 초안 없음·수정 불가 섹션
  const stop = (error: string, code: string) => {
    line({ type: "error", error, code });
    line({ type: "done", steps: 0, sources: [], queries: [], usage: { input_tokens: 0, output_tokens: 0 } });
  };
  if (opts.report && !ctx.target) return stop("저장 보고서의 기안 기록을 현재 데이터로 다시 검증하지 못해 수정할 수 없습니다.", "report_not_editable");
  let note = modeNote(opts);
  if (opts.section) {
    const spec = ctx.draft ? (await getTemplate(ctx.draft.template.id))?.keys[opts.section] : undefined;
    if (!ctx.draft) return stop("수정할 초안이 없습니다. 초안을 작성하거나 저장 보고서를 연 뒤 섹션을 지정하세요.", "no_draft");
    // 수정 가능 섹션 — 시스템·계정 키와 LLM 서술이 아닌 메타(대상 기간 등) 제외
    if (!spec || spec.by === "system" || spec.by === "account" || (spec.kind === "meta" && spec.by !== "llm")) return stop(`이 서식에서 수정할 수 없는 섹션입니다: ${opts.section}`, "bad_section");
    note = sectionNote(opts.section, spec);
  }
  if (note) appendNote(messages, note);
  const sources = new Set<string>();
  // 이번 실행의 재실행 가능 조회 — 다음 요청의 assistant 턴 queries 로 되돌려 받는 목록
  const reusable = new Map<string, { name: string; input: unknown }>();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let wrote = false;
  let nudged = false;
  let last: Anthropic.Message | null = null;
  let calls = 0;   // 이번 실행의 모델 호출 수 — 이전 대화 턴 제외

  for (let step = 1; step <= MAX_STEPS; step++) {
    const final = step === MAX_STEPS;
    // 호출 상한 도달 — tool 결과만 있는 마지막 발화에 답변 작성 지시 추가
    const tail = messages[messages.length - 1];
    if (final && Array.isArray(tail.content)) appendNote(messages, "도구 호출 한도에 도달했습니다. 지금까지 조회한 결과만으로 답변을 작성하세요.");
    // 이번 호출의 tool 입력 조각 — 출력 상한으로 잘린 경우 원문 기록용
    const partial = new Map<number, { name: string; json: string }>();
    const message = await withPremiumModel((model) =>
      consumeAiStream(
        openStream({ model, max_tokens: MAX_TOKENS, system, messages: withCacheTail(messages), tools, tool_choice: final ? { type: "none" } : { type: "auto" } }),
        route,
        model,
        (event) => {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") partial.set(event.index, { name: event.content_block.name, json: "" });
          if (event.type !== "content_block_delta") return;
          if (event.delta.type === "input_json_delta") {
            const p = partial.get(event.index);
            if (p) p.json += event.delta.partial_json;
          }
          if (event.delta.type !== "text_delta") return;
          line({ type: "delta", text: event.delta.text });
          wrote = true;
        },
      ),
    );
    last = message;
    calls++;
    // 응답 구성 — 블록 종류별 본문 글자 수(사고 블록은 서명 제외), 출력 토큰과 실제 출력 크기 대조용
    const blocks: Record<string, number> = {};
    for (const b of message.content) {
      const size = b.type === "text" ? b.text.length : b.type === "tool_use" ? JSON.stringify(b.input).length : b.type === "thinking" ? b.thinking.length : 0;
      blocks[b.type] = (blocks[b.type] ?? 0) + size;
    }
    const toolNames = message.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : []));
    console.log(JSON.stringify({ type: "agent_step", route, step, stopReason: message.stop_reason, outputTokens: message.usage.output_tokens, blocks, tools: toolNames }));
    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    if (message.stop_reason === "max_tokens") {
      const cut = [...partial.values()].pop();
      console.log(
        JSON.stringify({ type: "agent_truncated", route, step, outputTokens: message.usage.output_tokens, tool: cut?.name ?? null, inputChars: cut?.json.length ?? 0, input: cut?.json.slice(0, TRUNCATED_LOG_CHARS) ?? null }),
      );
      // 잘린 응답은 대화에서 제외 — 다음 호출에서 축약 재작성
      if (!final) {
        line({ type: "retry", reason: "max_tokens" });
        appendNote(messages, RETRY_NOTE);
        continue;
      }
    }
    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason !== "tool_use") {
      // 작성 모드 종료 점검 — 산출물 없이 끝나면 1회 재지시, 마지막 호출에선 생략
      const missing = opts.mode === "draft" && ctx.draft === restored.draft && ctx.saved === restored.saved;
      if (!missing || nudged || final) break;
      nudged = true;
      line({ type: "retry", reason: "draft_missing" });
      messages.push({ role: "user", content: DRAFT_NUDGE });
      continue;
    }

    // 조회 계획 — 이번 단계의 기안 외 tool 호출을 실행 전에 일괄 통지
    const planned = message.content.flatMap((b) => (b.type === "tool_use" && !isDraftingTool(b.name) ? [{ id: b.id, name: b.name, input: b.input }] : []));
    if (planned.length) line({ type: "plan", step, calls: planned });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      line({ type: "tool_call", id: block.id, name: block.name, input: block.input });
      const before = { draft: ctx.draft, saved: ctx.saved, proposed: ctx.proposed };
      const outcome = await executeTool(block.name, block.input, account, ctx);
      if (outcome.queryId) sources.add(outcome.queryId);
      if (outcome.queryId && !outcome.isError && isReusableQuery(block.name, account)) reusable.set(outcome.queryId, { name: block.name, input: block.input });
      line({
        type: "tool_result",
        id: block.id,
        name: block.name,
        ok: !outcome.isError,
        ...(outcome.isError ? { error: outcome.content } : {}),
        queryId: outcome.queryId,
        rowCount: outcome.rowCount,
        truncated: outcome.truncated,
        elapsedMs: outcome.elapsedMs,
      });
      // 초안 작성 기록 — 부분 수정 여부·보낸 채움 키·통과 여부, 채움 값 본문은 미기록
      if (block.name === "draft_report") {
        const input = block.input as Record<string, unknown>;
        const fills = input.fills && typeof input.fills === "object" ? Object.keys(input.fills) : [];
        console.log(JSON.stringify({ type: "agent_draft", route, step, revise: input.revise === true, keys: fills, ok: !outcome.isError, error: outcome.isError ? outcome.content.slice(0, 300) : null }));
      }
      if (ctx.draft && ctx.draft !== before.draft) line({ type: "draft", toolId: block.id, ...ctx.draft, input: ctx.draftInput, record: draftRecord(ctx) });
      if (ctx.saved && ctx.saved !== before.saved) line({ type: "saved", toolId: block.id, ...ctx.saved });
      if (ctx.proposed && ctx.proposed !== before.proposed) line({ type: "templates", toolId: block.id, candidates: ctx.proposed });
      results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
    }
    // 서식 제안 완료 — 사용자 선택을 기다리도록 이번 실행 종료
    if (ctx.proposed) {
      if (!wrote) {
        line({ type: "delta", text: PICK_TEMPLATE });
        wrote = true;
      }
      break;
    }
    messages.push({ role: "user", content: results });
  }

  // 작성 모드 실패 — 새 초안·저장·서식 제안 없이 종료하면 1회 안내, 검증 오류 내용은 agent_draft 로그 소관
  const draftFailed = opts.mode === "draft" && ctx.draft === restored.draft && ctx.saved === restored.saved && !ctx.proposed;
  if (draftFailed) line({ type: "error", error: "초안을 작성하지 못했습니다. 요청 범위를 좁히거나 조건을 바꿔 다시 요청해 주세요.", code: "draft_failed" });
  // 본문 없이 종료 — 화면에 빈 말풍선 대신 오류 안내
  else if (!wrote) line({ type: "error", error: "답변을 작성하지 못했습니다. 요청 범위를 좁혀 다시 시도해 주세요.", code: "empty_answer" });
  line({ type: "done", model: last?.model, stop_reason: last?.stop_reason, steps: calls, sources: [...sources], queries: [...reusable.values()], usage });
}
