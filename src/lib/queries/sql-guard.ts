// LLM 생성 SQL 검증 — 단일 SELECT, 금지 구문, 계정 허용 테이블, 행 수 상한 부착
// 테이블 판정은 과대 판정 방식 — 실제 테이블명과 같은 식별자는 모두 참조로 간주해 오판 시 거부 쪽으로 기움

export class SqlGuardError extends Error {}

type Token = { kind: "word" | "ident" | "string" | "punct"; text: string; depth: number };

// 식별자·문자열·주석 경계 분해 — 주석은 버리고 실행형 주석은 거부
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "#" || (c === "-" && sql[i + 1] === "-" && (i + 2 >= sql.length || /\s/.test(sql[i + 2])))) {
      // `--` 는 뒤에 공백·문장 끝이 올 때만 주석 — `1--1` 은 뺄셈 두 번
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && sql[i + 1] === "*") {
      if (sql[i + 2] === "!" || (sql[i + 2] === "M" && sql[i + 3] === "!")) throw new SqlGuardError("실행형 주석(/*! */)은 사용할 수 없습니다.");
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new SqlGuardError("닫히지 않은 주석이 있습니다.");
      i = end + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= sql.length) throw new SqlGuardError("닫히지 않은 따옴표가 있습니다.");
        if (sql[j] === "\\" && c !== "`") {
          text += sql[j + 1] ?? "";
          j += 2;
        } else if (sql[j] === c && sql[j + 1] === c) {
          text += c;
          j += 2;
        } else if (sql[j] === c) break;
        else text += sql[j++];
      }
      tokens.push({ kind: c === "`" ? "ident" : "string", text: c === "`" ? text.toLowerCase() : text, depth });
      i = j + 1;
    } else if (/[\p{L}\p{N}_$]/u.test(c)) {
      let j = i;
      while (j < sql.length && /[\p{L}\p{N}_$]/u.test(sql[j])) j++;
      tokens.push({ kind: "word", text: sql.slice(i, j).toLowerCase(), depth });
      i = j;
    } else {
      if (c === ")") depth--;
      tokens.push({ kind: "punct", text: c, depth });
      if (c === "(") depth++;
      i++;
    }
  }
  if (depth !== 0) throw new SqlGuardError("괄호 짝이 맞지 않습니다.");
  return tokens;
}

// 조회문 안에서도 부작용·정보 노출이 가능한 구문
const FORBIDDEN_WORDS = new Set([
  "into", "outfile", "dumpfile", "lock", "unlock", "procedure", "handler", "update", "delete", "insert", "merge",
  "create", "drop", "alter", "truncate", "rename", "grant", "revoke", "set", "prepare", "execute", "call", "load",
  "sleep", "benchmark", "load_file", "get_lock", "release_lock", "is_free_lock", "is_used_lock", "master_pos_wait", "master_gtid_wait",
]);
const SYSTEM_SCHEMAS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export type GuardedSql = { sql: string; tables: string[]; limited: boolean };

export function guardSql(raw: string, opts: { knownTables: readonly string[]; allowedTables: readonly string[]; maxRows: number }): GuardedSql {
  const text = raw.trim().replace(/;\s*$/, "");
  if (!text) throw new SqlGuardError("SQL 이 비어 있습니다.");
  if (text.length > 8000) throw new SqlGuardError("SQL 이 너무 깁니다(8,000자 이하).");
  const tokens = tokenize(text);

  if (tokens.some((t) => t.kind === "punct" && t.text === ";")) throw new SqlGuardError("여러 문장을 한 번에 실행할 수 없습니다.");
  if (tokens.some((t) => t.kind === "punct" && t.text === "@")) throw new SqlGuardError("사용자·시스템 변수(@, @@)는 사용할 수 없습니다.");
  const first = tokens.find((t) => !(t.kind === "punct" && t.text === "("));
  if (!first || first.kind !== "word" || (first.text !== "select" && first.text !== "with")) throw new SqlGuardError("SELECT 조회문만 실행할 수 있습니다.");

  const words = tokens.filter((t) => t.kind === "word");
  for (const [idx, t] of words.entries()) {
    // REPLACE 는 문자열 함수 호출만 허용
    if (t.text === "replace") {
      const next = tokens[tokens.indexOf(t) + 1];
      if (next?.text !== "(") throw new SqlGuardError("REPLACE 문은 사용할 수 없습니다.");
    } else if (t.text === "for" && ["update", "share"].includes(words[idx + 1]?.text ?? "")) {
      throw new SqlGuardError("잠금 조회(FOR UPDATE·SHARE)는 사용할 수 없습니다.");
    } else if (FORBIDDEN_WORDS.has(t.text)) {
      throw new SqlGuardError(`허용되지 않는 구문입니다: ${t.text.toUpperCase()}`);
    }
  }
  const names = tokens.filter((t) => t.kind === "word" || t.kind === "ident").map((t) => t.text);
  const system = names.find((n) => SYSTEM_SCHEMAS.has(n));
  if (system) throw new SqlGuardError(`시스템 스키마는 조회할 수 없습니다: ${system}`);

  // 테이블명 대소문자 무시 판정 — 토큰은 소문자로 정규화됨
  const known = new Set(opts.knownTables.map((t) => t.toLowerCase()));
  const allowed = new Set(opts.allowedTables.map((t) => t.toLowerCase()));
  const tables = [...new Set(names.filter((n) => known.has(n)))].sort();
  const denied = tables.filter((n) => !allowed.has(n));
  if (denied.length) throw new SqlGuardError(`현재 계정의 조회 범위에 없는 테이블입니다: ${denied.join(", ")}`);

  // 최상위 LIMIT 부재 시 상한+1 부착 — 초과 여부 판정용
  const limited = !tokens.some((t) => t.kind === "word" && t.text === "limit" && t.depth === 0);
  return { sql: limited ? `${text}\nLIMIT ${opts.maxRows + 1}` : text, tables, limited };
}
