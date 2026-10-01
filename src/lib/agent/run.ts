// Agent 루프 — 모델 응답의 tool 호출을 실행해 결과를 돌려주는 과정을 상한 내에서 반복
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Account } from "@/lib/accounts";
import { getAnthropic, withPremiumModel } from "@/lib/llm/client";
import { aiRequestOptions } from "@/lib/llm/request-context";
import { consumeAiStream } from "@/lib/llm/stream";
import { systemPrompt } from "./prompt";
import { buildTools, executeTool } from "./tools";

// 모델 호출 상한 — 마지막 호출은 tool 없이 답변만 강제
const MAX_STEPS = 8;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function runAgent(route: string, account: Account, turns: ChatTurn[], line: (value: unknown) => void) {
  const system = await systemPrompt(account);
  const tools = buildTools(account);
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const sources = new Set<string>();
  const usage = { input_tokens: 0, output_tokens: 0 };
  let wrote = false;
  let last: Anthropic.Message | null = null;
  let calls = 0;   // 이번 실행의 모델 호출 수 — 이전 대화 턴 제외

  for (let step = 1; step <= MAX_STEPS; step++) {
    const final = step === MAX_STEPS;
    // 호출 상한 도달 — tool 결과만 있는 마지막 발화에 답변 작성 지시 추가
    const tail = messages[messages.length - 1];
    if (final && Array.isArray(tail.content)) {
      tail.content = [...tail.content, { type: "text", text: "도구 호출 한도에 도달했습니다. 지금까지 조회한 결과만으로 답변을 작성하세요." }];
    }
    const message = await withPremiumModel((model) =>
      consumeAiStream(
        getAnthropic().messages.stream(
          { model, max_tokens: 4000, system, messages, tools, tool_choice: final ? { type: "none" } : { type: "auto" } },
          aiRequestOptions(),
        ),
        route,
        model,
        (event) => {
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") return;
          line({ type: "delta", text: event.delta.text });
          wrote = true;
        },
      ),
    );
    last = message;
    calls++;
    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      line({ type: "tool_call", id: block.id, name: block.name, input: block.input });
      const outcome = await executeTool(block.name, block.input, account);
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
      results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.content, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }

  // 본문 없이 종료 — 화면에 빈 말풍선 대신 오류 안내
  if (!wrote) line({ type: "error", error: "답변을 작성하지 못했습니다. 요청 범위를 좁혀 다시 시도해 주세요.", code: "empty_answer" });
  line({ type: "done", model: last?.model, stop_reason: last?.stop_reason, steps: calls, sources: [...sources], usage });
}
