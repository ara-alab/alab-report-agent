// 개발 확인용 — 준비한 모델 응답을 재생해 Agent 루프 실행(API 미호출), 호출별 전달 대화와 NDJSON 이벤트 반환, 운영 빌드에선 404
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type Anthropic from "@anthropic-ai/sdk";
import { getAccount } from "@/lib/accounts";
import { runAgent } from "@/lib/agent/run";

// 재생 응답 — 블록(text 또는 tool_use 입력 JSON 원문)과 종료 사유
type Block = { text: string } | { tool: string; json: string };
type Reply = { stop: "end_turn" | "tool_use" | "max_tokens"; blocks: Block[]; outputTokens?: number };

// 응답 1건을 SDK 스트림 이벤트 줄 단위 JSON 으로 변환
function replayStream(reply: Reply, model: string, n: number): MessageStream {
  const ev: unknown[] = [
    { type: "message_start", message: { id: `msg_replay_${n}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null } } },
  ];
  reply.blocks.forEach((b, index) => {
    if ("text" in b) {
      ev.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else {
      ev.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_replay_${n}_${index}`, name: b.tool, input: {} } });
      ev.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: b.json } });
    }
    ev.push({ type: "content_block_stop", index });
  });
  ev.push({ type: "message_delta", delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: reply.outputTokens ?? 1 } });
  ev.push({ type: "message_stop" });
  const body = new TextEncoder().encode(ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return MessageStream.fromReadableStream(new ReadableStream({ start: (c) => (c.enqueue(body), c.close()) }));
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { account?: unknown; request?: unknown; replies?: unknown };
  const account = typeof body.account === "string" || body.account === undefined ? getAccount(body.account) : null;
  if (!account) return Response.json({ error: "알 수 없는 계정입니다." }, { status: 400 });
  if (typeof body.request !== "string" || !Array.isArray(body.replies)) return Response.json({ error: "request 문자열과 replies 배열이 필요합니다." }, { status: 400 });
  const replies = body.replies as Reply[];
  const calls: { messages: Anthropic.MessageParam[] }[] = [];
  const events: unknown[] = [];
  await runAgent("dev/agent-replay", account, [{ role: "user", content: body.request }], (v) => events.push(v), (params) => {
    calls.push({ messages: structuredClone(params.messages) });
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error(`재생 응답이 부족합니다: ${calls.length}번째 호출`);
    return replayStream(reply, params.model, calls.length);
  });
  return Response.json({ calls, events });
}
