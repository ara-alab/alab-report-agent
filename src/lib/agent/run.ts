// Agent 루프 — 모델 응답의 tool 호출을 실행해 결과를 돌려주는 과정을 상한 내에서 반복
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { Account } from "@/lib/accounts";
import { getAnthropic, withPremiumModel } from "@/lib/llm/client";
import { aiRequestOptions } from "@/lib/llm/request-context";
import { consumeAiStream } from "@/lib/llm/stream";
import type { DraftContext } from "@/lib/drafting/tools";
import { systemPrompt } from "./prompt";
import { buildTools, executeTool } from "./tools";

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

export type ChatTurn = { role: "user" | "assistant"; content: string };

// 모델 스트림 생성 — 기본은 API 호출, 개발 검증에서 재생 스트림으로 교체
export type OpenStream = (params: Anthropic.MessageStreamParams) => MessageStream;
const openApiStream: OpenStream = (params) => getAnthropic().messages.stream(params, aiRequestOptions());

export async function runAgent(route: string, account: Account, turns: ChatTurn[], line: (value: unknown) => void, openStream: OpenStream = openApiStream) {
  const system = await systemPrompt(account);
  const tools = buildTools(account);
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const sources = new Set<string>();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let wrote = false;
  let last: Anthropic.Message | null = null;
  let calls = 0;   // 이번 실행의 모델 호출 수 — 이전 대화 턴 제외
  // 기안 문맥 — 조회 결과 캐시는 이번 실행 한정, 이전 턴 조회는 다시 실행해야 참조 가능
  const ctx: DraftContext = { cache: new Map(), requestText: turns[turns.length - 1]?.content };

  for (let step = 1; step <= MAX_STEPS; step++) {
    const final = step === MAX_STEPS;
    // 호출 상한 도달 — tool 결과만 있는 마지막 발화에 답변 작성 지시 추가
    const tail = messages[messages.length - 1];
    if (final && Array.isArray(tail.content)) appendNote(messages, "도구 호출 한도에 도달했습니다. 지금까지 조회한 결과만으로 답변을 작성하세요.");
    // 이번 호출의 tool 입력 조각 — 출력 상한으로 잘린 경우 원문 기록용
    const partial = new Map<number, { name: string; json: string }>();
    const message = await withPremiumModel((model) =>
      consumeAiStream(
        openStream({ model, max_tokens: MAX_TOKENS, system, messages, tools, tool_choice: final ? { type: "none" } : { type: "auto" } }),
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
    console.log(JSON.stringify({ type: "agent_step", route, step, stopReason: message.stop_reason, outputTokens: message.usage.output_tokens, blocks }));
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
    if (message.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      line({ type: "tool_call", id: block.id, name: block.name, input: block.input });
      const before = { draft: ctx.draft, saved: ctx.saved };
      const outcome = await executeTool(block.name, block.input, account, ctx);
      if (outcome.queryId) sources.add(outcome.queryId);
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
      if (ctx.draft && ctx.draft !== before.draft) line({ type: "draft", toolId: block.id, ...ctx.draft });
      if (ctx.saved && ctx.saved !== before.saved) line({ type: "saved", toolId: block.id, ...ctx.saved });
      results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }

  // 본문 없이 종료 — 화면에 빈 말풍선 대신 오류 안내
  if (!wrote) line({ type: "error", error: "답변을 작성하지 못했습니다. 요청 범위를 좁혀 다시 시도해 주세요.", code: "empty_answer" });
  line({ type: "done", model: last?.model, stop_reason: last?.stop_reason, steps: calls, sources: [...sources], usage });
}
