// 품번별 자재·제품 흐름 — 자재 입고·불출, 제품 출고 수량과 입출고 금액
import { roQuery } from "@/lib/db";
import { codeParam, defineQuery, periodParams } from "./registry";

export const materialFlow = defineQuery({
  name: "query_material_flow",
  tables: ["mm200", "mm210", "sd200", "fi200", "it100"],
  description:
    "기간 내 품번별 자재 입고(mm200)·자재 불출(mm210)·제품 출고(sd200) 수량과 입출고 금액(fi200)을 합산합니다. 입고 수량 중 임시 마감(TEMP) 분을 별도로 반환합니다.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "시작일 YYYY-MM-DD, 포함" },
      to: { type: "string", description: "종료일 YYYY-MM-DD, 포함" },
      part: { type: "string", description: "품번 필터, 예: P2101-00" },
    },
    required: ["from", "to"],
  },
  parse: (raw) => ({
    ...periodParams(raw),
    part: codeParam(raw.part, "part"),
  }),
  run: ({ from, to, part }) => {
    // 원천 테이블 행을 같은 열 구조로 맞춘 뒤 품번 단위로 합산, 열 이름은 첫 원천 기준
    const sources = [
      `SELECT itm_cd AS part_no, in_qty, IF(cls_st = 'TEMP', in_qty, 0) AS in_temp_qty, 0 AS issue_qty, 0 AS ship_qty,
              0.00 AS in_amount, 0.00 AS ship_amount FROM mm200 WHERE in_dt BETWEEN ? AND ?`,
      "SELECT itm_cd, 0, 0, out_qty, 0, 0, 0 FROM mm210 WHERE out_dt BETWEEN ? AND ?",
      "SELECT itm_cd, 0, 0, 0, out_qty, 0, 0 FROM sd200 WHERE out_dt BETWEEN ? AND ?",
      "SELECT itm_cd, 0, 0, 0, 0, IF(io_tp = 'IN', io_amt, 0), IF(io_tp = 'OUT', io_amt, 0) FROM fi200 WHERE io_dt BETWEEN ? AND ?",
    ];
    return roQuery(
      `SELECT m.part_no, p.itm_nm AS part_name,
              SUM(m.in_qty) AS in_qty, SUM(m.in_temp_qty) AS in_temp_qty,
              SUM(m.issue_qty) AS issue_qty, SUM(m.ship_qty) AS ship_qty,
              SUM(m.in_amount) AS in_amount, SUM(m.ship_amount) AS ship_amount
         FROM (${sources.join("\n               UNION ALL ")}) m
         LEFT JOIN it100 p ON p.itm_cd = m.part_no
        ${part === undefined ? "" : "WHERE m.part_no = ?"}
        GROUP BY m.part_no, p.itm_nm
        ORDER BY m.part_no`,
      [...sources.flatMap(() => [from, to]), ...(part === undefined ? [] : [part])],
    );
  },
});
