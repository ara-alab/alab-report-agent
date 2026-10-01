-- 가상 MES 데이터 불변식 검사 — 위반 건수가 모두 0 이어야 정상
-- 실행: npm run db:check
-- 한계: 행 단위 관계만 검사, 이상 사례의 의도된 수치 범위는 검사하지 않음

-- 표 적재 확인 — 빈 표에서 위반 0건이 나오는 착시 방지
SELECT 'rows' AS chk, 'pp300' AS tbl, COUNT(*) AS n FROM pp300
UNION ALL SELECT 'rows', 'qm310', COUNT(*) FROM qm310
UNION ALL SELECT 'rows', 'eq300', COUNT(*) FROM eq300
UNION ALL SELECT 'rows', 'eq310', COUNT(*) FROM eq310
UNION ALL SELECT 'rows', 'mm200', COUNT(*) FROM mm200
UNION ALL SELECT 'rows', 'mm210', COUNT(*) FROM mm210
UNION ALL SELECT 'rows', 'sd200', COUNT(*) FROM sd200
UNION ALL SELECT 'rows', 'fi200', COUNT(*) FROM fi200
UNION ALL SELECT 'rows', 'eq110', COUNT(*) FROM eq110
UNION ALL SELECT 'rows', 'eq120', COUNT(*) FROM eq120;

-- 생산 수량 범위 — 음수 또는 양품+불량이 지시 수량 초과
SELECT 'violation' AS chk, 'pp300_qty_range' AS rule_name, COUNT(*) AS n
  FROM pp300 WHERE ok_qty < 0 OR ng_qty < 0 OR ok_qty + ng_qty > ord_qty
-- 불량 상세 합계 = 실적 불량 수량(일자·설비·품번 단위)
UNION ALL SELECT 'violation', 'qm310_sum_eq_pp300_ng', COUNT(*) FROM (
  SELECT p.wk_dt, p.eq_cd, p.itm_cd
    FROM pp300 p LEFT JOIN qm310 q
      ON q.wk_dt = p.wk_dt AND q.eq_cd = p.eq_cd AND q.itm_cd = p.itm_cd
   GROUP BY p.rslt_id, p.wk_dt, p.eq_cd, p.itm_cd, p.ng_qty
  HAVING COALESCE(SUM(q.ng_qty), 0) <> p.ng_qty) x
-- 실적 없는 불량 상세
UNION ALL SELECT 'violation', 'qm310_without_pp300', COUNT(*)
  FROM qm310 q LEFT JOIN pp300 p
    ON p.wk_dt = q.wk_dt AND p.eq_cd = q.eq_cd AND p.itm_cd = q.itm_cd
 WHERE p.rslt_id IS NULL
-- 거래 금액 = 수량 × 단가
UNION ALL SELECT 'violation', 'fi200_amount', COUNT(*) FROM fi200 WHERE io_amt <> io_qty * unit_prc
-- ERP 입고 합계 = 자재 입고 합계, ERP 출고 합계 = 제품 출고 합계
UNION ALL SELECT 'violation', 'fi200_in_eq_mm200', ABS((SELECT COALESCE(SUM(io_qty), 0) FROM fi200 WHERE io_tp = 'IN') - (SELECT COALESCE(SUM(in_qty), 0) FROM mm200)) > 0
UNION ALL SELECT 'violation', 'fi200_out_eq_sd200', ABS((SELECT COALESCE(SUM(io_qty), 0) FROM fi200 WHERE io_tp = 'OUT') - (SELECT COALESCE(SUM(out_qty), 0) FROM sd200)) > 0
-- 알람 상태는 경보 플래그 동반
UNION ALL SELECT 'violation', 'eq300_alarm_flag', COUNT(*) FROM eq300 WHERE st_cd = 'ALARM' AND NOT alm_yn
-- 측정값 없는 상태 로그 — 측정값 적재 누락
UNION ALL SELECT 'violation', 'eq300_without_eq310', COUNT(*)
  FROM eq300 h WHERE NOT EXISTS (SELECT 1 FROM eq310 v WHERE v.log_id = h.log_id)
-- 규격 항목이 해당 설비 구분에서 한 번도 측정되지 않음 — 판정 불가 규격
UNION ALL SELECT 'violation', 'eq120_item_unmeasured', COUNT(*)
  FROM eq120 s
 WHERE NOT EXISTS (SELECT 1 FROM eq310 v JOIN eq300 h ON h.log_id = v.log_id JOIN eq100 e ON e.eq_cd = h.eq_cd
                    WHERE e.eq_tp = s.eq_tp AND v.mi_cd = s.mi_cd)
-- 경보 플래그 = 설비 구분 규격 중 하나 이상 이탈
UNION ALL SELECT 'violation', 'eq300_alarm_eq_spec', COUNT(*)
  FROM eq300 h JOIN eq100 e ON e.eq_cd = h.eq_cd
 WHERE h.alm_yn <> EXISTS (
   SELECT 1 FROM eq310 v JOIN eq120 s ON s.eq_tp = e.eq_tp AND s.mi_cd = v.mi_cd
    WHERE v.log_id = h.log_id
      AND v.mv NOT BETWEEN COALESCE(s.lo_lmt, -1e9) AND COALESCE(s.hi_lmt, 1e9))
-- 후처리 공정 지시 수량 = 같은 날 같은 라인·품번의 가공 양품
UNION ALL SELECT 'violation', 'post_ord_eq_main_ok', COUNT(*)
  FROM pp300 w JOIN eq100 we ON we.eq_cd = w.eq_cd AND we.eq_tp = 'EG20'
  LEFT JOIN (SELECT p.wk_dt, p.itm_cd, e.ln_cd, p.ok_qty
               FROM pp300 p JOIN eq100 e ON e.eq_cd = p.eq_cd AND e.eq_tp = 'EG10') m
    ON m.wk_dt = w.wk_dt AND m.itm_cd = w.itm_cd AND m.ln_cd = we.ln_cd
 WHERE m.ok_qty IS NULL OR m.ok_qty <> w.ord_qty;
