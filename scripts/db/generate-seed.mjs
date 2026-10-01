// 가상 MES/ERP 기준정보·거래 데이터 생성기 — db/init/02-master.sql, 03-seed.sql 산출
// 실행: npm run db:seed — 같은 설정이면 같은 결과(고정 시드 난수)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL("../../db/init/", import.meta.url));

// ── 생성 설정 — 기간·설비·품번·측정 항목·이상 사례는 여기서만 조정

const CONFIG = {
  seed: 20260928,
  period: { from: "2026-08-03", to: "2026-09-25" }, // 평일만 생성
  hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],    // 설비 상태·측정값 수집 시각
};

const MASTER = {
  cm010: [
    ["EG10", "가공 설비군", "부품 가공·성형 설비"],
    ["EG20", "후처리 설비군", "가공품 세정·표면 처리 설비"],
    ["EG30", "시험 설비군", "완성품 환경 시험 설비"],
    ["NG01", "치수 불량", "가공 치수 공차 이탈"],
    ["NG02", "조립 누락", "구성 부품 누락·미체결"],
    ["NG03", "외관 불량", "표면 얼룩·변색·흠집"],
    ["NG04", "접합 불량", "접합부 결합력 부족"],
    ["NG05", "이물 잔류", "후처리 후 이물·오염 잔류"],
  ],
  bp100: [
    ["CUST-CA", "고객사 A", "수요처", "000-0000-0001"],
    ["CUST-CB", "고객사 B", "수요처", "000-0000-0002"],
    ["CUST-CC", "고객사 C", "수요처", "000-0000-0003"],
    ["CUST-SA", "공급사 A(자재공급)", "공급처", "000-0000-0004"],
    ["CUST-SB", "공급사 B(자재공급)", "공급처", "000-0000-0005"],
  ],
  mdl100: [
    ["MA", "제어 모듈 A형", "120x80x30mm 알루미늄 하우징 조립체"],
    ["MB", "구동 유닛 B형", "150x100x60mm 강판 프레임 조립체"],
  ],
  // [품번, 품명, 규격, 수요처, 모델, 자재 공급처, 입고 단가, 출고 단가, 일 지시 기준 수량]
  it100: [
    ["P2101-00", "제어 모듈 하우징", "AL6061 120x80", "CUST-CA", "MA", "CUST-SA", 15000, 243200, 500],
    ["P2102-00", "제어 모듈 커버", "AL6061 120x80 t2", "CUST-CA", "MA", "CUST-SB", 18000, 210000, 400],
    ["P3101-00", "구동 유닛 브래킷", "SPCC t3.2", "CUST-CC", "MB", "CUST-SA", 25000, 195700, 600],
    ["P3102-00", "구동 유닛 베이스", "SPCC t4.5", "CUST-CB", "MB", "CUST-SB", 9000, 88000, 450],
  ],
  eq100: [
    ["M-101", "가공기 1호기", "L01", "EG10", "1공장 가공동"],
    ["F-101", "후처리기 1호기", "L01", "EG20", "1공장 후처리동"],
    ["M-201", "가공기 2호기", "L02", "EG10", "1공장 가공동"],
    ["F-201", "후처리기 2호기", "L02", "EG20", "1공장 후처리동"],
    ["T-301", "환경 시험기 1호기", "L03", "EG30", "2공장 시험동"],
  ],
  eq110: [
    ["TMP", "온도", "℃"],
    ["HUM", "습도", "%"],
    ["PRS", "압력", "bar"],
    ["VIB", "진동", "mm/s"],
    ["AMP", "부하 전류", "A"],
  ],
  // [설비 구분, 측정 항목, 하한, 상한] — 경보 플래그는 이 규격 이탈로만 산출
  eq120: [
    ["EG10", "HUM", null, 60],
    ["EG10", "VIB", null, 7.1],
    ["EG20", "PRS", 3.0, null],
  ],
  hr100: [
    ["EMP001", "박지훈", "생산기술부", "A조"],
    ["EMP002", "윤서준", "품질보증팀", "B조"],
    ["EMP003", "한동욱", "생산기술부", "B조"],
    ["EMP004", "최유진", "품질보증팀", "A조"],
    ["EMP005", "정수아", "생산기술부", "A조"],
  ],
};

// 설비 구분별 측정 항목과 평시 범위 — 항목 추가는 여기와 eq110 에 행 추가
const MEASURE = {
  EG10: { TMP: [24, 30], HUM: [40, 50], VIB: [2.0, 4.5], AMP: [12, 18] },
  EG20: { TMP: [60, 68], PRS: [4.0, 4.5] },
  EG30: { TMP: [20, 25], PRS: [0.1, 0.2] },
};

// 라인 구성 — 요일마다 품번을 번갈아 생산, 가공 공정 후 후처리 공정 통과
const LINES = [
  { line: "L01", main: "M-101", post: "F-101", parts: ["P2101-00", "P2102-00"], workers: ["EMP001", "EMP005"] },
  { line: "L02", main: "M-201", post: "F-201", parts: ["P3101-00", "P3102-00"], workers: ["EMP003"] },
];
const INSPECTORS = ["EMP002", "EMP004"];
const POST_DEFECT = "NG05";

// 평시 불량 코드 비중
const BASE_DEFECT_MIX = { NG01: 3, NG02: 2, NG03: 2, NG04: 2, NG05: 1 };
const DEFECT_DESC = {
  NG01: "가공 치수 공차 이탈 검출",
  NG02: "구성 부품 누락 발생",
  NG03: "표면 얼룩·변색 발생",
  NG04: "접합부 결합력 부족 검출",
  NG05: "후처리 후 이물 잔류 검출",
};

// 이상 사례 — 보고서가 찾아내야 할 특이사항, 항목 추가로 확장
// sensor: 지정 시각의 측정 항목 범위와 설비 상태(미지정 시 RUN)
// desc: 불량 현상만 기술 — 원인은 측정값·규격 대조로만 드러나게 함
const SCENARIOS = [
  {
    id: "humidity-appearance",
    eqm: "M-101", from: "2026-08-26", to: "2026-08-27",
    mainDefectRate: [0.028, 0.034], defectMix: { NG03: 8, NG01: 1, NG04: 1 },
    sensor: { item: "HUM", range: [62, 68], hours: [10, 11, 12, 13, 14] },
    desc: { NG03: "표면 얼룩·변색 다발" },
  },
  {
    id: "post-pressure-stop",
    eqm: "F-101", from: "2026-09-09", to: "2026-09-09",
    postThroughput: 0.6,
    sensor: { item: "PRS", range: [2.2, 2.8], hours: [10, 11, 12, 13], status: "STOP" },
  },
  {
    id: "vibration-spike",
    eqm: "M-201", from: "2026-09-22", to: "2026-09-24",
    mainDefectRate: [0.042, 0.058], defectMix: { NG01: 7, NG02: 2, NG04: 1 },
    sensor: { item: "VIB", range: [8.0, 11.0], hours: [9, 10, 13, 14, 15], status: "ALARM" },
    desc: { NG01: "가공 치수 공차 이탈 급증" },
  },
];

// ── 난수·날짜 유틸

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(CONFIG.seed);
const between = (lo, hi) => lo + (hi - lo) * rand();
const round = (v, step = 1) => Math.round(v / step) * step;
const fixed = (v, d = 3) => Number(v.toFixed(d));

function* workdays(from, to) {
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) yield d.toISOString().slice(0, 10);
  }
}
const inRange = (date, s) => date >= s.from && date <= s.to;
const scenarioOf = (eqm, date) => SCENARIOS.find((s) => s.eqm === eqm && inRange(date, s));
const weekStart = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 규격 이탈 판정 — 설비 구분의 규격 항목 중 하나라도 하한 미만·상한 초과면 이탈
const SPEC = MASTER.eq120.map(([type, item, lo, hi]) => ({ type, item, lo, hi }));
const outOfSpec = (type, values) =>
  SPEC.some((s) => s.type === type && values[s.item] != null && ((s.lo != null && values[s.item] < s.lo) || (s.hi != null && values[s.item] > s.hi)));

// 수량을 비중대로 분할 — 합계 보존
function split(total, mix) {
  const codes = Object.keys(mix);
  const weights = codes.map((c) => mix[c] * between(0.6, 1.4));
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i]++;
  return codes.map((c, i) => [c, parts[i]]).filter(([, q]) => q > 0);
}

// ── 거래 데이터 생성

const partInfo = Object.fromEntries(MASTER.it100.map((p) => [p[0], { cust: p[3], supplier: p[5], inPrice: p[6], outPrice: p[7], base: p[8] }]));
const pp300 = [], qm310 = [], eq300 = [], eq310 = [], mm200 = [], mm210 = [], sd200 = [], fi200 = [];
const weeklyGood = new Map();   // 주차·품번별 후처리 공정 양품 — 제품 출고 근거
const weeklyIssue = new Map();  // 주차·품번별 자재 불출 — 자재 입고 근거

const days = [...workdays(CONFIG.period.from, CONFIG.period.to)];
days.forEach((date, dayIdx) => {
  for (const L of LINES) {
    const partNo = L.parts[dayIdx % L.parts.length];
    const worker = L.workers[dayIdx % L.workers.length];
    const target = round(partInfo[partNo].base * between(0.9, 1.1), 10);

    // 가공 공정
    const mainSc = scenarioOf(L.main, date);
    const mainRate = mainSc?.mainDefectRate ? between(...mainSc.mainDefectRate) : between(0.006, 0.016);
    const produced = target - round(target * between(0, 0.02));
    const mainDefect = Math.max(1, round(produced * mainRate));
    const mainGood = produced - mainDefect;
    pp300.push([date, L.main, partNo, target, mainGood, mainDefect, worker]);
    for (const [code, qty] of split(mainDefect, mainSc?.defectMix ?? BASE_DEFECT_MIX)) {
      qm310.push([date, L.main, partNo, code, qty, mainSc?.desc?.[code] ?? DEFECT_DESC[code], INSPECTORS[qm310.length % INSPECTORS.length]]);
    }

    // 후처리 공정 — 가공 양품을 지시 수량으로 받음
    const postSc = scenarioOf(L.post, date);
    const postTarget = mainGood;
    const postProcessed = postSc?.postThroughput ? round(postTarget * postSc.postThroughput) : postTarget;
    const postDefect = rand() < 0.35 ? Math.max(1, round(postProcessed * between(0.001, 0.003))) : 0;
    const postGood = postProcessed - postDefect;
    pp300.push([date, L.post, partNo, postTarget, postGood, postDefect, worker]);
    if (postDefect > 0) qm310.push([date, L.post, partNo, POST_DEFECT, postDefect, DEFECT_DESC[POST_DEFECT], INSPECTORS[qm310.length % INSPECTORS.length]]);

    // 자재 불출 — 라인 투입분
    mm210.push([date, partNo, target, L.line]);

    const wk = `${weekStart(date)}|${partNo}`;
    weeklyGood.set(wk, (weeklyGood.get(wk) ?? 0) + postGood);
    weeklyIssue.set(wk, (weeklyIssue.get(wk) ?? 0) + target);
  }

  // 설비 상태 로그와 측정값 — 설비 구분에 정의된 항목만 측정
  for (const [eqmId, , , type] of MASTER.eq100) {
    const sc = scenarioOf(eqmId, date);
    for (const h of CONFIG.hours) {
      const ts = `${date} ${String(h).padStart(2, "0")}:${String(round(between(0, 5))).padStart(2, "0")}:00`;
      const hit = sc?.sensor?.hours.includes(h) ? sc.sensor : null;
      const values = Object.fromEntries(
        Object.entries(MEASURE[type]).map(([item, range]) => [item, fixed(hit?.item === item ? between(...hit.range) : between(...range))]),
      );
      const logId = eq300.length + 1;
      eq300.push([logId, ts, eqmId, hit?.status ?? "RUN", outOfSpec(type, values)]);
      for (const [item, v] of Object.entries(values)) eq310.push([logId, item, v]);
    }
  }
});

// 주간 자재 입고(월요일)·제품 출고(금요일)와 ERP 입출고 금액
const lastWeek = weekStart(CONFIG.period.to);
for (const [key, issued] of weeklyIssue) {
  const [wk, partNo] = key.split("|");
  const p = partInfo[partNo];
  const inQty = round(issued * between(1.02, 1.12), 100);
  mm200.push([wk, p.supplier, partNo, inQty, wk === lastWeek ? "TEMP" : "COMP"]);
  fi200.push([wk, "IN", p.supplier, partNo, inQty, p.inPrice, inQty * p.inPrice]);

  const shipDate = addDays(wk, 4);
  const shipQty = round((weeklyGood.get(key) ?? 0) * between(0.9, 1.0), 10);
  if (shipQty > 0) {
    sd200.push([shipDate, p.cust, partNo, shipQty]);
    fi200.push([shipDate, "OUT", p.cust, partNo, shipQty, p.outPrice, shipQty * p.outPrice]);
  }
}
fi200.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

// ── SQL 출력

const lit = (v) => (v === null ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
function inserts(table, cols, rows, chunk = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const body = rows.slice(i, i + chunk).map((r) => `(${r.map(lit).join(", ")})`).join(",\n");
    out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n${body};`);
  }
  return out.join("\n\n");
}
const header = (title) => `-- ${title}\n-- 자동 생성 파일 — scripts/db/generate-seed.mjs 수정 후 npm run db:seed 로 재생성\n`;

const master = [
  header("가상 MES/ERP 기준정보"),
  inserts("cm010", ["cd_id", "cd_nm", "cd_desc"], MASTER.cm010),
  inserts("bp100", ["bp_cd", "bp_nm", "bp_tp", "tel_no"], MASTER.bp100),
  inserts("mdl100", ["mdl_cd", "mdl_nm", "mdl_spec"], MASTER.mdl100),
  inserts("it100", ["itm_cd", "itm_nm", "itm_spec", "bp_cd", "mdl_cd"], MASTER.it100.map((p) => p.slice(0, 5))),
  inserts("eq100", ["eq_cd", "eq_nm", "ln_cd", "eq_tp", "loc_nm"], MASTER.eq100),
  inserts("eq110", ["mi_cd", "mi_nm", "unit"], MASTER.eq110),
  inserts("eq120", ["eq_tp", "mi_cd", "lo_lmt", "hi_lmt"], MASTER.eq120),
  inserts("hr100", ["emp_id", "emp_nm", "dept_nm", "shift_cd"], MASTER.hr100),
].join("\n\n") + "\n";

const seed = [
  header(`가상 MES/ERP 거래 데이터 — ${CONFIG.period.from} ~ ${CONFIG.period.to} 평일, 이상 사례: ${SCENARIOS.map((s) => s.id).join(", ")}`),
  inserts("pp300", ["wk_dt", "eq_cd", "itm_cd", "ord_qty", "ok_qty", "ng_qty", "emp_id"], pp300),
  inserts("qm310", ["wk_dt", "eq_cd", "itm_cd", "ng_cd", "ng_qty", "ng_desc", "insp_id"], qm310),
  inserts("eq300", ["log_id", "log_dtm", "eq_cd", "st_cd", "alm_yn"], eq300),
  inserts("eq310", ["log_id", "mi_cd", "mv"], eq310),
  inserts("mm200", ["in_dt", "bp_cd", "itm_cd", "in_qty", "cls_st"], mm200),
  inserts("mm210", ["out_dt", "itm_cd", "out_qty", "ln_cd"], mm210),
  inserts("sd200", ["out_dt", "bp_cd", "itm_cd", "out_qty"], sd200),
  inserts("fi200", ["io_dt", "io_tp", "bp_cd", "itm_cd", "io_qty", "unit_prc", "io_amt"], fi200),
].join("\n\n") + "\n";

writeFileSync(`${OUT_DIR}02-master.sql`, master);
writeFileSync(`${OUT_DIR}03-seed.sql`, seed);
console.log(`workdays=${days.length} pp300=${pp300.length} qm310=${qm310.length} eq300=${eq300.length} eq310=${eq310.length} mm200=${mm200.length} mm210=${mm210.length} sd200=${sd200.length} fi200=${fi200.length}`);
