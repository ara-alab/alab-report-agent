-- ========================================================
-- MES/ERP 연동용 가상 DB 스키마 v4
-- 용도: 보고서 기안 Agent의 조회 대상 MES/ERP 데이터
-- 명명: 업무 영역 약어 + 번호(cm 공통, bp 거래처, it 품목, mdl 모델, eq 설비, hr 인원, pp 생산, qm 품질, mm 자재, sd 출하, fi 금액)
-- 데이터: 02-master.sql(기준정보), 03-seed.sql(거래 데이터) — scripts/db/generate-seed.mjs 산출물
-- ========================================================

-- 1. 공통 코드 (cm010)
CREATE TABLE cm010 (
    cd_id VARCHAR(20) PRIMARY KEY,         -- 코드 (예: 'EG10' 설비 구분, 'NG01' 불량 유형)
    cd_nm VARCHAR(100) NOT NULL,           -- 코드명 (예: '가공 설비군', '치수 불량')
    cd_desc VARCHAR(250),                  -- 설명
    use_yn CHAR(1) DEFAULT 'Y'             -- 사용 여부
);

-- 2. 거래처 (bp100)
CREATE TABLE bp100 (
    bp_cd VARCHAR(50) PRIMARY KEY,         -- 거래처 코드 (예: 'CUST-CA', 'CUST-SA')
    bp_nm VARCHAR(100) NOT NULL,           -- 거래처명
    bp_tp VARCHAR(20),                     -- 거래처 구분 (예: '수요처', '공급처')
    tel_no VARCHAR(20)                     -- 전화번호
);

-- 3. 제품 모델 (mdl100)
CREATE TABLE mdl100 (
    mdl_cd VARCHAR(50) PRIMARY KEY,        -- 모델 코드 (예: 'MA', 'MB')
    mdl_nm VARCHAR(100) NOT NULL,          -- 모델명
    mdl_spec VARCHAR(150)                  -- 모델 사양
);

-- 4. 품목 (it100)
CREATE TABLE it100 (
    itm_cd VARCHAR(50) PRIMARY KEY,        -- 품번 (예: 'P2101-00')
    itm_nm VARCHAR(100) NOT NULL,          -- 품명
    itm_spec VARCHAR(100),                 -- 규격
    bp_cd VARCHAR(50),                     -- 수요 거래처 코드 (bp100)
    mdl_cd VARCHAR(50),                    -- 모델 코드 (mdl100)
    FOREIGN KEY (bp_cd) REFERENCES bp100(bp_cd),
    FOREIGN KEY (mdl_cd) REFERENCES mdl100(mdl_cd)
);

-- 5. 설비 (eq100)
CREATE TABLE eq100 (
    eq_cd VARCHAR(50) PRIMARY KEY,         -- 설비 코드 (예: 'M-101')
    eq_nm VARCHAR(100) NOT NULL,           -- 설비명
    ln_cd VARCHAR(20) NOT NULL,            -- 라인 코드 (예: 'L01')
    eq_tp VARCHAR(20),                     -- 설비 구분 코드 (cm010)
    loc_nm VARCHAR(50),                    -- 설치 위치
    FOREIGN KEY (eq_tp) REFERENCES cm010(cd_id)
);

-- 6. 측정 항목 (eq110)
CREATE TABLE eq110 (
    mi_cd VARCHAR(10) PRIMARY KEY,         -- 측정 항목 코드 (예: 'TMP', 'VIB')
    mi_nm VARCHAR(50) NOT NULL,            -- 측정 항목명
    unit VARCHAR(10)                       -- 단위
);

-- 7. 설비 구분별 측정 규격 (eq120)
-- 용도: 측정값(eq310) 항목별 상하한 — 경보 판정과 이상 원인 판정의 기준
CREATE TABLE eq120 (
    eq_tp VARCHAR(20) NOT NULL,            -- 설비 구분 코드 (cm010)
    mi_cd VARCHAR(10) NOT NULL,            -- 측정 항목 코드 (eq110)
    lo_lmt DECIMAL(10, 3),                 -- 하한, NULL 이면 하한 없음
    hi_lmt DECIMAL(10, 3),                 -- 상한, NULL 이면 상한 없음
    PRIMARY KEY (eq_tp, mi_cd),
    FOREIGN KEY (eq_tp) REFERENCES cm010(cd_id),
    FOREIGN KEY (mi_cd) REFERENCES eq110(mi_cd)
);

-- 8. 인원 (hr100)
CREATE TABLE hr100 (
    emp_id VARCHAR(50) PRIMARY KEY,        -- 사번
    emp_nm VARCHAR(50) NOT NULL,           -- 성명
    dept_nm VARCHAR(50) NOT NULL,          -- 소속 부서
    shift_cd VARCHAR(20)                   -- 근무 조
);

-- 9. 생산 실적 (pp300)
CREATE TABLE pp300 (
    rslt_id INT AUTO_INCREMENT PRIMARY KEY, -- 실적 ID
    wk_dt DATE NOT NULL,                    -- 작업 일자
    eq_cd VARCHAR(50),                      -- 설비 코드 (eq100)
    itm_cd VARCHAR(50),                     -- 품번 (it100)
    ord_qty INT DEFAULT 0,                  -- 지시 수량
    ok_qty INT DEFAULT 0,                   -- 양품 수량
    ng_qty INT DEFAULT 0,                   -- 불량 수량
    emp_id VARCHAR(50),                     -- 작업자 사번 (hr100)
    FOREIGN KEY (eq_cd) REFERENCES eq100(eq_cd),
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd),
    FOREIGN KEY (emp_id) REFERENCES hr100(emp_id)
);

-- 10. 불량 상세 (qm310)
CREATE TABLE qm310 (
    ng_id INT AUTO_INCREMENT PRIMARY KEY,  -- 불량 로그 ID
    wk_dt DATE NOT NULL,                   -- 작업 일자
    eq_cd VARCHAR(50),                     -- 설비 코드 (eq100)
    itm_cd VARCHAR(50),                    -- 품번 (it100)
    ng_cd VARCHAR(20) NOT NULL,            -- 불량 코드 (cm010)
    ng_qty INT DEFAULT 0,                  -- 불량 수량
    ng_desc TEXT,                          -- 불량 현상 설명
    insp_id VARCHAR(50),                   -- 검사자 사번 (hr100)
    FOREIGN KEY (eq_cd) REFERENCES eq100(eq_cd),
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd),
    FOREIGN KEY (insp_id) REFERENCES hr100(emp_id)
);

-- 11. 설비 상태 로그 (eq300) — 수집 시점별 상태·경보, 측정값은 eq310
CREATE TABLE eq300 (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY, -- 로그 ID
    log_dtm TIMESTAMP NOT NULL,               -- 수집 시각
    eq_cd VARCHAR(50) NOT NULL,               -- 설비 코드 (eq100)
    st_cd VARCHAR(10) NOT NULL DEFAULT 'RUN', -- 설비 상태 (RUN, STOP, ALARM)
    alm_yn BOOLEAN NOT NULL DEFAULT FALSE,    -- 규격 이탈 경보 여부
    KEY ix_eq300_eq_dtm (eq_cd, log_dtm),
    FOREIGN KEY (eq_cd) REFERENCES eq100(eq_cd)
);

-- 12. 측정값 (eq310) — 로그별 측정 항목 1행, 측정한 항목만 적재
CREATE TABLE eq310 (
    log_id BIGINT NOT NULL,                -- 로그 ID (eq300)
    mi_cd VARCHAR(10) NOT NULL,            -- 측정 항목 코드 (eq110)
    mv DECIMAL(10, 3) NOT NULL,            -- 측정값
    PRIMARY KEY (log_id, mi_cd),
    FOREIGN KEY (log_id) REFERENCES eq300(log_id),
    FOREIGN KEY (mi_cd) REFERENCES eq110(mi_cd)
);

-- 13. 자재 입고 (mm200)
CREATE TABLE mm200 (
    in_id INT AUTO_INCREMENT PRIMARY KEY,  -- 입고 ID
    in_dt DATE NOT NULL,                   -- 입고 일자
    bp_cd VARCHAR(50),                     -- 공급 거래처 코드 (bp100)
    itm_cd VARCHAR(50),                    -- 입고 품번 (it100)
    in_qty INT NOT NULL DEFAULT 0,         -- 입고 수량
    cls_st VARCHAR(20) DEFAULT 'COMP',     -- 마감 상태 (COMP: 완료, TEMP: 임시)
    FOREIGN KEY (bp_cd) REFERENCES bp100(bp_cd),
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd)
);

-- 14. 자재 불출 (mm210)
CREATE TABLE mm210 (
    out_id INT AUTO_INCREMENT PRIMARY KEY, -- 불출 ID
    out_dt DATE NOT NULL,                  -- 불출 일자
    itm_cd VARCHAR(50),                    -- 불출 품번 (it100)
    out_qty INT NOT NULL DEFAULT 0,        -- 불출 수량
    ln_cd VARCHAR(20),                     -- 투입 라인 코드
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd)
);

-- 15. 제품 출고 (sd200)
CREATE TABLE sd200 (
    out_id INT AUTO_INCREMENT PRIMARY KEY, -- 출고 ID
    out_dt DATE NOT NULL,                  -- 출고 일자
    bp_cd VARCHAR(50),                     -- 수요 거래처 코드 (bp100)
    itm_cd VARCHAR(50),                    -- 출고 품번 (it100)
    out_qty INT NOT NULL DEFAULT 0,        -- 출고 수량
    FOREIGN KEY (bp_cd) REFERENCES bp100(bp_cd),
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd)
);

-- 16. 입출고 금액 (fi200) — 자재 입고(mm200)·제품 출고(sd200) 건별 단가·금액
CREATE TABLE fi200 (
    io_id INT AUTO_INCREMENT PRIMARY KEY,  -- 입출고 ID
    io_dt DATE NOT NULL,                   -- 입출고 일자
    io_tp VARCHAR(10) NOT NULL,            -- 입출 구분 (IN: 자재 입고, OUT: 제품 출고)
    bp_cd VARCHAR(50),                     -- 거래처 코드 (bp100)
    itm_cd VARCHAR(50),                    -- 품번 (it100)
    io_qty INT NOT NULL DEFAULT 0,         -- 거래 수량
    unit_prc DECIMAL(12, 2) DEFAULT 0.00,  -- 단가
    io_amt DECIMAL(15, 2) DEFAULT 0.00,    -- 금액 (수량 * 단가)
    FOREIGN KEY (bp_cd) REFERENCES bp100(bp_cd),
    FOREIGN KEY (itm_cd) REFERENCES it100(itm_cd)
);
