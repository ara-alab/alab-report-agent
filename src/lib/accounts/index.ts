// 샘플 계정 — 로그인 없이 계정 칩으로 전환, 기안자 정보·결재선·기본 서식·조회 가능 테이블의 출처

export type AccountRole = "drafter" | "reviewer";

export type Account = {
  id: string;
  name: string;
  title: string;
  dept: string;
  role: AccountRole;
  duty: string;
  // 결재란 기안·검토·승인 순서, 검토자는 계정 ID, 승인은 직위 표기
  approval: { reviewer: string | null; approver: string };
  defaultTemplate: string;
  allowedTables: readonly string[];
};

const MASTER = ["cm010", "bp100", "mdl100", "it100", "eq100", "eq110", "eq120", "hr100"] as const;
const MES = ["pp300", "qm310", "eq300", "eq310"] as const;
const ERP_QTY = ["mm200", "mm210", "sd200"] as const;

export const ACCOUNTS: readonly Account[] = [
  {
    id: "prod-kim",
    name: "김도현",
    title: "과장",
    dept: "생산기술부",
    role: "drafter",
    duty: "생산실적 보고서 기안, 라인·설비별 실적과 품질 이상 조치 정리",
    approval: { reviewer: "review-lee", approver: "공장장" },
    defaultTemplate: "weekly-summary",
    // 금액 상세(fi200) 제외 — 수량 기준 입출고까지만
    allowedTables: [...MASTER, ...MES, ...ERP_QTY],
  },
  {
    id: "qa-seo",
    name: "서민재",
    title: "대리",
    dept: "품질보증팀",
    role: "drafter",
    duty: "품질 보고서 기안, 불량 유형·설비 이상과 원인 분석 정리",
    approval: { reviewer: "review-lee", approver: "공장장" },
    defaultTemplate: "production-brief",
    // 거래처·입출고 제외 — 생산·불량·설비 로그 중심
    allowedTables: ["cm010", "mdl100", "it100", "eq100", "eq110", "eq120", "hr100", ...MES],
  },
  {
    id: "review-lee",
    name: "이상훈",
    title: "부장",
    dept: "생산본부",
    role: "reviewer",
    duty: "하위 보고서 검토, 통합 보고서 기안, 근거·정합성 확인",
    approval: { reviewer: null, approver: "공장장" },
    defaultTemplate: "weekly-summary",
    allowedTables: [...MASTER, ...MES, ...ERP_QTY, "fi200"],
  },
];

// 계정 미지정 요청의 기본값 — 목업 기안자와 동일 인물
export const DEFAULT_ACCOUNT_ID = "prod-kim";

export function getAccount(id: string | null | undefined): Account | null {
  return ACCOUNTS.find((a) => a.id === (id ?? DEFAULT_ACCOUNT_ID)) ?? null;
}

export const signerOf = (a: Account) => `${a.dept} ${a.name} ${a.title}`;

// 화면 표시용 공개 정보 — 결재선 검토자는 이름으로 풀어 반환
export function publicAccount(a: Account) {
  const reviewer = a.approval.reviewer ? getAccount(a.approval.reviewer) : null;
  return {
    id: a.id,
    name: a.name,
    title: a.title,
    dept: a.dept,
    role: a.role,
    duty: a.duty,
    approval: { drafter: a.name, reviewer: reviewer?.name ?? null, reviewerTitle: reviewer?.title ?? null, approver: a.approval.approver },
    defaultTemplate: a.defaultTemplate,
    allowedTables: a.allowedTables,
  };
}

// 설정 불일치 — 실제 스키마에 없는 허용 테이블, 존재하지 않는 검토자 계정
export function accountDrift(tableNames: readonly string[]) {
  const known = new Set(tableNames);
  return ACCOUNTS.flatMap((a) => [
    ...a.allowedTables.filter((t) => !known.has(t)).map((t) => `${a.id}: 없는 테이블 ${t}`),
    ...(a.approval.reviewer && !getAccount(a.approval.reviewer) ? [`${a.id}: 없는 검토자 ${a.approval.reviewer}`] : []),
  ]);
}
