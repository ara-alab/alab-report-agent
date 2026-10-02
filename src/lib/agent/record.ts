// 실행 기록 — ALAB_AGENT_RUN_RECORD=1 일 때만 실행 1회의 스트림 이벤트를 파일로 보관, 응답·검증 과정 재확인과 측정 리포트 원천
import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// 보관 위치 — 측정 리포트 화면이 정적 파일로 읽는 경로, 저장소 추적 대상
const DIR = path.join(process.cwd(), "public", "eval-data", "runs");
const INDEX = "index.ndjson";
// 목록 요약의 요청 문장 길이 상한
const REQUEST_PREVIEW = 200;

export const runRecordEnabled = () => process.env.ALAB_AGENT_RUN_RECORD === "1";

export type RunMeta = {
  route: string;
  account: string;
  request: string;
  mode: string | null;
  template: string | null;
  report: number | null;
  section: string | null;
  turns: number;
};

type Event = Record<string, unknown> & { type?: string };

// 목록 요약 — 단계·도구 오류·초안 검증 실패와 범주·재작성·retry·결과 구분·토큰
function summarize(events: Event[]) {
  const results = events.filter((e) => e.type === "tool_result");
  const failed = results.filter((e) => e.ok === false);
  const drafts = results.filter((e) => e.name === "draft_report");
  const kinds: Record<string, number> = {};
  for (const e of failed) {
    const issues = Array.isArray(e.issues) && e.issues.length ? (e.issues as { kind: string }[]) : [{ kind: String(e.errorKind ?? "unknown") }];
    for (const i of issues) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  }
  const done = events.find((e) => e.type === "done");
  const error = events.find((e) => e.type === "error");
  return {
    steps: done?.steps ?? null,
    toolCalls: results.length,
    toolErrors: failed.length,
    draftCalls: drafts.length,
    draftFailures: drafts.filter((e) => e.ok === false).length,
    retries: events.filter((e) => e.type === "retry").map((e) => e.reason),
    kinds,
    drafted: events.some((e) => e.type === "draft"),
    saved: events.some((e) => e.type === "saved"),
    error: error ? String(error.code ?? "error") : null,
    usage: done?.usage ?? null,
  };
}

export function startRunRecord(meta: RunMeta) {
  const started = new Date();
  const id = `${started.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "")}-${randomUUID().slice(0, 8)}`;
  const events: Event[] = [];
  // 이벤트 보관 — 연속 본문 조각은 한 줄로 병합, 실행 시작 기준 경과 ms 부여
  const push = (value: unknown) => {
    const ev: Event = { ...(value as Event), ms: Date.now() - started.getTime() };
    const prev = events[events.length - 1];
    if (ev.type === "delta" && prev?.type === "delta") prev.text = String(prev.text) + String(ev.text);
    else events.push(ev);
  };
  // 파일 기록 — 실행 기록 본문과 목록 요약 1줄 추가, 기록 실패는 응답에 영향 없이 로그만
  const finish = async (aborted: boolean) => {
    try {
      await mkdir(DIR, { recursive: true });
      const head = { type: "run", id, at: started.toISOString(), ...meta };
      await writeFile(path.join(DIR, `${id}.ndjson`), [head, ...events].map((e) => JSON.stringify(e)).join("\n") + "\n");
      const row = { id, at: head.at, ...meta, request: meta.request.slice(0, REQUEST_PREVIEW), aborted, durationMs: Date.now() - started.getTime(), ...summarize(events) };
      await appendFile(path.join(DIR, INDEX), JSON.stringify(row) + "\n");
    } catch (e) {
      console.log(JSON.stringify({ type: "agent_record_failed", id, error: String(e).slice(0, 300) }));
    }
  };
  return { id, push, finish };
}
