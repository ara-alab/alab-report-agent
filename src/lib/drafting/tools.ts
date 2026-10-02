// 기안 tool — 서식 추천·보고서 초안 작성·저장·목록, 실행 단위 조회 캐시를 수치 참조 원천으로 사용
import "server-only";
import type { Account } from "@/lib/accounts";
import { ReportError, listReports, saveReport, type DraftRecord } from "@/lib/reports";
import { DraftError, draftReport, templateCatalog, type Draft } from "./draft";
import type { RunCache } from "./refs";
import { getTemplate } from "./templates";

export type TemplateCandidate = { id: string; name: string; reason: string };

// 실행 문맥 — 조회 결과 캐시, 마지막 기안 입력(거부 포함)·초안과 그 입력(이전 턴·저장본 복원 포함)·요청 원문·저장 결과·서식 제안,
// 이번 요청 원문과 작성 모드·고정 서식·수정 대상 키, 저장본 수정 시 갱신 대상 보고서
export type DraftContext = {
  cache: RunCache;
  requestText?: string;
  mode?: "draft" | "ask";
  fixedTemplate?: string;
  section?: string;
  target?: { id: number; docNo: string };
  lastInput?: Record<string, unknown>;
  draft?: Draft;
  draftInput?: Record<string, unknown>;
  draftRequest?: string;
  saved?: { id: number; docNo: string };
  proposed?: TemplateCandidate[];
};

// 서식 제안 후보 수 상한
const MAX_CANDIDATES = 3;
const REASON_CHARS = 200;

export const DRAFTING_TOOLS = [
  {
    name: "recommend_templates",
    description: "보고서 서식 목록을 반환합니다. 서식별 용도·섹션과 draft_report 로 채울 키(종류·라벨·필수 여부), 계정 기본 서식이 들어 있습니다. 요청에 맞는 서식을 고를 때 먼저 호출합니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "draft_report",
    description: [
      "서식에 맞춰 보고서 초안을 작성해 화면 지면에 표시합니다. 수치는 직접 쓰지 않고 이번 요청에서 실행한 조회 결과를 참조합니다.",
      "참조 형식: \"조회ID:경로\". 조회ID는 도구 결과의 queryId, 경로는 결과 JSON 안의 위치입니다. 점으로 필드를 잇고, [n] 은 배열 위치, [필드=값] 은 조건에 맞는 원소 하나(값은 따옴표 없이), 배열 뒤 length 는 원소 수입니다. 예: analyze_kpi#ab12:total.current.value, check_limits#cd34:rows[entity=X].violations[item=Y].violationDays.length",
      "키 종류별 입력: meta·text 는 문자열이며 안의 수치는 [[참조]] 또는 [[참조|소수자릿수]] 로 적습니다. 참조 없는 숫자는 날짜(M월 D일·MM-DD 등)·주차·분기·시각·차수·영문 코드·목록 번호 외에는 오류이며, 한계값·건수·일수·최대/최소값처럼 조회 결과에 있는 값도 예외 없이 참조로 적습니다. 계산식은 조회 결과의 계산식 문자열(formula)을 그대로 옮기거나 [[조회ID:경로]] 로 참조합니다.",
      "value 는 {ref, digits?, unit?}. stats 는 [{label, ref 또는 text, unit?, digits?, tone?(good|bad|warn)}].",
      "table 은 {columns:[{label, path?, digits?, align?(l|c|n)}], from?: \"조회ID:배열경로\", rows?: [[칸]], sum?: [칸]}. from 을 쓰면 배열 원소마다 열의 path·digits 로 칸을 만들고, rows 의 칸은 문자열 또는 {ref, digits?} 이며 칸의 digits 만 적용됩니다. 둘을 함께 쓰면 from 행 뒤에 rows 행이 붙습니다. 조회 결과 배열을 그대로 옮기는 표는 from 을 쓰고, rows 는 여러 조회 값을 한 표에 섞거나 일부 행만 고를 때만 씁니다.",
      "list 는 [{text, when?, lead?}] 이며 lead 는 강조 행 여부(true/false)입니다.문서 제목은 title, 대상 기간은 period 로 주고, 문서번호·작성일·기안자·결재란은 코드가 채웁니다. 글자 수 상한은 recommend_templates 결과의 limits 를 따릅니다.",
      "오류가 있으면 초안 없이 오류 목록을 반환합니다. 이때 전체를 다시 보내지 않고 오류가 난 키만 고쳐 revise: true 와 함께 보냅니다. revise 호출은 보낸 키(title·period·fills 의 키 단위)만 직전 입력에 덮어써 다시 검증합니다. 경고(필수 키 누락 등)는 초안을 만든 뒤 함께 반환합니다.",
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        revise: { type: "boolean", description: "true 면 보낸 키만 직전 draft_report 입력에 덮어씀" },
        template: { type: "string", description: "서식 id, revise 가 아니면 필수" },
        title: { type: "string", description: "문서 제목, revise 가 아니면 필수" },
        period: {
          type: "object",
          properties: { label: { type: "string", description: "기간 명칭, 예: 9월 4주" }, from: { type: "string" }, to: { type: "string" } },
          required: ["label", "from", "to"],
        },
        fills: { type: "object", description: "서식 키별 입력", additionalProperties: true },
      },
      required: ["fills"],
    },
  },
  {
    name: "save_report",
    description: "이번 요청에서 마지막으로 작성한 초안을 보고서 저장소에 저장하고 문서번호를 발번합니다. 사용자가 저장을 요청한 경우에만 호출합니다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_reports",
    description: "현재 계정이 볼 수 있는 저장된 보고서 목록(문서번호·서식·제목·기간·작성자·작성일)을 최신순으로 반환합니다.",
    input_schema: { type: "object", properties: { limit: { type: "integer", description: "최대 건수, 기본 20" } } },
  },
  {
    name: "propose_templates",
    description: `요청에 맞는 서식 후보 1~${MAX_CANDIDATES}개를 사용자에게 선택 카드로 제시하고 이번 응답을 마칩니다. 용도가 맞는 서식이 여럿이라 하나로 정하기 어렵거나 사용자가 서식 선택을 원할 때 조회 전에 호출합니다. id 는 recommend_templates 결과의 서식 id, reason 은 이 요청에 맞는 이유 한 문장입니다.`,
    input_schema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] },
        },
      },
      required: ["candidates"],
    },
  },
] as const;

const NAMES = new Set<string>(DRAFTING_TOOLS.map((t) => t.name));
export const isDraftingTool = (name: string) => NAMES.has(name);

export type DraftingOutcome = { content: string; isError: boolean };

const json = (v: unknown): DraftingOutcome => ({ content: JSON.stringify(v), isError: false });
const fail = (msg: string): DraftingOutcome => ({ content: msg, isError: true });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 고쳐 쓰기 — 직전 입력에 보낸 최상위 필드와 fills 키만 덮어씀
function reviseInput(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "revise" && k !== "fills"));
  const baseFills = isObj(base.fills) ? base.fills : {};
  return { ...base, ...rest, fills: isObj(patch.fills) ? { ...baseFills, ...patch.fills } : baseFills };
}

// 서식 제안 — 후보 수·중복·서식 존재·이유 길이 검증
async function proposeTemplates(input: Record<string, unknown>, ctx: DraftContext): Promise<DraftingOutcome> {
  const list = input.candidates;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CANDIDATES) return fail(`candidates 는 1~${MAX_CANDIDATES}개 배열이어야 합니다.`);
  const out: TemplateCandidate[] = [];
  for (const c of list) {
    const t = isObj(c) && typeof c.id === "string" ? await getTemplate(c.id) : null;
    if (!t) return fail(`알 수 없는 서식입니다: ${isObj(c) ? String(c.id) : String(c)} — recommend_templates 결과의 id 를 쓰세요`);
    if (out.some((o) => o.id === t.id)) return fail(`서식이 중복되었습니다: ${t.id}`);
    const reason = isObj(c) && typeof c.reason === "string" ? c.reason.trim() : "";
    if (!reason || reason.length > REASON_CHARS) return fail(`${t.id}: reason 은 ${REASON_CHARS}자 이하 한 문장이어야 합니다.`);
    out.push({ id: t.id, name: t.name, reason });
  }
  ctx.proposed = out;
  return json({ ok: true, candidates: out.map((c) => c.id) });
}

// 작성 모드 제약 — 질문 모드는 기안·저장·제안 거부, 서식 고정 시 제안 거부
function modeBlock(name: string, ctx: DraftContext): string | null {
  if (ctx.mode === "ask" && (name === "draft_report" || name === "save_report" || name === "propose_templates")) {
    return "질문 모드 요청이라 보고서 초안을 작성·저장·제안하지 않습니다. 조회 결과로 대화 답변을 작성하세요.";
  }
  if (name === "propose_templates" && ctx.section) return "이번 요청은 지정 섹션 수정 요청이라 서식을 제안하지 않습니다.";
  if (name === "propose_templates" && ctx.fixedTemplate) return `이번 요청은 서식이 ${ctx.fixedTemplate} 로 지정되어 있어 서식을 제안하지 않습니다.`;
  return null;
}

// 섹션 수정 제약 — 직전 초안에 대한 revise 로 지정 키 하나만 교체
// 섹션별 draft_report 입력 위치 — 문서 제목은 title, 그 외는 fills 의 같은 키
export const sectionField = (key: string) => (key === "doc_title" ? "title" : `fills.${key}`);

function sectionBlock(input: Record<string, unknown>, ctx: DraftContext): string | null {
  if (!ctx.section) return null;
  const sent = [
    ...Object.keys(input).filter((k) => k !== "revise" && k !== "fills"),
    ...(isObj(input.fills) ? Object.keys(input.fills).map((k) => `fills.${k}`) : []),
  ];
  const field = sectionField(ctx.section);
  if (input.revise !== true || sent.length !== 1 || sent[0] !== field) {
    return `이번 요청은 ${ctx.section} 섹션 수정 요청입니다. revise: true 와 ${field} 만 보내고 다른 키·제목·기간은 바꾸지 마세요.`;
  }
  return null;
}

// 수정 재개용 기안 기록 — 현재 초안의 입력과 이번 실행 캐시의 조회 원천
export function draftRecord(ctx: DraftContext): DraftRecord | undefined {
  if (!ctx.draftInput) return undefined;
  return { input: ctx.draftInput, queries: [...ctx.cache.values()].map((c) => ({ name: c.name, input: c.input })) };
}

const draftOutcome = (d: Draft) => json({ ok: true, template: d.template.id, title: d.title, filledKeys: Object.keys(d.fills), numbers: d.numbers.length, warnings: d.warnings });

// 이전 턴 초안 복원 — 복원한 조회 캐시로 기안 입력을 다시 검증, LLM 미호출·작성 모드 제약 미적용, 검증 실패 시 DraftError
export async function restoreDraft(input: Record<string, unknown>, saved: DraftContext["saved"], requestText: string | undefined, account: Account, ctx: DraftContext): Promise<string> {
  const d = await draftReport(input, account, ctx.cache);
  Object.assign(ctx, { lastInput: input, draft: d, draftInput: input, draftRequest: requestText, saved });
  return draftOutcome(d).content;
}

export async function runDraftingTool(name: string, input: Record<string, unknown>, account: Account, ctx: DraftContext): Promise<DraftingOutcome> {
  const blocked = modeBlock(name, ctx);
  if (blocked) return fail(blocked);
  try {
    if (name === "recommend_templates") return json(await templateCatalog(account));
    if (name === "propose_templates") return await proposeTemplates(input, ctx);
    if (name === "draft_report") {
      const sectionErr = sectionBlock(input, ctx);
      if (sectionErr) return fail(sectionErr);
      if (input.revise === true && !ctx.lastInput) return fail("고칠 직전 draft_report 입력이 없습니다. revise 없이 전체 입력으로 호출하세요.");
      const merged = input.revise === true ? reviseInput(ctx.lastInput!, input) : input;
      // 서식 고정 — 다른 서식 초안은 검증 전에 거부, 직전 입력으로 남기지 않음
      if (ctx.fixedTemplate && merged.template !== ctx.fixedTemplate) return fail(`이번 요청의 서식은 ${ctx.fixedTemplate} 로 지정되어 있습니다. template 을 ${ctx.fixedTemplate} 로 바꿔 다시 호출하세요.`);
      ctx.lastInput = merged;
      let d: Draft;
      try {
        d = await draftReport(merged, account, ctx.cache);
      } catch (e) {
        if (e instanceof DraftError) return fail(`${e.message}\n오류가 난 키만 고쳐 revise: true 와 함께 다시 호출하세요.`);
        throw e;
      }
      ctx.draft = d;
      ctx.draftInput = merged;
      ctx.draftRequest = ctx.requestText;
      ctx.saved = undefined;
      return draftOutcome(d);
    }
    if (name === "save_report") {
      const d = ctx.draft;
      if (!d) return fail("이번 요청에서 작성한 초안이 없습니다. draft_report 로 먼저 초안을 작성하세요.");
      const r = await saveReport(
        {
          id: ctx.saved?.id ?? ctx.target?.id,
          templateId: d.template.id,
          title: d.title,
          periodFrom: d.period.from,
          periodTo: d.period.to,
          requestText: ctx.draftRequest ?? ctx.requestText,
          fills: d.fills,
          numbers: d.numbers,
          draft: draftRecord(ctx),
        },
        account,
      );
      ctx.saved = { id: Number(r.id), docNo: String(r.docNo) };
      return json({ ok: true, id: r.id, docNo: r.docNo });
    }
    if (name === "list_reports") {
      const limit = Number.isInteger(input.limit) ? Number(input.limit) : 20;
      return json({ reports: await listReports(account, { limit }) });
    }
    return fail(`사용할 수 없는 도구입니다: ${name}`);
  } catch (e) {
    if (e instanceof DraftError || e instanceof ReportError) return fail(e.message);
    throw e;
  }
}
