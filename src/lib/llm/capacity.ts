// 대형 요청 사전 점검 — 모델 문맥 한도 초과를 호출 전에 차단
// ALAB_AI_CAPACITY_CHECK=1 일 때만 동작
import type Anthropic from "@anthropic-ai/sdk";
import { editOutputConfig, getAnthropic } from "./client";
import { aiRequestOptions, throwIfAiCancelled } from "./request-context";

export class AiCapacityError extends Error {
  readonly code = "ai_context_limit";
  readonly status = 413;
  constructor(readonly limit: number, readonly actual: number) {
    super(
      `AI에 전달할 내용이 현재 모델의 문맥 한도를 넘습니다(입력 ${actual.toLocaleString("ko-KR")}토큰, 한도 ${limit.toLocaleString("ko-KR")}토큰). 요청 범위를 나누어 다시 시도해 주세요.`,
    );
  }
}

const models = new Map<string, { input: number; output: number }>();

// 도구 정의까지 포함한 전체 요청 기준 토큰 점검
export async function prepareAiMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.MessageCreateParamsNonStreaming> {
  throwIfAiCancelled();
  const effort = process.env.ALAB_AI_CAPACITY_CHECK === "1" ? editOutputConfig(params.model, true) : undefined;
  const prepared = { ...params, ...(effort && !params.output_config ? { output_config: effort } : {}) };
  if (process.env.ALAB_AI_CAPACITY_CHECK !== "1") return prepared;
  const client = getAnthropic();
  let model = models.get(params.model);
  if (!model) {
    const info = await client.models.retrieve(params.model, {}, aiRequestOptions());
    if (!Number.isSafeInteger(info.max_input_tokens) || !Number.isSafeInteger(info.max_tokens) || !info.max_input_tokens || !info.max_tokens) {
      throw new Error("AI 모델의 처리 한도를 확인하지 못했습니다. 잠시 후 다시 요청해 주세요.");
    }
    model = { input: info.max_input_tokens, output: info.max_tokens };
    models.set(params.model, model);
  }
  prepared.max_tokens = Math.min(prepared.max_tokens, model.output);
  if (JSON.stringify({ system: params.system, messages: params.messages, tools: params.tools }).length >= 200_000) {
    const count = await client.messages.countTokens(
      { model: params.model, system: params.system, messages: params.messages, tools: params.tools },
      aiRequestOptions(),
    );
    if (!Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0) throw new Error("AI 입력 토큰 수를 확인하지 못했습니다. 다시 요청해 주세요.");
    const available = model.input - prepared.max_tokens;
    if (count.input_tokens > available) throw new AiCapacityError(available, count.input_tokens);
  }
  return prepared;
}

export async function createAiMessage(params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions) {
  const prepared = await prepareAiMessage(params);
  return getAnthropic().messages.create(prepared, options);
}
