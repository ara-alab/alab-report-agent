// 테이블·컬럼 설명 — 구조(타입·키)는 DB 에서 읽고 의미만 여기서 보강, 테이블 추가 시 항목 추가
export type TableDoc = {
  title: string;
  domain: "기준정보" | "MES" | "ERP";
  description: string;
  columns: Record<string, string>;
};

export const TABLE_DOCS: Record<string, TableDoc> = {
  cm010: {
    title: "공통 코드",
    domain: "기준정보",
    description: "설비 구분(EG*)과 불량 유형(NG*) 코드명 사전. 불량 코드명은 qm310.ng_cd 와 조인해 얻음",
    columns: {
      cd_id: "코드, 예: EG10, EG20, NG01",
      cd_nm: "코드명, 예: 가공 설비군, 치수 불량",
      cd_desc: "코드 설명",
      use_yn: "사용 여부 Y/N",
    },
  },
  bp100: {
    title: "거래처",
    domain: "기준정보",
    description: "자재 공급처와 제품 수요처",
    columns: {
      bp_cd: "거래처 코드",
      bp_nm: "거래처명",
      bp_tp: "거래처 구분: 공급처, 수요처",
      tel_no: "전화번호",
    },
  },
  mdl100: {
    title: "제품 모델",
    domain: "기준정보",
    description: "품번을 묶는 제품 모델",
    columns: {
      mdl_cd: "모델 코드, 예: MA",
      mdl_nm: "모델명",
      mdl_spec: "모델 사양",
    },
  },
  it100: {
    title: "품목",
    domain: "기준정보",
    description: "생산·입출고 대상 품번과 품명, 수요 거래처·모델",
    columns: {
      itm_cd: "품번, 예: P2101-00",
      itm_nm: "품명",
      itm_spec: "규격",
      bp_cd: "수요 거래처 코드(bp100)",
      mdl_cd: "모델 코드(mdl100)",
    },
  },
  eq100: {
    title: "설비",
    domain: "기준정보",
    description: "설비별 라인·설비 구분. 라인 단위 집계는 eq100.ln_cd 를 통해 수행",
    columns: {
      eq_cd: "설비 코드, 예: M-101, F-101",
      eq_nm: "설비명",
      ln_cd: "라인 코드, 예: L01",
      eq_tp: "설비 구분 코드(cm010): EG10 가공, EG20 후처리, EG30 시험",
      loc_nm: "설치 위치",
    },
  },
  eq110: {
    title: "측정 항목",
    domain: "기준정보",
    description: "설비 측정값(eq310)의 항목 코드와 이름·단위",
    columns: {
      mi_cd: "측정 항목 코드, 예: TMP, HUM, PRS, VIB, AMP",
      mi_nm: "측정 항목명",
      unit: "단위",
    },
  },
  eq120: {
    title: "설비 구분별 측정 규격",
    domain: "기준정보",
    description: "설비 구분별 측정 항목의 하한·상한. eq300 경보(alm_yn)는 같은 로그의 측정값 중 하나 이상이 이 규격을 이탈하면 1. 규격 미등록 항목은 경보 판정 대상 아님",
    columns: {
      eq_tp: "설비 구분 코드(cm010)",
      mi_cd: "측정 항목 코드(eq110)",
      lo_lmt: "하한, NULL 은 하한 없음",
      hi_lmt: "상한, NULL 은 상한 없음",
    },
  },
  hr100: {
    title: "인원",
    domain: "기준정보",
    description: "작업자·검사자 사번과 소속 부서",
    columns: {
      emp_id: "사번",
      emp_nm: "성명",
      dept_nm: "소속 부서",
      shift_cd: "근무 조",
    },
  },
  pp300: {
    title: "생산 실적",
    domain: "MES",
    description:
      "작업일·설비·품번 단위 지시·양품·불량 수량. 같은 품목이 가공 공정(EG10) → 후처리 공정(EG20) 순으로 흐르며, 가공 공정은 설비 구분 EG10(가공 설비군), 후처리 공정은 EG20(후처리 설비군) 설비가 담당하고, 후처리 공정 지시 수량은 같은 날·라인·품번의 가공 양품 수량. 흐름 수량(지시·양품)과 생산 KPI 의 기준 공정은 EG10. 불량 수량은 공정별로 따로 발생한 사건",
    columns: {
      rslt_id: "실적 ID",
      wk_dt: "작업 일자",
      eq_cd: "설비 코드(eq100)",
      itm_cd: "품번(it100)",
      ord_qty: "지시 수량(흐름 수량), 달성률 분모",
      ok_qty: "양품 수량(흐름 수량), 달성률 분자",
      ng_qty: "불량 수량(사건 수량), 불량률 분자(분모는 같은 공정의 양품+불량)",
      emp_id: "작업자 사번(hr100)",
    },
  },
  qm310: {
    title: "불량 상세",
    domain: "MES",
    description: "불량 발생 건별 코드·수량·현상. 작업일·설비·품번별 합계는 pp300.ng_qty 와 일치. 공정별로 따로 발생한 사건이므로 공정 간 합산 가능",
    columns: {
      ng_id: "불량 로그 ID",
      wk_dt: "작업 일자",
      eq_cd: "설비 코드(eq100)",
      itm_cd: "품번(it100)",
      ng_cd: "불량 코드, 코드명은 cm010.cd_id 와 조인. NG01 치수 불량, NG02 조립 누락, NG03 외관 불량, NG04 접합 불량, NG05 이물 잔류",
      ng_qty: "불량 수량",
      ng_desc: "불량 현상 설명",
      insp_id: "검사자 사번(hr100)",
    },
  },
  eq300: {
    title: "설비 상태 로그",
    domain: "MES",
    description: "설비별 가동일 08~17시 시간 단위 수집 로그의 상태·경보. 측정값은 eq310 에 log_id 로 연결. 가동률은 RUN 건수 ÷ 로그 건수로 근사",
    columns: {
      log_id: "로그 ID",
      log_dtm: "수집 시각",
      eq_cd: "설비 코드(eq100)",
      st_cd: "설비 상태: RUN, STOP, ALARM",
      alm_yn: "규격 이탈 경보 여부(0/1), ALARM 상태는 항상 1",
    },
  },
  eq310: {
    title: "설비 측정값",
    domain: "MES",
    description: "상태 로그(eq300)별 측정 항목 1행. 설비 구분에 따라 측정 항목이 다르며 측정한 항목만 존재. 시각·설비는 eq300 과 조인해 얻음",
    columns: {
      log_id: "로그 ID(eq300)",
      mi_cd: "측정 항목 코드(eq110)",
      mv: "측정값, 단위는 eq110.unit",
    },
  },
  mm200: {
    title: "자재 입고",
    domain: "ERP",
    description: "공급처로부터의 원자재 입고. 입고 금액은 fi200(io_tp='IN') 에 있음",
    columns: {
      in_id: "입고 ID",
      in_dt: "입고 일자",
      bp_cd: "공급 거래처 코드(bp100)",
      itm_cd: "입고 품번(it100)",
      in_qty: "입고 수량",
      cls_st: "마감 상태: COMP 완료, TEMP 임시",
    },
  },
  mm210: {
    title: "자재 불출",
    domain: "ERP",
    description: "생산 라인으로의 원자재 불출",
    columns: {
      out_id: "불출 ID",
      out_dt: "불출 일자",
      itm_cd: "불출 품번(it100)",
      out_qty: "불출 수량",
      ln_cd: "투입 라인 코드",
    },
  },
  sd200: {
    title: "제품 출고",
    domain: "ERP",
    description: "수요처로의 완제품 출고. 출고 금액은 fi200(io_tp='OUT') 에 있음",
    columns: {
      out_id: "출고 ID",
      out_dt: "출고 일자",
      bp_cd: "수요 거래처 코드(bp100)",
      itm_cd: "출고 품번(it100)",
      out_qty: "출고 수량",
    },
  },
  fi200: {
    title: "입출고 금액",
    domain: "ERP",
    description: "자재 입고(mm200)·제품 출고(sd200) 건별 단가·금액. IN 수량 합계는 mm200, OUT 수량 합계는 sd200 과 일치",
    columns: {
      io_id: "입출고 ID",
      io_dt: "입출고 일자",
      io_tp: "입출 구분: IN 자재 입고, OUT 제품 출고",
      bp_cd: "거래처 코드(bp100)",
      itm_cd: "품번(it100)",
      io_qty: "거래 수량",
      unit_prc: "단가(원)",
      io_amt: "금액(원) = 수량 × 단가",
    },
  },
};
