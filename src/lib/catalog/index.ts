// 스키마 카탈로그 — DB 실제 구조와 설명을 합쳐 LLM 문맥·SQL 검증에 공용 제공
import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { roQuery } from "@/lib/db";
import { TABLE_DOCS } from "./tables";

export { TABLE_DOCS, type TableDoc } from "./tables";
export { KPIS, LIMIT_SOURCE, METRIC_SOURCES, type KpiDef, type LimitSource, type MetricSource } from "./metrics";

export class CatalogError extends Error {}

type ColumnRow = RowDataPacket & { table_name: string; column_name: string; column_type: string; nullable: string; column_key: string; ref: string | null };

// 현재 스키마의 테이블·컬럼·참조 관계 — 매 호출 시 DB 기준으로 읽어 테이블 추가를 즉시 반영
async function readColumns() {
  const { rows } = await roQuery<ColumnRow>(
    `SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.COLUMN_TYPE AS column_type,
            c.IS_NULLABLE AS nullable, c.COLUMN_KEY AS column_key,
            MAX(CONCAT(k.REFERENCED_TABLE_NAME, '.', k.REFERENCED_COLUMN_NAME)) AS ref
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
       LEFT JOIN information_schema.KEY_COLUMN_USAGE k
         ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
      WHERE c.TABLE_SCHEMA = DATABASE()
      GROUP BY c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.ORDINAL_POSITION
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    [],
    { maxRows: 5000 },
  );
  const tables = new Map<string, ColumnRow[]>();
  for (const r of rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), r]);
  return tables;
}

export async function listTableNames(): Promise<string[]> {
  return [...(await readColumns()).keys()];
}

// SQL 가드 판정용 관계 이름 — 테이블과 VIEW 모두, 계정 범위 밖 VIEW 경유 조회 차단
export async function listRelationNames(): Promise<string[]> {
  const { rows } = await roQuery<RowDataPacket & { name: string }>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    [],
    { maxRows: 5000 },
  );
  return rows.map((r) => r.name);
}

// 테이블 컬럼명 — 설정·DB 값으로 식별자를 조립하기 전 실재 여부 확인용
export async function tableColumns(table: string): Promise<string[]> {
  return ((await readColumns()).get(table) ?? []).map((c) => c.column_name);
}

// 계정 허용 범위 판정 — 범위 미지정은 전체 허용
const inScope = (table: string, allowed?: readonly string[]) => !allowed || allowed.includes(table);

// 식별자 인용 — information_schema 에 실재하는 이름에만 사용
const q = (id: string) => "`" + id.replace(/`/g, "``") + "`";
const isDateType = (type: string) => /^(date|datetime|timestamp)/.test(type);

// 테이블별 적재 기간 — 첫 날짜 컬럼 기준, 날짜 컬럼 없는 기준정보 테이블은 제외
export async function dataPeriods(allowed?: readonly string[]) {
  const tables = await readColumns();
  const targets = [...tables.entries()]
    .filter(([table]) => inScope(table, allowed))
    .map(([table, cols]) => ({ table, column: cols.find((c) => isDateType(c.column_type))?.column_name }))
    .filter((t): t is { table: string; column: string } => !!t.column);
  if (!targets.length) return [];
  const { rows } = await roQuery(
    targets
      .map((t) => `SELECT '${t.table}' AS table_name, '${t.column}' AS column_name, MIN(${q(t.column)}) AS min_value, MAX(${q(t.column)}) AS max_value FROM ${q(t.table)}`)
      .join(" UNION ALL "),
  );
  return rows.map((r) => ({ table: String(r.table_name), column: String(r.column_name), min: r.min_value ?? null, max: r.max_value ?? null }));
}

// 데이터셋 목록 — 설명 미등록 테이블도 포함해 누락 여부 표시, 계정 허용 범위로 한정
export async function listDatasets(allowed?: readonly string[]) {
  const tables = await readColumns();
  return [...tables.keys()].filter((table) => inScope(table, allowed)).map((table) => {
    const doc = TABLE_DOCS[table];
    return { table, title: doc?.title ?? null, domain: doc?.domain ?? null, description: doc?.description ?? null, columns: tables.get(table)!.length };
  });
}

// 테이블 상세 — 컬럼 구조·설명, 정확한 행 수, 날짜 컬럼 범위, 표본 3행
export async function describeTable(table: string, allowed?: readonly string[]) {
  const columns = (await readColumns()).get(table);
  if (!columns) throw new CatalogError(`알 수 없는 테이블입니다: ${table}`);
  if (!inScope(table, allowed)) throw new CatalogError(`현재 계정의 조회 범위에 없는 테이블입니다: ${table}`);
  const doc = TABLE_DOCS[table];
  const dateCols = columns.filter((c) => isDateType(c.column_type)).map((c) => c.column_name);
  const ranges = dateCols.map((c) => `MIN(${q(c)}) AS ${q(`${c}__min`)}, MAX(${q(c)}) AS ${q(`${c}__max`)}`);
  const [stats, sample] = await Promise.all([
    roQuery(`SELECT COUNT(*) AS row_count${ranges.length ? ", " + ranges.join(", ") : ""} FROM ${q(table)}`),
    roQuery(`SELECT * FROM ${q(table)} LIMIT 3`),
  ]);
  const s = stats.rows[0] ?? {};
  return {
    table,
    title: doc?.title ?? null,
    domain: doc?.domain ?? null,
    description: doc?.description ?? null,
    rowCount: Number(s.row_count ?? 0),
    dateRanges: Object.fromEntries(dateCols.map((c) => [c, { min: s[`${c}__min`] ?? null, max: s[`${c}__max`] ?? null }])),
    columns: columns.map((c) => ({
      name: c.column_name,
      type: c.column_type,
      nullable: c.nullable === "YES",
      primaryKey: c.column_key === "PRI",
      references: c.ref,
      description: doc?.columns[c.column_name] ?? null,
    })),
    sample: sample.rows,
  };
}

// 설명과 실제 스키마 불일치 — 설명 없는 테이블·컬럼, DB 에 없는 설명 항목
export async function catalogDrift() {
  const tables = await readColumns();
  const undocumented: string[] = [];
  const stale: string[] = [];
  for (const [table, cols] of tables) {
    const doc = TABLE_DOCS[table];
    if (!doc) {
      undocumented.push(table);
      continue;
    }
    for (const c of cols) if (!(c.column_name in doc.columns)) undocumented.push(`${table}.${c.column_name}`);
    for (const name of Object.keys(doc.columns)) if (!cols.some((c) => c.column_name === name)) stale.push(`${table}.${name}`);
  }
  for (const table of Object.keys(TABLE_DOCS)) if (!tables.has(table)) stale.push(table);
  return { undocumented, stale };
}

// Agent tool 정의 — 조회 함수로 부족할 때 SQL 작성 전 구조 확인 용도
export const CATALOG_TOOLS = [
  {
    name: "list_datasets",
    description: "조회 가능한 MES/ERP 테이블 목록과 각 테이블의 의미를 반환합니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "describe_table",
    description: "테이블의 컬럼 구조·의미·참조 관계, 전체 행 수, 날짜 컬럼 범위, 표본 3행을 반환합니다.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string", description: "list_datasets 결과의 테이블명" } },
      required: ["table"],
    },
  },
] as const;
