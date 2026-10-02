// 보고서 저장소 — alab_report 스키마에 보고서·수치 저장, 문서번호 발번, 계정별 목록·조회
import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Account } from "@/lib/accounts";
import { getPool } from "@/lib/db";
import { parseFills } from "@/lib/drafting/fills";
import { systemFills } from "@/lib/drafting/meta";
import { fillIssues, type Fills } from "@/lib/drafting/render";
import { getTemplate } from "@/lib/drafting/templates";

const DB = "alab_report";

export class ReportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400,
  ) {
    super(message);
  }
}

// 수치 기록 — 보고서 기재 값과 출처 조회, 원본 재조회 대조의 단위
export type ReportNumber = {
  key: string;
  label?: string;
  value: number;
  numerator?: number;
  denominator?: number;
  unit?: string;
  queryId?: string;
  path?: string;
  call?: { name: string; input: unknown };
};

export type SaveInput = {
  id?: number;
  templateId: string;
  title: string;
  periodFrom?: string;
  periodTo?: string;
  requestText?: string;
  fills: unknown;
  numbers?: unknown;
  draft?: unknown;
};

// 수정 재개용 기안 기록 — 참조 형태 기안 입력과 참조 원천 조회(이름·입력), 열 때 조회 재실행 후 다시 검증
export type DraftRecord = { input: Record<string, unknown>; queries: { name: string; input: unknown }[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NUMBERS = 500;
const MAX_DRAFT_QUERIES = 200;
const MAX_DRAFT_CHARS = 200_000;

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const optFinite = (v: unknown) => v === undefined || v === null || finite(v);
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

function parseNumbers(raw: unknown): ReportNumber[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_NUMBERS) throw new ReportError(`수치 목록은 ${MAX_NUMBERS}개 이하 배열이어야 합니다.`);
  const seen = new Set<string>();
  return raw.map((x, i) => {
    const n = (x ?? {}) as Record<string, unknown>;
    const ok =
      typeof n.key === "string" && n.key.length > 0 && n.key.length <= 120 && finite(n.value) &&
      optFinite(n.numerator) && optFinite(n.denominator) &&
      optStr(n.label, 200) && optStr(n.unit, 20) && optStr(n.queryId, 80) && optStr(n.path, 200) &&
      (n.call === undefined || (typeof (n.call as { name?: unknown })?.name === "string" && "input" in (n.call as object)));
    if (!ok) throw new ReportError(`수치 ${i + 1}번 항목의 형식이 올바르지 않습니다.`);
    if (seen.has(n.key as string)) throw new ReportError(`수치 키가 중복됩니다: ${n.key}`);
    seen.add(n.key as string);
    return n as ReportNumber;
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseDraftRecord(raw: unknown): DraftRecord | null {
  if (raw === undefined || raw === null) return null;
  const ok =
    isObj(raw) && isObj(raw.input) && Array.isArray(raw.queries) && raw.queries.length <= MAX_DRAFT_QUERIES &&
    raw.queries.every((q) => isObj(q) && typeof q.name === "string" && "input" in q) && JSON.stringify(raw).length <= MAX_DRAFT_CHARS;
  if (!ok) throw new ReportError(`기안 기록은 {input, queries} 이고 조회 ${MAX_DRAFT_QUERIES}건·${MAX_DRAFT_CHARS}자 이하여야 합니다.`);
  return { input: raw.input as Record<string, unknown>, queries: (raw.queries as { name: string; input: unknown }[]).map((q) => ({ name: q.name, input: q.input })) };
}

// 저장 대상 채움 값 — 서식 키 선언과 대조, 시스템 발급 키는 컬럼 값으로 대체하므로 제외
async function validated(input: SaveInput) {
  const t = await getTemplate(input.templateId);
  if (!t) throw new ReportError(`알 수 없는 서식입니다: ${input.templateId}`);
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) throw new ReportError("문서 제목은 1~200자여야 합니다.");
  for (const d of [input.periodFrom, input.periodTo]) if (d !== undefined && !DATE_RE.test(d)) throw new ReportError("기간은 YYYY-MM-DD 형식이어야 합니다.");
  if (input.requestText !== undefined && (typeof input.requestText !== "string" || input.requestText.length > 4000)) throw new ReportError("요청 원문은 4000자 이하여야 합니다.");
  const parsed = parseFills(input.fills);
  if (!parsed.ok) throw new ReportError(parsed.error);
  // 필수 키 누락은 초안 저장 허용, 선언 외 키·종류 불일치만 거부
  const bad = fillIssues(t.keys, parsed.fills).filter((x) => !x.startsWith("필수 키 누락"));
  if (bad.length) throw new ReportError(bad.join("; "));
  const fills: Fills = Object.fromEntries(Object.entries(parsed.fills).filter(([k]) => t.keys[k].by !== "system"));
  return { t, fills, numbers: parseNumbers(input.numbers), draft: parseDraftRecord(input.draft) };
}

// 문서번호 — 서식 접두어·작성일별 일련번호, 같은 트랜잭션에서 행 잠금으로 중복 방지
async function issueDocNo(conn: PoolConnection, prefix: string) {
  await conn.query(
    `INSERT INTO ${DB}.doc_seq (prefix, issue_date, last_no) VALUES (?, CURDATE(), LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)`,
    [prefix],
  );
  const [[row]] = await conn.query<RowDataPacket[]>(`SELECT LAST_INSERT_ID() AS n, DATE_FORMAT(CURDATE(), '%Y%m%d') AS d`);
  return `${prefix}-${row.d}-${String(row.n).padStart(2, "0")}`;
}

async function insertNumbers(conn: PoolConnection, id: number, numbers: ReportNumber[]) {
  if (!numbers.length) return;
  await conn.query(
    `INSERT INTO ${DB}.report_number (report_id, num_key, label, value, numerator, denominator, unit, query_id, source_path, source_call) VALUES ?`,
    [numbers.map((n) => [id, n.key, n.label ?? null, n.value, n.numerator ?? null, n.denominator ?? null, n.unit ?? null, n.queryId ?? null, n.path ?? null, n.call ? JSON.stringify(n.call) : null])],
  );
}

// 저장 — id 없으면 신규 발번, 있으면 작성 계정 본인의 보고서만 내용 교체(문서번호 유지)
// 기안 기록은 채움 값과 함께 교체, 기록 없이 저장하면 비워 수정 불가로 전환
export async function saveReport(input: SaveInput, account: Account) {
  const { t, fills, numbers, draft } = await validated(input);
  const draftJson = draft ? JSON.stringify(draft) : null;
  const conn = await getPool("app").getConnection();
  let id = input.id;
  try {
    await conn.beginTransaction();
    if (id === undefined) {
      const docNo = await issueDocNo(conn, t.docPrefix);
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO ${DB}.report (doc_no, template_id, title, account_id, writer, period_from, period_to, request_text, fills, draft) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [docNo, t.id, input.title.trim(), account.id, `${account.dept} ${account.name} ${account.title}`, input.periodFrom ?? null, input.periodTo ?? null, input.requestText ?? null, JSON.stringify(fills), draftJson],
      );
      id = res.insertId;
    } else {
      const [[cur]] = await conn.query<RowDataPacket[]>(`SELECT account_id, template_id FROM ${DB}.report WHERE report_id = ? FOR UPDATE`, [id]);
      if (!cur) throw new ReportError("보고서를 찾을 수 없습니다.", 404);
      if (cur.account_id !== account.id) throw new ReportError("작성 계정만 보고서를 수정할 수 있습니다.", 403);
      if (cur.template_id !== t.id) throw new ReportError("저장된 보고서의 서식은 바꿀 수 없습니다.");
      await conn.query(
        `UPDATE ${DB}.report SET title = ?, period_from = ?, period_to = ?, fills = ?, draft = ? WHERE report_id = ?`,
        [input.title.trim(), input.periodFrom ?? null, input.periodTo ?? null, JSON.stringify(fills), draftJson, id],
      );
      await conn.query(`DELETE FROM ${DB}.report_number WHERE report_id = ?`, [id]);
    }
    await insertNumbers(conn, id, numbers);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return (await getReport(id, account))!;
}

export type ReportSummary = {
  id: number;
  docNo: string;
  templateId: string;
  title: string;
  accountId: string;
  writer: string;
  periodFrom: string | null;
  periodTo: string | null;
  createdAt: string;
  updatedAt: string;
};

// 조회 범위 — 검토자는 전체, 기안자는 본인 작성분
const visible = (a: Account) => (a.role === "reviewer" ? { sql: "1 = 1", params: [] as string[] } : { sql: "account_id = ?", params: [a.id] });

const SUMMARY_COLS = `report_id AS id, doc_no AS docNo, template_id AS templateId, title, account_id AS accountId, writer,
  period_from AS periodFrom, period_to AS periodTo, created_at AS createdAt, updated_at AS updatedAt`;

export async function listReports(account: Account, { limit = 50 }: { limit?: number } = {}) {
  const v = visible(account);
  const [rows] = await getPool("app").query<RowDataPacket[]>(
    `SELECT ${SUMMARY_COLS} FROM ${DB}.report WHERE ${v.sql} ORDER BY created_at DESC, report_id DESC LIMIT ?`,
    [...v.params, Math.min(Math.max(1, limit), 200)],
  );
  return rows as unknown as ReportSummary[];
}

// 수정 불가 사유 — 작성 계정 아님, 기안 기록 없음, 기안 기록 재검증 실패
export type EditBlock = "not_author" | "no_draft" | "not_replayable";

// 저장 수치 행 — DECIMAL 컬럼은 문자열로 수신, 출처 조회는 도구 이름·입력
export type StoredNumber = {
  key: string;
  label: string | null;
  value: number | string;
  numerator: number | string | null;
  denominator: number | string | null;
  unit: string | null;
  queryId: string | null;
  path: string | null;
  call: { name: string; input: unknown } | null;
};

// 단건 — 시스템 발급 키를 합친 전체 채움 값과 수치 목록
export async function getReport(id: number, account: Account) {
  const v = visible(account);
  const pool = getPool("app");
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT ${SUMMARY_COLS}, request_text AS requestText, fills, draft IS NOT NULL AS hasDraft, DATE(created_at) AS issuedDate FROM ${DB}.report WHERE report_id = ? AND ${v.sql}`,
    [id, ...v.params],
  );
  if (!row) return null;
  const [numbers] = await pool.query<RowDataPacket[]>(
    `SELECT num_key AS \`key\`, label, value, numerator, denominator, unit, query_id AS queryId, source_path AS path, source_call AS \`call\`
       FROM ${DB}.report_number WHERE report_id = ? ORDER BY num_key`,
    [id],
  );
  const { issuedDate, fills, hasDraft, ...meta } = row as unknown as ReportSummary & { requestText: string | null; fills: unknown; hasDraft: number; issuedDate: string };
  const stored = (typeof fills === "string" ? JSON.parse(fills) : fills) as Fills;
  return {
    ...meta,
    // 수정 가능 — 작성 계정 본인이고 기안 기록이 있는 보고서, 불가 사유는 작성자 아님 우선
    editable: Boolean(hasDraft) && meta.accountId === account.id,
    editBlock: (meta.accountId !== account.id ? "not_author" : !hasDraft ? "no_draft" : null) as EditBlock | null,
    fills: { ...stored, ...systemFills({ docNo: String(row.docNo), date: String(issuedDate) }) },
    numbers: numbers.map((n) => ({ ...n, call: typeof n.call === "string" ? JSON.parse(n.call) : n.call }) as StoredNumber),
  };
}

// 수정 재개 원천 — 작성 계정 본인의 보고서만, 기안 기록 없으면 수정 불가 오류
export async function getReportDraft(id: number, account: Account) {
  const [[row]] = await getPool("app").query<RowDataPacket[]>(
    `SELECT report_id AS id, doc_no AS docNo, account_id AS accountId, request_text AS requestText, draft FROM ${DB}.report WHERE report_id = ?`,
    [id],
  );
  if (!row) throw new ReportError("보고서를 찾을 수 없습니다.", 404);
  if (row.accountId !== account.id) throw new ReportError("작성 계정만 보고서를 수정할 수 있습니다.", 403);
  if (!row.draft) throw new ReportError("이 보고서는 수정에 필요한 기안 기록이 저장되지 않아 수정할 수 없습니다.");
  const draft = (typeof row.draft === "string" ? JSON.parse(row.draft) : row.draft) as DraftRecord;
  return { id: Number(row.id), docNo: String(row.docNo), requestText: (row.requestText as string | null) ?? undefined, draft };
}
