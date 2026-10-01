// 생산실적 집계 — 설비 구분별 지시·양품·불량 합계, 비율은 분석 모듈 소관
import { roQuery } from "@/lib/db";
import { QueryParamError, codeParam, defineQuery, enumParam, periodParams } from "./registry";

const GROUP_BY = ["day", "week", "line", "eqm", "part"] as const;
type GroupBy = (typeof GROUP_BY)[number];

// 그룹 키 SQL — 허용 목록 외 식은 조립하지 않음
const GROUP_EXPR: Record<GroupBy, string> = {
  day: "s.wk_dt",
  week: "DATE_SUB(s.wk_dt, INTERVAL WEEKDAY(s.wk_dt) DAY)",
  line: "e.ln_cd",
  eqm: "s.eq_cd",
  part: "s.itm_cd",
};

export const productionSummary = defineQuery({
  name: "query_production_summary",
  tables: ["pp300", "eq100"],
  description:
    "기간 내 생산실적(지시·양품·불량 수량)을 설비 구분별로 나누어 일·주·라인·설비·품번 단위로 합산합니다. eqmType 으로 특정 설비 구분만 조회할 수 있습니다. 비율은 반환하지 않습니다.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "시작일 YYYY-MM-DD, 포함" },
      to: { type: "string", description: "종료일 YYYY-MM-DD, 포함" },
      groupBy: { type: "string", enum: [...GROUP_BY], description: "집계 단위, 기본 line" },
      eqmType: { type: "string", description: "설비 구분 코드 필터(eq100.eq_tp), 생략 시 전체 구분을 나누어 반환" },
      line: { type: "string", description: "라인 코드 필터" },
      eqm: { type: "string", description: "설비 코드 필터" },
    },
    required: ["from", "to"],
  },
  parse: (raw) => ({
    ...periodParams(raw),
    groupBy: enumParam(raw.groupBy, "groupBy", GROUP_BY, "line"),
    eqmType: codeParam(raw.eqmType, "eqmType"),
    line: codeParam(raw.line, "line"),
    eqm: codeParam(raw.eqm, "eqm"),
  }),
  run: async ({ from, to, groupBy, eqmType, line, eqm }) => {
    // 설비 구분 값은 코드에 고정하지 않고 설비 마스터 실측값으로 검증
    if (eqmType) {
      const { rows } = await roQuery("SELECT DISTINCT eq_tp AS code FROM eq100 ORDER BY code");
      const codes = rows.map((r) => String(r.code));
      if (!codes.includes(eqmType)) throw new QueryParamError(`eqmType 은 ${codes.join(", ")} 중 하나여야 합니다.`);
    }
    const filters: [string, string | undefined][] = [
      ["e.eq_tp = ?", eqmType],
      ["e.ln_cd = ?", line],
      ["s.eq_cd = ?", eqm],
    ];
    const active = filters.filter(([, v]) => v !== undefined);
    return roQuery(
      `SELECT e.eq_tp AS eqm_type, ${GROUP_EXPR[groupBy]} AS group_key,
              SUM(s.ord_qty) AS target_qty, SUM(s.ok_qty) AS good_qty, SUM(s.ng_qty) AS defect_qty,
              COUNT(*) AS row_count
         FROM pp300 s JOIN eq100 e ON e.eq_cd = s.eq_cd
        WHERE s.wk_dt BETWEEN ? AND ?${active.map(([sql]) => ` AND ${sql}`).join("")}
        GROUP BY eqm_type, group_key
        ORDER BY eqm_type, group_key`,
      [from, to, ...active.map(([, v]) => v)],
    );
  },
});
