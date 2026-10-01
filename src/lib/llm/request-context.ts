// 요청 단위 AI 작업 문맥 — 취소 신호와 진행 중 호출을 async 경계 너머로 전파
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

export type AiRequestContext = {
  controller: AbortController;
  pending: Set<Promise<unknown>>;
  stream?: Promise<void>;
  streamStatus?: number;
  usageIncomplete?: boolean;
  partialResult?: boolean;
};
export const aiRequestStore = new AsyncLocalStorage<AiRequestContext>();

export function throwIfAiCancelled() {
  aiRequestStore.getStore()?.controller.signal.throwIfAborted();
}

export function aiRequestOptions(): { signal?: AbortSignal } {
  throwIfAiCancelled();
  return { signal: aiRequestStore.getStore()?.controller.signal };
}

// 종료 전 대기 대상 등록 — 취소 시에도 형제 호출의 정리 완료까지 추적
export async function trackAiWork<T>(work: Promise<T>): Promise<T> {
  const context = aiRequestStore.getStore();
  context?.pending.add(work);
  try {
    return await work;
  } finally {
    context?.pending.delete(work);
  }
}

export async function aiRetryDelay(ms: number) {
  await delay(ms, undefined, aiRequestOptions());
}

export function markAiUsageIncomplete() {
  const context = aiRequestStore.getStore();
  if (context) context.usageIncomplete = true;
}

// 결과 완전성 표시 — 사용량 보고 완전성과 별개
export function markAiPartialResult() {
  const context = aiRequestStore.getStore();
  if (context) context.partialResult = true;
}
