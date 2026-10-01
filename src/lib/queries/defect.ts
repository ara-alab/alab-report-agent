// 불량 유형별 집계 — 불량 코드별 수량과 현상 설명, 전 공정 대상(설비 필터로 한정)
import { roQuery } from "@/lib/db";
import { codeParam, defineQuery, periodParams } from "./registry";

export const defectBreakdown = defineQuery({
  name: "query_defect_breakdown",
  tables: ["qm310", "eq100", "cm010"],
  description: "기간 내 불량 상세 로그를 불량 코드별로 합산하고 현상 설명을 함께 반환합니다. 수량 많은 순으로 정렬합니다.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "시작일 YYYY-MM-DD, 포함" },
      to: { type: "string", description: "종료일 YYYY-MM-DD, 포함" },
      line: { type: "string", description: "라인 코드 필터, 예: L02" },
      eqm: { type: "string", description: "설비 코드 필터, 예: M-201" },
      part: { type: "string", description: "품번 필터" },
    },
    required: ["from", "to"],
  },
  parse: (raw) => ({
    ...periodParams(raw),
    line: codeParam(raw.line, "line"),
    eqm: codeParam(raw.eqm, "eqm"),
    part: codeParam(raw.part, "part"),
  }),
  run: ({ from, to, line, eqm, part }) => {
    const filters: [string, string | undefined][] = [
      ["e.ln_cd = ?", line],
      ["b.eq_cd = ?", eqm],
      ["b.itm_cd = ?", part],
    ];
    const active = filters.filter(([, v]) => v !== undefined);
    return roQuery(
      `SELECT b.ng_cd AS defect_code, g.cd_nm AS defect_name,
              SUM(b.ng_qty) AS defect_qty, COUNT(*) AS row_count,
              GROUP_CONCAT(DISTINCT b.ng_desc ORDER BY b.ng_desc SEPARATOR ' / ') AS descriptions
         FROM qm310 b
         JOIN eq100 e ON e.eq_cd = b.eq_cd
         LEFT JOIN cm010 g ON g.cd_id = b.ng_cd
        WHERE b.wk_dt BETWEEN ? AND ?${active.map(([sql]) => ` AND ${sql}`).join("")}
        GROUP BY b.ng_cd, g.cd_nm
        ORDER BY defect_qty DESC, b.ng_cd`,
      [from, to, ...active.map(([, v]) => v)],
    );
  },
});
