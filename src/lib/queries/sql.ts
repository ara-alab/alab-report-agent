// run_sql — 조회 함수로 부족할 때 LLM 이 작성한 SQL 을 가드 통과 후 조회 전용 계정으로 실행
import "server-only";
import type { Account } from "@/lib/accounts";
import { listRelationNames } from "@/lib/catalog";
import { roQuery, sqlErrorMessage } from "@/lib/db";
import { queryIdOf } from "./registry";
import { SqlGuardError, guardSql } from "./sql-guard";

export { SqlGuardError } from "./sql-guard";
// SQL 실행 오류 — 가드 통과 후 DB 오류, 기존 가드 오류 처리 경로 호환을 위해 가드 오류의 하위 종류
export class SqlExecError extends SqlGuardError {}

const MAX_ROWS = 200;
const TIMEOUT_MS = 5000;

export async function runSql(sql: string, account: Account) {
  const guarded = guardSql(sql, { knownTables: await listRelationNames(), allowedTables: account.allowedTables, maxRows: MAX_ROWS });
  try {
    const result = await roQuery(guarded.sql, [], { maxRows: MAX_ROWS, timeoutMs: TIMEOUT_MS });
    const params = { sql: sql.trim().replace(/\s+/g, " ") };
    return { queryId: queryIdOf("run_sql", params), name: "run_sql", params, tables: guarded.tables, ...result };
  } catch (e) {
    // DB 오류는 수정 가능한 입력 오류로 반환 — LLM 이 SQL 을 고쳐 재시도
    const message = sqlErrorMessage(e);
    if (message) throw new SqlExecError(message);
    throw e;
  }
}

export const RUN_SQL_TOOL = {
  name: "run_sql",
  description:
    "query_* 조회 함수로 얻을 수 없는 집계가 필요할 때만 사용합니다. MariaDB SELECT 문 1개를 실행하고 최대 200행을 반환합니다. 작성 전 describe_table 로 컬럼을 확인하고, 현재 계정의 조회 가능 테이블만 사용합니다.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "실행할 SELECT 문, 세미콜론 없이 1개" },
      purpose: { type: "string", description: "이 조회로 확인하려는 내용 한 줄" },
    },
    required: ["sql", "purpose"],
  },
} as const;
