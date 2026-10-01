// AI 요청 수명 관리 — 취소·타임아웃·오류 응답 매핑과 NDJSON 스트림 응답
import "server-only";
import { AiCapacityError } from "./capacity";
import { aiRequestStore, throwIfAiCancelled, type AiRequestContext } from "./request-context";

const abortError = () => new DOMException("AI 요청이 취소되었습니다.", "AbortError");

type Failure = { status: number; code: string; error: string; limit?: number; actual?: number };

// 원인별 사용자 안내 문구와 HTTP 상태 결정
function failure(context: AiRequestContext, cause?: unknown): Failure {
  if (!context.controller.signal.aborted) {
    if (cause instanceof AiCapacityError) return { status: cause.status, code: cause.code, error: cause.message, limit: cause.limit, actual: cause.actual };
    const provider = cause as { status?: number; message?: string } | undefined;
    if (provider?.status === 429) return { status: 429, code: "ai_provider_rate_limit", error: "AI 제공사의 일시적인 처리 한도에 도달했습니다. 잠시 후 다시 시도해 주세요." };
    if (provider?.status === 400 && /credit balance|billing/i.test(provider.message || ""))
      return { status: 429, code: "ai_provider_credit_limit", error: "AI 제공사의 사용 크레딧 한도에 도달했습니다. 크레딧을 확인한 뒤 다시 요청해 주세요." };
    if (provider?.status === 400 && /context|too many tokens|prompt is too long/i.test(provider.message || ""))
      return { status: 413, code: "ai_context_limit", error: "요청 내용이 AI 모델의 문맥 한도를 넘습니다. 범위를 나누어 다시 요청해 주세요." };
  }
  return context.controller.signal.aborted
    ? context.controller.signal.reason?.name === "TimeoutError"
      ? { status: 504, code: "ai_timeout", error: "AI 처리 대기 시간이 초과되었습니다. 다시 시도해 주세요." }
      : { status: 499, code: "ai_cancelled", error: "AI 요청이 취소되었습니다." }
    : { status: 500, code: "ai_failed", error: "AI 요청을 처리하지 못했습니다. 다시 시도해 주세요." };
}

// 요청 스코프 — 클라이언트 연결 해제·기한 초과 시 하위 모델 호출까지 중단, 스트림 종료 시점까지 유지
export async function runAiRequest(request: Request, meta: { route: string; timeoutMs: number }, work: () => Promise<Response>): Promise<Response> {
  const context: AiRequestContext = { controller: new AbortController(), pending: new Set() };
  return aiRequestStore.run(context, async () => {
    const started = Date.now();
    const disconnect = () => context.controller.abort(abortError());
    if (request.signal.aborted) disconnect();
    else request.signal.addEventListener("abort", disconnect, { once: true });
    const timer = setTimeout(() => context.controller.abort(new DOMException("AI deadline exceeded", "TimeoutError")), meta.timeoutMs);
    timer.unref();
    let settlement: Promise<void> | undefined;
    const finish = (status: number) =>
      (settlement ??= (async () => {
        while (context.pending.size) await Promise.allSettled([...context.pending]);
        clearTimeout(timer);
        request.signal.removeEventListener("abort", disconnect);
        const failed = context.controller.signal.aborted ? failure(context) : null;
        console.log(
          JSON.stringify({
            type: "ai_request",
            route: meta.route,
            status: failed?.status || status,
            code: failed?.code ?? null,
            partial: !!context.partialResult,
            usageIncomplete: !!context.usageIncomplete,
            durationMs: Date.now() - started,
          }),
        );
      })());
    try {
      throwIfAiCancelled();
      const response = await work();
      if (context.stream) {
        void context.stream.then(() => finish(context.streamStatus || response.status));
        return response;
      }
      throwIfAiCancelled();
      await finish(response.status);
      return response;
    } catch (cause) {
      const error = failure(context, cause);
      await finish(error.status);
      return Response.json(error, { status: error.status });
    }
  });
}

// NDJSON 스트림 응답 — 한 줄에 JSON 1건, 소비자 취소 시 생산자 중단
export function aiJsonResponse(produce: (line: (value: unknown) => void) => Promise<void>): Response {
  const context = aiRequestStore.getStore();
  if (!context) throw new Error("AI request scope required");
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (value: unknown) => {
        throwIfAiCancelled();
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      };
      context.stream = Promise.resolve()
        .then(() => {
          throwIfAiCancelled();
          return produce(emit);
        })
        .catch((cause) => {
          const error = failure(context, cause);
          context.streamStatus = error.status;
          if (!closed) controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: error.error, code: error.code }) + "\n"));
        })
        .finally(() => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      context.controller.abort(abortError());
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
}
