// 개발 확인용 — 모델 스트림을 NDJSON 으로 중계, 운영 빌드에선 404
import { EDIT_MODEL, getAnthropic, withEditModel } from "@/lib/llm/client";
import { aiJsonResponse, runAiRequest } from "@/lib/llm/request";
import { aiRequestOptions } from "@/lib/llm/request-context";
import { consumeAiStream } from "@/lib/llm/stream";

const ROUTE = "dev/llm";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
  const text = (prompt || "제조 현장 주간 생산 보고서의 핵심 항목을 한 문장으로 말해 주세요.").slice(0, 2000);

  return runAiRequest(request, { route: ROUTE, timeoutMs: 60_000 }, async () =>
    aiJsonResponse(async (line) => {
      line({ type: "start", model: EDIT_MODEL });
      const message = await withEditModel((model) =>
        consumeAiStream(
          getAnthropic().messages.stream({ model, max_tokens: 300, messages: [{ role: "user", content: text }] }, aiRequestOptions()),
          ROUTE,
          model,
          (event) => {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") line({ type: "delta", text: event.delta.text });
          },
        ),
      );
      line({ type: "done", model: message.model, stop_reason: message.stop_reason, usage: message.usage });
    }),
  );
}
