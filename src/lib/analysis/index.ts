// 분석 tool — KPI 계산·규격 이탈 판정, tool 설명은 지표·범위 정의에서 조립
import "server-only";
import type { Account } from "@/lib/accounts";
import { LIMIT_SOURCE, METRIC_SOURCES } from "@/lib/catalog";
import { FILTER_KEYS, allowedKpis, analyzeKpi, formulaOf } from "./kpi";
import { checkLimits, limitsAllowed } from "./limits";

export type AnalysisTool = { name: string; description: string; input_schema: Record<string, unknown> };

const periodProps = {
  from: { type: "string", description: "시작일 YYYY-MM-DD, 포함" },
  to: { type: "string", description: "종료일 YYYY-MM-DD, 포함" },
};

const filterProps = (entries: [string, { description: string }][]) =>
  Object.fromEntries(entries.map(([key, f]) => [key, { type: "string", description: `${f.description} 필터` }]));

export function analysisTools(account: Account): AnalysisTool[] {
  const tools: AnalysisTool[] = [];
  const kpis = allowedKpis(account);
  if (kpis.length) {
    const sources = [...new Set(kpis.map((k) => k.source))].map((id) => METRIC_SOURCES[id]);
    const kpiLines = kpis.map((k) => `${k.id}: ${k.name} = ${formulaOf(k)} (${k.unit}, ${k.better === "higher" ? "높을수록 좋음" : "낮을수록 좋음"})`);
    const scopeLines = kpis
      .filter((k) => METRIC_SOURCES[k.source].defaultScope)
      .map((k) => {
        const ds = METRIC_SOURCES[k.source].defaultScope!;
        return `${k.id}: ${ds.filter} 미지정 시 ${ds.value} (${ds.reason})`;
      });
    const dims = [...new Set(["day", "week", "month", ...sources.flatMap((s) => Object.keys(s.dimensions))])];
    tools.push({
      name: "analyze_kpi",
      description: [
        "KPI 를 코드로 계산합니다. 분자·분모를 같은 범위에서 집계해 비율을 산출하고, 직전 비교 기간(달력 월 단위 기간은 직전 같은 개월 수, 그 밖은 직전 같은 일수) 또는 compareFrom~compareTo 와 비교한 증감·개선/악화를 반환합니다. 날짜 단위(day·week·month) groupBy 행은 비교 없이 현재 값만 반환하고 비교는 합계로 합니다. 비율·증감 수치는 이 결과를 그대로 인용합니다.",
        `KPI: ${kpiLines.join("; ")}`,
        scopeLines.length ? `기본 범위: ${scopeLines.join("; ")}. 다른 범위는 해당 필터로 지정하거나 같은 이름의 groupBy 로 나누어 조회합니다.` : "",
      ].filter(Boolean).join(" "),
      input_schema: {
        type: "object",
        properties: {
          kpi: { type: "string", enum: kpis.map((k) => k.id) },
          ...periodProps,
          groupBy: { type: "string", enum: dims, description: "집계 단위, 생략 시 합계만" },
          ...filterProps(FILTER_KEYS.flatMap((key) => {
            const f = sources.map((s) => s.filters[key]).find(Boolean);
            return f ? [[key, f] as [string, { description: string }]] : [];
          })),
          compare: { type: "boolean", description: "직전 기간 비교 여부, 기본 true" },
          compareFrom: { type: "string", description: "비교 기간 시작일, 생략 시 직전 비교 기간" },
          compareTo: { type: "string", description: "비교 기간 종료일" },
        },
        required: ["kpi", "from", "to"],
      },
    });
  }
  if (limitsAllowed(account)) {
    tools.push({
      name: "check_limits",
      description:
        "기간 내 측정값을 규격 테이블의 하한·상한과 대조합니다. 대상별 로그·경보 건수, 규격 이탈 항목(한계값·이탈 건수·최소/최대·최초/최종 이탈 시각), 규격 이탈로 설명되지 않는 경보 건수를 반환합니다. 경보·이상의 원인 항목은 이 결과로 판단합니다.",
      input_schema: {
        type: "object",
        properties: { ...periodProps, ...filterProps(Object.entries(LIMIT_SOURCE.filters)) },
        required: ["from", "to"],
      },
    });
  }
  return tools;
}

export async function runAnalysis(name: string, input: Record<string, unknown>, account: Account) {
  if (name === "analyze_kpi" && allowedKpis(account).length) return analyzeKpi(input, account);
  if (name === "check_limits" && limitsAllowed(account)) return checkLimits(input, account);
  return null;
}
