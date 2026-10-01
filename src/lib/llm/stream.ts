// 모델 스트림 소비 — 이벤트 전달, 완료·중단 시 사용량 기록
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { recordUsage } from "./client";
import { markAiUsageIncomplete, throwIfAiCancelled } from "./request-context";

export async function consumeAiStream(stream: MessageStream, route: string, model: string, onEvent: (event: MessageStreamEvent) => void) {
  let complete = false;
  try {
    for await (const event of stream) {
      throwIfAiCancelled();
      onEvent(event);
    }
    const message = await stream.finalMessage();
    recordUsage(route, model, message.usage);
    complete = true;
    return message;
  } finally {
    if (!complete) {
      stream.abort();
      markAiUsageIncomplete();
      if (stream.currentMessage?.usage) recordUsage(route, model, stream.currentMessage.usage, { incomplete: true });
    }
  }
}
