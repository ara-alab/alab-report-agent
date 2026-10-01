// SQL 가드 회귀 검사 — DB·LLM 없이 통과·차단 사례와 판정 테이블을 대조
// 실행: npm run check:guard (Node 22 타입 제거 실행으로 TS 원본 직접 적재)
import { SqlGuardError, guardSql } from "../src/lib/queries/sql-guard.ts";

const opts = { knownTables: ["orders", "items", "secret", "Mixed_Case"], allowedTables: ["orders", "items", "mixed_case"], maxRows: 200 };

// [설명, SQL, 기대: 통과 시 판정 테이블 목록 | 차단 시 null]
const CASES = [
  ["단순 조회", "SELECT * FROM orders", ["orders"]],
  ["공백 뒤 주석", "SELECT 1 -- secret\nFROM orders", ["orders"]],
  ["문장 끝 주석", "SELECT * FROM orders --", ["orders"]],
  ["# 주석", "SELECT * FROM orders # secret", ["orders"]],
  ["블록 주석", "SELECT /* secret */ * FROM orders", ["orders"]],
  ["문자열 안 --", "SELECT '--secret' AS x FROM orders", ["orders"]],
  ["문자열 안 테이블명", "SELECT * FROM orders WHERE note = 'secret'", ["orders"]],
  ["대소문자 섞인 테이블", "SELECT * FROM MIXED_case", ["mixed_case"]],
  ["공백 없는 -- 는 뺄셈", "SELECT 1--1, s.* FROM secret s", null],
  ["공백 없는 -- 뒤 금지어", "SELECT 1--1 INTO OUTFILE '/tmp/x' FROM orders", null],
  ["범위 밖 테이블", "SELECT * FROM secret", null],
  ["대문자 범위 밖 테이블", "SELECT * FROM SECRET", null],
  ["백틱 범위 밖 테이블", "SELECT * FROM `secret`", null],
  ["여러 문장", "SELECT 1; SELECT * FROM orders", null],
  ["실행형 주석", "SELECT /*! secret */ 1", null],
  ["변수", "SELECT @@version", null],
  ["시스템 스키마", "SELECT * FROM information_schema.tables", null],
  ["쓰기 구문", "DELETE FROM orders", null],
  ["잠금 조회", "SELECT * FROM orders FOR UPDATE", null],
  ["지연 함수", "SELECT SLEEP(5) FROM orders", null],
];

let failed = 0;
for (const [label, sql, expected] of CASES) {
  let got;
  try {
    got = guardSql(sql, opts).tables;
  } catch (e) {
    if (!(e instanceof SqlGuardError)) throw e;
    got = null;
  }
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} — 기대 ${JSON.stringify(expected)}, 결과 ${JSON.stringify(got)}`);
}
console.log(`${CASES.length}건 중 실패 ${failed}건`);
process.exit(failed ? 1 : 0);
