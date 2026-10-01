// MES DB(MariaDB) 접속 — 조회 전용 풀과 앱 쓰기 풀 분리
import "server-only";
import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";

type PoolKind = "ro" | "app";
type CoreConnection = { query(sql: string, cb: (err: Error | null) => void): void };

// 개발 서버 모듈 재적재 시 풀 중복 생성 방지
const globalPools = globalThis as unknown as { __alabDbPools?: Partial<Record<PoolKind, Pool>> };
const pools = (globalPools.__alabDbPools ??= {});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 참고해 주세요.`);
  return v;
}

// 앱 시간대 — 드라이버 날짜 변환과 DB 세션 시각 해석 공용
const DB_TIME_ZONE = "+09:00";

// 세션 설정 — TIMESTAMP 해석을 앱 시간대로 고정, SQL 가드가 전제하는 따옴표·백슬래시 해석 보장
const SESSION_SQL = `SET time_zone = '${DB_TIME_ZONE}', sql_mode = TRIM(BOTH ',' FROM REPLACE(REPLACE(CONCAT(',', @@sql_mode, ','), ',ANSI_QUOTES,', ','), ',NO_BACKSLASH_ESCAPES,', ','))`;

function options(kind: PoolKind): PoolOptions {
  return {
    host: process.env.ALAB_DB_HOST || "127.0.0.1",
    port: Number(process.env.ALAB_DB_PORT || 13316),
    database: process.env.ALAB_DB_NAME || "mes",
    user: required(kind === "ro" ? "ALAB_DB_RO_USER" : "ALAB_DB_APP_USER"),
    password: required(kind === "ro" ? "ALAB_DB_RO_PASSWORD" : "ALAB_DB_APP_PASSWORD"),
    connectionLimit: 5,
    // 날짜는 문자열 그대로, DECIMAL 은 숫자로 — 보고서 수치와 원본 대조 시 변환 오차 차단
    dateStrings: true,
    decimalNumbers: true,
    timezone: DB_TIME_ZONE,
    charset: "utf8mb4",
  };
}

export function getPool(kind: PoolKind = "ro"): Pool {
  return (pools[kind] ??= createPool(kind));
}

// 새 연결마다 세션 설정 선실행 — 같은 연결의 후속 조회보다 먼저 처리됨
function createPool(kind: PoolKind): Pool {
  const pool = mysql.createPool(options(kind));
  // 이벤트 인자는 타입 선언과 달리 콜백형 기본 연결 객체
  pool.on("connection", (conn) => {
    (conn as unknown as CoreConnection).query(SESSION_SQL, (err) => {
      if (err) console.error(JSON.stringify({ type: "db_session_error", kind, message: err.message }));
    });
  });
  return pool;
}

export type QueryResult<T> = { rows: T[]; truncated: boolean; elapsedMs: number };

// 조회 전용 계정 실행 — 행 수 상한과 서버 측 실행 시간 상한 적용
export async function roQuery<T extends RowDataPacket = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
  { maxRows = 1000, timeoutMs = 5000 }: { maxRows?: number; timeoutMs?: number } = {},
): Promise<QueryResult<T>> {
  const started = Date.now();
  const bounded = `SET STATEMENT max_statement_time=${timeoutMs / 1000} FOR ${sql}`;
  const [rows] = await getPool("ro").query<T[]>({ sql: bounded, timeout: timeoutMs + 1000 }, params);
  const truncated = rows.length > maxRows;
  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated, elapsedMs: Date.now() - started };
}

// SQL 수준 오류 안내 — 실행 시간 초과·SQL 오류만 문구로 변환, 연결 장애 등 기반 오류는 null
export function sqlErrorMessage(e: unknown): string | null {
  const err = (e ?? {}) as { errno?: number; sqlMessage?: string };
  if (err.errno === 1969) return "실행 시간 상한을 넘었습니다. 기간이나 조건을 좁혀 주세요.";
  if (err.sqlMessage) return `SQL 실행 오류: ${err.sqlMessage}`;
  return null;
}

// 연결 확인 — 서버 버전과 응답 시간
export async function pingDb(): Promise<{ ok: true; version: string; elapsedMs: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const [rows] = await getPool("ro").query<RowDataPacket[]>("SELECT VERSION() AS version");
    return { ok: true, version: String(rows[0]?.version ?? ""), elapsedMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
