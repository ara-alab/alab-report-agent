// 코드 명칭 조회 — 데이터 계층이 선언한 명칭 원천에서 코드별 명칭, 계정 조회 범위 밖 원천은 생략
import "server-only";
import type { Account } from "@/lib/accounts";
import type { NameSource } from "@/lib/catalog";
import { roQuery } from "@/lib/db";

const q = (id: string) => "`" + id.replace(/`/g, "``") + "`";

export async function namesOf(src: NameSource | undefined, codes: unknown[], account: Account): Promise<Map<string, string>> {
  const list = [...new Set(codes.filter((c) => c !== null && c !== undefined).map(String))];
  if (!src || !list.length || !account.allowedTables.includes(src.table)) return new Map();
  const { rows } = await roQuery(
    `SELECT ${q(src.code)} AS code, ${q(src.name)} AS name FROM ${q(src.table)} WHERE ${q(src.code)} IN (${list.map(() => "?").join(", ")})`,
    list,
  );
  return new Map(rows.filter((r) => r.name !== null).map((r) => [String(r.code), String(r.name)]));
}
