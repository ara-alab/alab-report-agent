// 지표·규격 판정 정의 — 현장 KPI 공식·기본 집계 범위·센서 측정 원천, 분석 엔진은 이 정의로만 SQL 조립
// SQL 식은 코드 설정값 전용, 사용자 입력은 바인딩 값으로만 전달

// 집계 원천 — FROM 절과 날짜·집계 단위·필터 식
export type MetricSource = {
  from: string;
  tables: readonly string[];
  date: { expr: string; type: "date" | "datetime" };
  // 날짜 외 집계 단위 — 일·주·월은 엔진이 날짜 식으로 생성
  dimensions: Record<string, string>;
  filters: Record<string, { expr: string; description: string }>;
  // 설비 구분 등 범위 필터 미지정 시 적용할 기본 범위
  defaultScope?: { filter: string; value: string; reason: string };
};

export type KpiDef = {
  id: string;
  name: string;
  source: string;
  // 분자·분모는 같은 원천·같은 범위에서 산출되는 합산 가능 집계식(SUM·COUNT)
  numerator: { label: string; expr: string };
  denominator: { label: string; expr: string };
  scale: number;
  unit: string;
  decimals: number;
  better: "higher" | "lower";
};

export const METRIC_SOURCES: Record<string, MetricSource> = {
  production: {
    from: "pp300 s JOIN eq100 e ON e.eq_cd = s.eq_cd",
    tables: ["pp300", "eq100"],
    date: { expr: "s.wk_dt", type: "date" },
    dimensions: { line: "e.ln_cd", eqm: "s.eq_cd", part: "s.itm_cd", worker: "s.emp_id", eqmType: "e.eq_tp" },
    filters: {
      eqmType: { expr: "e.eq_tp", description: "설비 구분 코드" },
      line: { expr: "e.ln_cd", description: "라인 코드" },
      eqm: { expr: "s.eq_cd", description: "설비 코드" },
      part: { expr: "s.itm_cd", description: "품번" },
    },
    defaultScope: { filter: "eqmType", value: "EG10", reason: "생산 KPI 기준 공정" },
  },
  equipment: {
    from: "eq300 t JOIN eq100 e ON e.eq_cd = t.eq_cd",
    tables: ["eq300", "eq100"],
    date: { expr: "t.log_dtm", type: "datetime" },
    dimensions: { line: "e.ln_cd", eqm: "t.eq_cd", eqmType: "e.eq_tp" },
    filters: {
      eqmType: { expr: "e.eq_tp", description: "설비 구분 코드" },
      line: { expr: "e.ln_cd", description: "라인 코드" },
      eqm: { expr: "t.eq_cd", description: "설비 코드" },
    },
  },
};

export const KPIS: readonly KpiDef[] = [
  {
    id: "achievement_rate",
    name: "달성률",
    source: "production",
    numerator: { label: "양품", expr: "SUM(s.ok_qty)" },
    denominator: { label: "지시", expr: "SUM(s.ord_qty)" },
    scale: 100,
    unit: "%",
    decimals: 2,
    better: "higher",
  },
  {
    id: "defect_ppm",
    name: "불량률",
    source: "production",
    numerator: { label: "불량", expr: "SUM(s.ng_qty)" },
    denominator: { label: "양품+불량", expr: "SUM(s.ok_qty + s.ng_qty)" },
    scale: 1_000_000,
    unit: "PPM",
    decimals: 0,
    better: "lower",
  },
  {
    id: "utilization",
    name: "가동률",
    source: "equipment",
    numerator: { label: "RUN 로그", expr: "SUM(t.st_cd = 'RUN')" },
    denominator: { label: "전체 로그", expr: "COUNT(*)" },
    scale: 100,
    unit: "%",
    decimals: 2,
    better: "higher",
  },
];

// 규격 이탈 판정 원천 — 상태 로그·측정값 행·측정 항목·규격 테이블의 대응
export type LimitSource = {
  // 상태 로그와 대상 마스터 FROM 절, 시각·대상·대상 구분·경보 여부 식
  from: string;
  tables: readonly string[];
  time: string;
  entity: string;
  entityType: string;
  // 원천 시스템이 기록한 경보 여부 — 규격 이탈과 대조
  flag: string;
  // 측정값 행 — 로그당 항목별 1행, 항목 추가는 행 추가로 반영
  readings: { table: string; alias: string; on: string; item: string; value: string };
  // 측정 항목 마스터 — 항목명·단위 원천, 컬럼명
  items: { table: string; code: string; name: string; unit: string };
  filters: Record<string, { expr: string; description: string }>;
  // 대상 구분·항목별 하한·상한, 컬럼명
  spec: { table: string; type: string; item: string; lower: string; upper: string };
};

export const LIMIT_SOURCE: LimitSource = {
  from: "eq300 t JOIN eq100 e ON e.eq_cd = t.eq_cd",
  tables: ["eq300", "eq100", "eq310", "eq110", "eq120"],
  time: "t.log_dtm",
  entity: "t.eq_cd",
  entityType: "e.eq_tp",
  flag: "t.alm_yn",
  readings: { table: "eq310", alias: "r", on: "r.log_id = t.log_id", item: "r.mi_cd", value: "r.mv" },
  items: { table: "eq110", code: "mi_cd", name: "mi_nm", unit: "unit" },
  filters: {
    eqmType: { expr: "e.eq_tp", description: "설비 구분 코드" },
    line: { expr: "e.ln_cd", description: "라인 코드" },
    eqm: { expr: "t.eq_cd", description: "설비 코드" },
  },
  spec: { table: "eq120", type: "eq_tp", item: "mi_cd", lower: "lo_lmt", upper: "hi_lmt" },
};
