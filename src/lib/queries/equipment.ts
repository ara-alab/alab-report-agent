// 설비 상태·측정값 집계 — 설비별 상태 건수와 측정 항목별 통계, 가동률은 분석 모듈이 RUN 건수÷로그 수로 산출
import { roQuery } from "@/lib/db";
import { codeParam, defineQuery, periodParams } from "./registry";

export const equipmentStatus = defineQuery({
  name: "query_equipment_status",
  tables: ["eq300", "eq310", "eq110", "eq100"],
  description:
    "기간 내 설비 상태 로그를 설비별로 집계합니다. RUN·STOP·ALARM 건수, 규격 이탈 경보 건수, 최초·최종 경보 시각과 함께 설비가 측정한 항목별 평균·최소·최대값과 단위를 설비·항목당 1행으로 반환합니다.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "시작일 YYYY-MM-DD, 포함" },
      to: { type: "string", description: "종료일 YYYY-MM-DD, 포함" },
      line: { type: "string", description: "라인 코드 필터, 예: L01" },
      eqm: { type: "string", description: "설비 코드 필터, 예: F-101" },
    },
    required: ["from", "to"],
  },
  parse: (raw) => ({
    ...periodParams(raw),
    line: codeParam(raw.line, "line"),
    eqm: codeParam(raw.eqm, "eqm"),
  }),
  run: ({ from, to, line, eqm }) => {
    const filters: [string, string | undefined][] = [
      ["e.ln_cd = ?", line],
      ["t.eq_cd = ?", eqm],
    ];
    const active = filters.filter(([, v]) => v !== undefined);
    const where = `t.log_dtm >= ? AND t.log_dtm < DATE_ADD(?, INTERVAL 1 DAY)${active.map(([sql]) => ` AND ${sql}`).join("")}`;
    const params = [from, to, ...active.map(([, v]) => v)];
    // 상태 건수는 로그 단위, 측정 통계는 항목 단위로 따로 집계한 뒤 설비로 결합
    return roQuery(
      `WITH st AS (
         SELECT t.eq_cd, e.eq_nm, e.ln_cd, e.eq_tp,
                COUNT(*) AS log_count,
                SUM(t.st_cd = 'RUN') AS run_count, SUM(t.st_cd = 'STOP') AS stop_count, SUM(t.st_cd = 'ALARM') AS alarm_count,
                SUM(t.alm_yn) AS alert_count,
                MIN(CASE WHEN t.alm_yn THEN t.log_dtm END) AS first_alert_at,
                MAX(CASE WHEN t.alm_yn THEN t.log_dtm END) AS last_alert_at
           FROM eq300 t JOIN eq100 e ON e.eq_cd = t.eq_cd
          WHERE ${where}
          GROUP BY t.eq_cd, e.eq_nm, e.ln_cd, e.eq_tp),
       mv AS (
         SELECT t.eq_cd, r.mi_cd, ROUND(AVG(r.mv), 3) AS value_avg, MIN(r.mv) AS value_min, MAX(r.mv) AS value_max
           FROM eq300 t JOIN eq100 e ON e.eq_cd = t.eq_cd JOIN eq310 r ON r.log_id = t.log_id
          WHERE ${where}
          GROUP BY t.eq_cd, r.mi_cd)
       SELECT st.*, mv.mi_cd AS item, mi.mi_nm AS item_name, mi.unit, mv.value_avg, mv.value_min, mv.value_max
         FROM st LEFT JOIN mv ON mv.eq_cd = st.eq_cd LEFT JOIN eq110 mi ON mi.mi_cd = mv.mi_cd
        ORDER BY st.alert_count DESC, st.eq_cd, mv.mi_cd`,
      [...params, ...params],
    );
  },
});
