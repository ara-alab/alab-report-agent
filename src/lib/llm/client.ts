// Anthropic 클라이언트·모델 구성
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { throwIfAiCancelled, trackAiWork } from "./request-context";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 900_000,
      maxRetries: 3,
      // Next 패치 fetch 의 응답 clone 이 스트림 첫 토큰을 지연시키는 문제 회피
      fetch: (url, init) => fetch(url as RequestInfo, { ...(init as RequestInit), cache: "no-store" }),
    });
  }
  return client;
}

// 작성·분석 기본 모델과 미배포 계정 대비 폴백
export const PREMIUM_MODEL = process.env.ALAB_PREMIUM_MODEL || "claude-sonnet-5-5";
export const PREMIUM_FALLBACK = "claude-sonnet-4-6";

// 검수 전용 상위 모델 — 작성 모델과 다른 모델로 교차 검증
export const CHECK_MODEL = "claude-opus-4-8";
export const CHECK_FALLBACK = PREMIUM_MODEL;

// 대화형 편집 모델 — 응답 속도 우선
export const EDIT_MODEL = process.env.ALAB_EDIT_MODEL || "claude-haiku-4-5";
export const EDIT_FALLBACK = PREMIUM_MODEL;

// 데이터 근거 서식 채우기 — 정확도 우선 상위 티어
export const EDIT_MODEL_HEAVY = process.env.ALAB_EDIT_MODEL_HEAVY || "claude-fable-5";
export const FILL_MODEL = process.env.ALAB_FILL_MODEL || "claude-opus-5";

// 사고 강도(effort) — 지원 모델에만 전달, 미지원 모델은 400 응답
export type EditEffort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: EditEffort[] = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_OK = /^claude-(opus-5|opus-4-8|opus-4-7|sonnet-5|fable-5)/;
export const EDIT_EFFORT_HEAVY = (process.env.ALAB_EDIT_EFFORT_HEAVY || "low") as EditEffort;

export function editOutputConfig(model: string, heavy = false): { effort: EditEffort } | undefined {
  const env = process.env.ALAB_EDIT_EFFORT as EditEffort | undefined;
  const e = env && EFFORTS.includes(env) ? env : heavy ? EDIT_EFFORT_HEAVY : undefined;
  if (!e || !EFFORTS.includes(e) || !EFFORT_OK.test(model)) return undefined;
  return { effort: e };
}

// 모델 미존재 응답 판별 — 폴백 전환 조건
function isModelMissing(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const msg = (e?.message || "").toLowerCase();
  return e?.status === 404 || (msg.includes("model") && (msg.includes("not found") || msg.includes("does not exist") || msg.includes("invalid")));
}

// 기본 모델 호출, 모델 미존재 시에만 폴백 모델로 1회 재호출
export async function withModelFallback<T>(primary: string, fallback: string, fn: (model: string) => Promise<T>): Promise<T> {
  throwIfAiCancelled();
  try {
    return await trackAiWork(fn(primary));
  } catch (err: unknown) {
    throwIfAiCancelled();
    if (isModelMissing(err)) return await trackAiWork(fn(fallback));
    throw err;
  }
}

export const withPremiumModel = <T>(fn: (model: string) => Promise<T>) => withModelFallback(PREMIUM_MODEL, PREMIUM_FALLBACK, fn);
export const withCheckModel = <T>(fn: (model: string) => Promise<T>) => withModelFallback(CHECK_MODEL, CHECK_FALLBACK, fn);
export const withEditModel = <T>(fn: (model: string) => Promise<T>, heavy = false, modelOverride?: string) =>
  withModelFallback(modelOverride || (heavy ? EDIT_MODEL_HEAVY : EDIT_MODEL), EDIT_FALLBACK, fn);

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// 토큰 사용량 구조화 로그 — 표준 출력 한 줄
export function recordUsage(route: string, model: string, usage: Usage | undefined, extra?: Record<string, unknown>) {
  if (!usage) return;
  console.log(
    JSON.stringify({
      type: "anthropic_usage",
      route,
      model,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      ts: new Date().toISOString(),
      ...(extra || {}),
    }),
  );
}

// 응답 본문의 첫 tool_use 입력 추출
export function firstToolUseInput<T = unknown>(content: ReadonlyArray<{ type: string; input?: unknown }>): T | null {
  for (const block of content) {
    if (block.type === "tool_use" && "input" in block) return block.input as T;
  }
  return null;
}
