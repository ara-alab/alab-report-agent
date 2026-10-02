// Agent tool 구성·실행 — 계정 조회 범위로 tool 을 거르고, 입력 오류는 모델이 고칠 수 있게 오류 결과로 반환
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Account } from "@/lib/accounts";
import { analysisTools, runAnalysis } from "@/lib/analysis";
import { CalendarError, RESOLVE_WEEK_TOOL, WEEK_RULE, monthWeeks } from "@/lib/calendar";
import { CATALOG_TOOLS, CatalogError, describeTable, listDatasets } from "@/lib/catalog";
import { sqlErrorMessage } from "@/lib/db";
import { DRAFTING_TOOLS, isDraftingTool, runDraftingTool, type DraftContext, type DraftingErrorKind } from "@/lib/drafting/tools";
import { QueryParamError, listQueries, runQuery } from "@/lib/queries";
import { RUN_SQL_TOOL, SqlExecError, SqlGuardError, runSql } from "@/lib/queries/sql";

// 모델에 넘기는 tool 결과 상한 — 초과 시 행을 줄이고 생략 행 수 표기
const MAX_RESULT_CHARS = 24_000;

// 오류 범주 — 기안 tool 범주에 조회 조건·SQL 가드·데이터 설명·SQL 실행·미제공 도구 범주 추가
export type ToolErrorKind = DraftingErrorKind | "param" | "sql_guard" | "catalog" | "sql_error" | "unknown_tool";

export type ToolOutcome = {
  content: string;
  isError: boolean;
  errorKind?: ToolErrorKind;
  issues?: { at: string; kind: string }[];
  queryId?: string;
  rowCount?: number;
  truncated?: boolean;
  elapsedMs?: number;
};

const allowedQueries = (a: Account) => listQueries().filter((q) => q.tables.every((t) => a.allowedTables.includes(t)));

// 재실행 가능 조회 — 결과에 조회 ID가 붙는 조회 함수·분석 tool·SQL 조회, 이전 턴 조회 복원 대상
export function isReusableQuery(name: string, account: Account): boolean {
  return name === RUN_SQL_TOOL.name || allowedQueries(account).some((q) => q.name === name) || analysisTools(account).some((t) => t.name === name);
}

export function buildTools(account: Account): Anthropic.Tool[] {
  return [
    ...allowedQueries(account).map((q) => ({ name: q.name, description: q.description, input_schema: q.inputSchema as Anthropic.Tool.InputSchema })),
    ...analysisTools(account).map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
    ...CATALOG_TOOLS.map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
    { ...RESOLVE_WEEK_TOOL, input_schema: RESOLVE_WEEK_TOOL.input_schema as unknown as Anthropic.Tool.InputSchema },
    { ...RUN_SQL_TOOL, input_schema: RUN_SQL_TOOL.input_schema as unknown as Anthropic.Tool.InputSchema },
    ...DRAFTING_TOOLS.map((t) => ({ ...t, input_schema: t.input_schema as unknown as Anthropic.Tool.InputSchema })),
  ];
}

// 결과 축약 — 행 목록은 앞쪽 행부터 상한 안에 담기는 만큼 유지, 그 밖은 앞부분 문자열로 감싼 유효 JSON
function fit(result: Record<string, unknown> & { rows?: unknown[] }): string {
  const full = JSON.stringify(result);
  if (full.length <= MAX_RESULT_CHARS) return full;
  if (!Array.isArray(result.rows)) {
    return JSON.stringify({ partial: full.slice(0, MAX_RESULT_CHARS - 200), note: `결과가 길어 앞부분 ${MAX_RESULT_CHARS - 200}자만 전달합니다. 범위를 좁혀 다시 조회하세요.` });
  }
  let keep = result.rows.length;
  let text = full;
  while (keep > 0 && text.length > MAX_RESULT_CHARS) {
    keep = Math.floor(keep / 2);
    text = JSON.stringify({ ...result, rows: result.rows.slice(0, keep), rowsOmitted: result.rows.length - keep });
  }
  return text;
}

// 조회 결과 보관 — 모델에 축약해 넘긴 결과도 기안 참조는 전체 결과에서 해석
function keep(ctx: DraftContext, queryId: string, name: string, input: unknown, result: unknown) {
  ctx.cache.set(queryId, { name, input, result });
}

async function dispatch(name: string, input: Record<string, unknown>, account: Account, ctx: DraftContext): Promise<ToolOutcome> {
  if (isDraftingTool(name)) return runDraftingTool(name, input, account, ctx);
  if (name === "list_datasets") return { content: fit({ datasets: await listDatasets(account.allowedTables) }), isError: false };
  if (name === "resolve_week") return { content: JSON.stringify({ rule: WEEK_RULE, weeks: monthWeeks(String(input.month ?? "")) }), isError: false };
  if (name === "describe_table") return { content: fit(await describeTable(String(input.table ?? ""), account.allowedTables)), isError: false };
  const analysis = await runAnalysis(name, input, account);
  if (analysis) keep(ctx, analysis.queryId, name, input, analysis);
  if (analysis) return { content: fit(analysis), isError: false, queryId: analysis.queryId, rowCount: analysis.rows.length, truncated: analysis.truncated, elapsedMs: analysis.elapsedMs };
  const out =
    name === "run_sql"
      ? await runSql(String(input.sql ?? ""), account)
      : allowedQueries(account).some((q) => q.name === name)
        ? await runQuery(name, input)
        : null;
  if (!out) return { content: `사용할 수 없는 도구입니다: ${name}`, isError: true, errorKind: "unknown_tool" };
  keep(ctx, out.queryId, name, input, out);
  return { content: fit(out), isError: false, queryId: out.queryId, rowCount: out.rows.length, truncated: out.truncated, elapsedMs: out.elapsedMs };
}

export async function executeTool(name: string, input: unknown, account: Account, ctx: DraftContext): Promise<ToolOutcome> {
  try {
    return await dispatch(name, (input ?? {}) as Record<string, unknown>, account, ctx);
  } catch (e) {
    if (e instanceof QueryParamError || e instanceof CalendarError) return { content: e.message, isError: true, errorKind: "param" };
    if (e instanceof SqlExecError) return { content: e.message, isError: true, errorKind: "sql_error" };
    if (e instanceof SqlGuardError) return { content: e.message, isError: true, errorKind: "sql_guard" };
    if (e instanceof CatalogError) return { content: e.message, isError: true, errorKind: "catalog" };
    // SQL 수준 오류는 모델이 조건을 고쳐 재시도, 연결 장애 등은 요청 실패로 전파
    const message = sqlErrorMessage(e);
    if (message) return { content: message, isError: true, errorKind: "sql_error" };
    throw e;
  }
}
