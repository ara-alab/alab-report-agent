// 날짜 관행 — 주차 계산은 모델 추론 대신 코드로 산출

// 월 주차 규약 — KS X ISO 8601, 월요일 시작, 그 달의 첫 목요일이 속한 주가 1주
export const WEEK_RULE = "주는 월요일에 시작하고, 그 달의 첫 목요일이 속한 주가 해당 월 1주입니다(KS X ISO 8601). 월초·월말 주는 이웃 달 날짜를 포함할 수 있습니다.";

export type MonthWeek = { week: number; from: string; to: string };

export class CalendarError extends Error {}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 기준일 — 서버 시각을 한국 시간 날짜로 환산
export function todayKst(): { date: string; weekday: string } {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return { date: kst.toISOString().slice(0, 10), weekday: WEEKDAYS[kst.getUTCDay()] };
}

const DAY_MS = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

// 해당 월 주차 목록 — 목요일이 그 달에 속하는 월~일 주를 순서대로 번호 부여
export function monthWeeks(month: string): MonthWeek[] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const mon = m ? Number(m[2]) : 0;
  if (!m || mon < 1 || mon > 12) throw new CalendarError("month 는 YYYY-MM 형식이어야 합니다.");
  const year = Number(m[1]);
  const first = Date.UTC(year, mon - 1, 1);
  // 첫 목요일 — getUTCDay 기준 목요일은 4
  const thursday = first + ((4 - new Date(first).getUTCDay() + 7) % 7) * DAY_MS;
  const weeks: MonthWeek[] = [];
  for (let t = thursday; new Date(t).getUTCMonth() === mon - 1; t += 7 * DAY_MS) {
    weeks.push({ week: weeks.length + 1, from: ymd(t - 3 * DAY_MS), to: ymd(t + 3 * DAY_MS) });
  }
  return weeks;
}

// 상대 기간 — 기준일(YYYY-MM-DD)의 이번 주·지난주(월~일)와 이번 달·지난달 실제 범위
export function relativePeriods(date: string): Record<"이번 주" | "지난주" | "이번 달" | "지난달", { from: string; to: string }> {
  const t = Date.parse(`${date}T00:00:00Z`);
  const d = new Date(t);
  const monday = t - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    "이번 주": { from: ymd(monday), to: ymd(monday + 6 * DAY_MS) },
    "지난주": { from: ymd(monday - 7 * DAY_MS), to: ymd(monday - DAY_MS) },
    "이번 달": { from: ymd(Date.UTC(y, m, 1)), to: ymd(Date.UTC(y, m + 1, 0)) },
    "지난달": { from: ymd(Date.UTC(y, m - 1, 1)), to: ymd(Date.UTC(y, m, 0)) },
  };
}

export const RESOLVE_WEEK_TOOL = {
  name: "resolve_week",
  description: "월의 주차별 실제 기간(월~일)을 반환합니다. \"N월 N째 주\" 같은 주차 표현은 이 도구로 기간을 확정한 뒤 조회합니다.",
  input_schema: {
    type: "object",
    properties: { month: { type: "string", description: "대상 월 YYYY-MM" } },
    required: ["month"],
  },
} as const;
