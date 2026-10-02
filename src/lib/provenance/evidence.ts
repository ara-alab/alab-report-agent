// 수치 근거 — 저장 수치 1건의 출처 조회를 작성 계정 권한으로 재실행해 원본 값·조회 조건·원천 테이블 제시
import "server-only";
import type { Account } from "@/lib/accounts";
import { KPIS, LIMIT_SOURCE, METRIC_SOURCES, TABLE_DOCS } from "@/lib/catalog";
import { listQueries } from "@/lib/queries";
import { getReport } from "@/lib/reports";
import { VerifyError, authorOf, judgeNumber, rerunCall, type VerifiedNumber } from "./verify";

// 원천 행 표시 상한 — 근거 패널에 담는 상위 객체의 단일 값 필드 수
const MAX_ROW_FIELDS = 30;

export type Evidence = {
  report: { id: number; docNo: string };
  number: VerifiedNumber & { unit: string | null };
  source: {
    tool: string;
    title: string | null;
    input: unknown;
    sql: string | null;
    formula: string | null;
    row: Record<string, unknown> | null;
    tables: { table: string; title: string | null; domain: string | null }[];
  } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 설명 첫 문장 — 도구 설명의 요지
const firstSentence = (s: string) => s.split(/(?<=[.다])\s/)[0].slice(0, 120);

// 원천 테이블 — 조회 함수 선언, SQL 가드 판정, 지표·규격 원천 정의 순으로 확인
function sourceTables(tool: string, input: unknown, result: unknown): string[] {
  const def = listQueries().find((q) => q.name === tool);
  if (def) return [...def.tables];
  if (isObj(result) && Array.isArray(result.tables)) return result.tables.map(String);
  if (tool === "analyze_kpi") {
    const id = isObj(result) && isObj(result.kpi) ? result.kpi.id : isObj(input) ? input.kpi : undefined;
    const kpi = KPIS.find((k) => k.id === id);
    return kpi ? [...METRIC_SOURCES[kpi.source].tables] : [];
  }
  if (tool === "check_limits") return [...LIMIT_SOURCE.tables];
  return [];
}

function sourceTitle(tool: string, result: unknown): string | null {
  const def = listQueries().find((q) => q.name === tool);
  if (def) return firstSentence(def.description);
  if (isObj(result) && isObj(result.kpi) && typeof result.kpi.name === "string") return result.kpi.name;
  return null;
}

// 원천 행 — 찾은 값의 상위 객체에서 단일 값 필드만
function rowOf(parent: unknown): Record<string, unknown> | null {
  if (!isObj(parent)) return null;
  const scalar = Object.entries(parent).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  return scalar.length ? Object.fromEntries(scalar.slice(0, MAX_ROW_FIELDS)) : null;
}

export async function numberEvidence(id: number, key: string, viewer: Account): Promise<Evidence> {
  const report = await getReport(id, viewer);
  if (!report) throw new VerifyError("보고서를 찾을 수 없습니다.", 404);
  const n = report.numbers.find((x) => x.key === key);
  if (!n) throw new VerifyError(`수치를 찾을 수 없습니다: ${key}`, 404);
  const head = { id: report.id as number, docNo: String(report.docNo) };
  if (!n.call) return { report: head, number: { ...judgeNumber(n, null).verified, unit: n.unit }, source: null };
  const r = await rerunCall(n.call, authorOf(report.accountId));
  const { verified, parent } = judgeNumber(n, r);
  const result = "result" in r ? r.result : null;
  const params = isObj(result) && isObj(result.params) ? result.params : null;
  const kpi = isObj(result) && isObj(result.kpi) ? result.kpi : null;
  return {
    report: head,
    number: { ...verified, unit: n.unit },
    source: {
      tool: n.call.name,
      title: sourceTitle(n.call.name, result),
      input: n.call.input,
      sql: n.call.name === "run_sql" && params && typeof params.sql === "string" ? params.sql : null,
      formula: kpi && typeof kpi.formula === "string" ? kpi.formula : null,
      row: rowOf(parent),
      tables: sourceTables(n.call.name, n.call.input, result).map((t) => ({ table: t, title: TABLE_DOCS[t]?.title ?? null, domain: TABLE_DOCS[t]?.domain ?? null })),
    },
  };
}
