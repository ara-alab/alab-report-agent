// 시스템·계정 채움 키 — 문서번호·작성일·서명일과 기안자·결재선 표기
import { getAccount, type Account } from "@/lib/accounts";
import { todayKst } from "@/lib/calendar";
import type { Fills } from "./render";

const meta = (text: string) => ({ kind: "meta" as const, text });

// 계정 설정 키 — 작성 시점 값을 보고서에 함께 저장
export function accountFills(a: Account): Fills {
  const reviewer = a.approval.reviewer ? getAccount(a.approval.reviewer) : null;
  return {
    dept: meta(a.dept),
    writer: meta(`${a.name} ${a.title}`),
    writer_short: meta(a.name),
    reviewer: meta(reviewer?.name ?? "-"),
    audience: meta(a.approval.approver),
  };
}

// 시스템 발급 키 — 저장 전 기안 미리보기는 문서번호·서명일 대기 표기, 작성일은 기안 당일(한국 시간)
export function systemFills(issued: { docNo: string; date: string } | null): Fills {
  if (!issued) return { doc_no: meta("저장 시 발번"), issued_at: meta(todayKst().date), sign_date: meta("저장 시 기록") };
  const [y, m, d] = issued.date.split("-");
  return { doc_no: meta(issued.docNo), issued_at: meta(issued.date), sign_date: meta(`${y}. ${m}. ${d}.`) };
}
