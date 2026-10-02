// 성과지표·테스트 케이스 측정 — 로컬 서버에 Agent 요청을 보내 실행 기록 ID와 판정 결과를 public/eval-data/results.json 에 기록
// 전제: 서버를 ALAB_AGENT_RUN_RECORD=1 로 실행, 개발 서버(/api/dev/tools 사용)
// 사용: node scripts/eval/run.mjs [--cases] [--metrics] [--only TC1,R2] [--note "수정 내용"]
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "public", "eval-data", "results.json");
const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:3002";
// 측정 저장 보고서 제목 접미어 — 시험 저장분 구분
const TEST_SUFFIX = " [검증용]";

function parseArgs(argv) {
  const args = { cases: false, metrics: false, only: null, note: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cases") args.cases = true;
    else if (a === "--metrics") args.metrics = true;
    else if (a === "--only") args.only = new Set(String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--note") args.note = String(argv[++i] ?? "");
    else throw new Error(`알 수 없는 인자입니다: ${a}`);
  }
  if (!args.cases && !args.metrics) args.cases = args.metrics = true;
  return args;
}

const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));

// 측정 시점 코드 — HEAD 커밋과 미커밋 변경 여부
function commitInfo() {
  try {
    const head = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() !== "";
    return { commit: head, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

async function postJson(url, body) {
  const res = await fetch(BASE + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Agent 1회 실행 — NDJSON 스트림 전체 수신, 실행 기록 ID·답변·초안·저장·오류·도구 호출 정리
async function runAgent({ account, request, mode }) {
  const res = await fetch(BASE + "/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, messages: [{ role: "user", content: request }], ...(mode ? { mode } : {}) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let body = null;
    try { body = JSON.parse(text); } catch { /* 본문 없음 */ }
    return { runId: null, events: [], answer: "", draft: null, saved: null, error: body?.code ?? `http_${res.status}`, calls: [] };
  }
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const start = events.find((e) => e.type === "start");
  if (!start?.runId) throw new Error("실행 기록 ID가 없습니다. 서버를 ALAB_AGENT_RUN_RECORD=1 로 실행하세요.");
  const inputs = new Map(events.filter((e) => e.type === "tool_call").map((e) => [e.id, e.input]));
  const drafts = events.filter((e) => e.type === "draft");
  return {
    runId: start.runId,
    events,
    answer: events.filter((e) => e.type === "delta").map((e) => e.text).join(""),
    draft: drafts.length ? drafts[drafts.length - 1] : null,
    saved: events.findLast((e) => e.type === "saved") ?? null,
    error: events.find((e) => e.type === "error")?.code ?? null,
    calls: events.filter((e) => e.type === "tool_result").map((e) => ({ ...e, input: inputs.get(e.id) })),
  };
}

async function verify(reportId, account) {
  const res = await fetch(`${BASE}/api/reports/${reportId}/verify?account=${encodeURIComponent(account)}`);
  const body = await res.json().catch(() => null);
  return res.ok ? body.summary : { error: body?.code ?? `http_${res.status}` };
}

// ── 테스트 케이스 판정

async function judgeCheck(check, run, account) {
  const v = check.value;
  switch (check.type) {
    case "drafted":
      return { pass: !!run.draft === v, actual: !!run.draft };
    case "saved":
      return { pass: !!run.saved === v, actual: !!run.saved };
    case "template":
      return { pass: run.draft?.template?.id === v, actual: run.draft?.template?.id ?? null };
    case "period": {
      const p = run.draft?.period;
      return { pass: p?.from === v.from && p?.to === v.to, actual: p ? `${p.from}~${p.to}` : null };
    }
    case "error":
      return { pass: run.error === v, actual: run.error };
    case "draftIncludesAll": {
      const html = run.draft?.html ?? "";
      const missing = v.filter((s) => !html.includes(s));
      return { pass: !!run.draft && missing.length === 0, actual: missing.length ? `없음: ${missing.join(", ")}` : "모두 포함" };
    }
    case "answerIncludesAny": {
      const hit = v.filter((s) => run.answer.includes(s));
      return { pass: hit.length > 0, actual: hit.length ? `포함: ${hit.join(", ")}` : "포함 문구 없음" };
    }
    case "noSuccessfulCallMentioning": {
      const hit = run.calls.filter((c) => c.ok && v.some((s) => JSON.stringify(c.input ?? {}).includes(s)));
      return { pass: hit.length === 0, actual: hit.length ? `성공 호출 ${hit.length}건: ${hit.map((c) => c.name).join(", ")}` : "해당 호출 없음" };
    }
    case "verifiedIfSaved": {
      if (!run.saved) return { pass: true, actual: "저장 안 됨" };
      const s = await verify(run.saved.id, account);
      if (s.error) return { pass: false, actual: `검증 실패: ${s.error}` };
      return { pass: s.match === s.total, actual: `일치 ${s.match}/${s.total}` };
    }
    default:
      throw new Error(`알 수 없는 판정 유형입니다: ${check.type}`);
  }
}

async function runCase(c, meta) {
  const run = await runAgent(c);
  const checks = [];
  for (const check of c.checks) checks.push({ type: check.type, expected: check.value, ...(await judgeCheck(check, run, c.account)) });
  return {
    at: new Date().toISOString(),
    runId: run.runId,
    ...meta,
    verdict: checks.every((k) => k.pass) ? "pass" : "fail",
    checks,
    answer: run.answer.slice(0, 2000),
    drafted: run.draft ? { template: run.draft.template?.id, title: run.draft.title, period: run.draft.period } : null,
    saved: run.saved ? { id: run.saved.id, docNo: run.saved.docNo } : null,
    error: run.error,
  };
}

// ── 성과지표 산출

// 채움 여부 — 키 종류별 비어 있지 않은 값
function filled(fill) {
  if (!fill) return false;
  if (fill.kind === "meta" || fill.kind === "text") return typeof fill.text === "string" && fill.text.trim() !== "";
  if (fill.kind === "stats" || fill.kind === "list") return Array.isArray(fill.items) && fill.items.length > 0;
  if (fill.kind === "table") return Array.isArray(fill.rows) && fill.rows.length > 0;
  if (fill.kind === "value") return fill.value !== undefined && fill.value !== null;
  return false;
}

const shiftDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const spanDays = (p) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;

// 수치 출처 키 — 수치 키의 서식 키 부분(cause#1 → cause, kpi_stats.0 → kpi_stats)
const keyOf = (numberKey) => String(numberKey).split(/[#.[]/)[0];

// 서식 키 출처 판정 — 키의 모든 수치가 기대 원천 도구에서, 요청 기간 또는 직전 비교 기간 범위 안의 조회로 채워졌는지
function judgeSource(numbers, key, tools, period) {
  const own = numbers.filter((n) => keyOf(n.key) === key);
  if (!own.length) return { pass: false, reason: "출처 수치 없음" };
  const earliest = shiftDays(period.from, -spanDays(period));
  const reasons = own.map((n) => {
    if (!n.call) return "출처 없음";
    if (!tools.includes(n.call.name)) return `기대 밖 도구 ${n.call.name}`;
    const { from, to } = n.call.input ?? {};
    return typeof from === "string" && typeof to === "string" && (from < earliest || to > period.to) ? `기간 밖 조회 ${from}~${to}` : null;
  });
  const bad = reasons.filter(Boolean);
  return bad.length ? { pass: false, reason: `${bad.length}/${own.length}건: ${[...new Set(bad)].join(", ")}` } : { pass: true };
}

async function runRequest(r, def, templates) {
  const run = await runAgent({ ...r, mode: "draft" });
  const out = { id: r.id, kind: r.kind, request: r.request, account: r.account, runId: run.runId, error: run.error, template: run.draft?.template?.id ?? null };

  // 데이터 조회 — 조회 도구 호출 중 오류가 아니고 결과 행이 있는 비율
  const queries = run.calls.filter((c) => def.queryTools.includes(c.name));
  out.queries = { ok: queries.filter((c) => c.ok && c.rowCount !== 0).length, total: queries.length };

  // 필수항목 — 기대 서식의 필수 키 중 조회·서술 키(시스템·계정 발급 제외)가 채워진 비율
  const tpl = templates.get(r.template);
  const required = Object.entries(tpl.keys).filter(([, s]) => s.required && (s.by === "query" || s.by === "llm")).map(([k]) => k);
  const fills = run.draft && run.draft.template?.id === r.template ? run.draft.fills : {};
  const missing = required.filter((k) => !filled(fills[k]));
  out.fill = { ok: required.length - missing.length, total: required.length, missing };

  // Template Mapping — 서식 선택, 기간 키 값, 조회 키별 기대 원천
  const units = [{ unit: "template", pass: out.template === r.template, reason: out.template ?? "초안 없음" }];
  units.push({ unit: "period_from", pass: fills.period_from?.text === r.period.from, reason: fills.period_from?.text ?? "값 없음" });
  units.push({ unit: "period_to", pass: fills.period_to?.text === r.period.to, reason: fills.period_to?.text ?? "값 없음" });
  for (const [key, group] of Object.entries(r.keys)) {
    const j = run.draft ? judgeSource(run.draft.numbers ?? [], key, def.sourceGroups[group], r.period) : { pass: false, reason: "초안 없음" };
    units.push({ unit: key, ...j });
  }
  out.mapping = { ok: units.filter((u) => u.pass).length, total: units.length, units };

  // 수치 일치 — 초안을 시험 저장분으로 저장 후 근거 검증 모듈로 원본 재조회 대조
  if (run.draft) {
    const d = run.draft;
    const saved = await postJson("/api/reports", {
      account: r.account,
      templateId: d.template.id,
      title: d.title + TEST_SUFFIX,
      periodFrom: d.period.from,
      periodTo: d.period.to,
      requestText: r.request,
      fills: d.fills,
      numbers: d.numbers,
      draft: d.record,
    });
    if (saved.status !== 200) out.numbers = { error: saved.body?.code ?? `http_${saved.status}` };
    else {
      const s = await verify(saved.body.report.id, r.account);
      out.numbers = s.error ? { error: s.error, reportId: saved.body.report.id } : { reportId: saved.body.report.id, docNo: saved.body.report.docNo, ...s };
    }
  } else out.numbers = { error: "초안 없음" };
  return out;
}

// 이상 판정 — 전체 시드 기간 규격 대조 결과를 이상 사례 정답표와 비교, LLM 미사용
async function measureAnomalies(a) {
  const res = await postJson("/api/dev/tools", { account: a.account, calls: [{ name: "check_limits", input: a.period }] });
  const r = res.body?.results?.[0];
  if (res.status !== 200 || !r?.ok) throw new Error(`규격 대조 조회에 실패했습니다: ${r?.content ?? res.status}`);
  const rows = JSON.parse(r.content).rows;
  const found = rows.flatMap((row) => row.violations.map((v) => ({ entity: row.entity, item: v.item, dates: v.violationDays.map((d) => d.date) })));
  const sameDates = (x, y) => x.length === y.length && x.every((d) => y.includes(d));
  const cases = a.cases.map((c) => {
    const hit = found.find((f) => f.entity === c.entity && f.item === c.item);
    return { id: c.id, entity: c.entity, item: c.item, expected: c.dates, actual: hit?.dates ?? [], pass: !!hit && sameDates(hit.dates, c.dates) };
  });
  // 오탐 — 정답표 밖 이탈 일자와 규격 이탈로 설명되지 않는 경보
  const extra = found.flatMap((f) => {
    const c = a.cases.find((x) => x.entity === f.entity && x.item === f.item);
    return f.dates.filter((d) => !c?.dates.includes(d)).map((d) => ({ entity: f.entity, item: f.item, date: d }));
  });
  const unexplained = rows.reduce((n, row) => n + (row.flaggedWithoutViolation ?? 0), 0);
  return { cases, falsePositives: extra.length + unexplained, extra, unexplained };
}

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const rate = (ok, total) => (total ? ok / total : null);

function summarize(def, requests, anomaly) {
  const t = def.targets;
  const item = (id, ok, total, extra = {}) => {
    const value = rate(ok, total);
    return { id, label: t[id].label, target: t[id].target, value, ok, total, pass: value !== null && value >= t[id].target, ...extra };
  };
  const verified = requests.filter((r) => !r.numbers.error);
  const anomalyOk = anomaly.cases.filter((c) => c.pass).length;
  const anomalyItem = item("anomaly", anomalyOk, anomaly.cases.length, { falsePositives: anomaly.falsePositives, maxFalsePositives: t.anomaly.maxFalsePositives });
  anomalyItem.pass = anomalyItem.pass && anomaly.falsePositives <= t.anomaly.maxFalsePositives;
  return [
    item("query_success", sum(requests, (r) => r.queries.ok), sum(requests, (r) => r.queries.total)),
    item("fill_rate", sum(requests, (r) => r.fill.ok), sum(requests, (r) => r.fill.total)),
    // 출처 없는 수치는 불일치로 계산, 초안·저장·검증 실패 요청은 수치 0건이라 분모 밖이므로 별도 표시
    item("number_match", sum(verified, (r) => r.numbers.match), sum(verified, (r) => r.numbers.total), { unverified: requests.length - verified.length }),
    item("mapping", sum(requests, (r) => r.mapping.ok), sum(requests, (r) => r.mapping.total)),
    anomalyItem,
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = (id) => !args.only || args.only.has(id);
  const meta = { ...commitInfo(), note: args.note };
  let results = {};
  try {
    results = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    results = {};
  }

  if (args.cases) {
    const def = await readJson("scripts/eval/cases.json");
    const prev = new Map((results.cases ?? []).map((c) => [c.id, c]));
    results.cases = [];
    for (const c of def.cases) {
      const attempts = prev.get(c.id)?.attempts ?? [];
      if (selected(c.id)) {
        console.log(`케이스 ${c.id} 실행`);
        const a = await runCase(c, meta);
        attempts.push(a);
        console.log(`  ${a.verdict} (${a.runId})`);
      }
      const { checks, ...info } = c;
      results.cases.push({ ...info, checks, attempts });
    }
  }

  if (args.metrics) {
    const def = await readJson("scripts/eval/metrics.json");
    const registry = await readJson("public/report-mockup/data/templates/index.json");
    const templates = new Map(registry.templates.map((t) => [t.id, { ...t, keys: { ...registry.common, ...t.keys } }]));
    const requests = [];
    for (const r of def.requests.filter((x) => selected(x.id))) {
      console.log(`요청 ${r.id} 실행`);
      requests.push(await runRequest(r, def, templates));
    }
    const anomaly = await measureAnomalies(def.anomalies);
    results.metrics = { at: new Date().toISOString(), ...meta, partial: !!args.only, summary: summarize(def, requests, anomaly), requests, anomaly };
  }

  results.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(results, null, 2) + "\n");
  console.log(`기록: ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
