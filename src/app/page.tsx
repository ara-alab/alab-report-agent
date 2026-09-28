const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// 목업 진입점 — 정적 목업은 public 하위라 Next 라우팅 밖에 있어 링크로만 연결
export default function Home() {
  return (
    <main style={{ padding: "48px", fontSize: "16px", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "22px", fontWeight: 650, marginBottom: "16px" }}>alabReport</h1>
      <p style={{ marginBottom: "20px", color: "var(--page-ink-muted)" }}>보고서 편집기 셸 목업이 아래 경로에 있습니다.</p>
      <a href={`${BASE_PATH}/report-mockup/index.html`} style={{ color: "var(--page-accent)", textDecoration: "underline" }}>
        alabReport 목업 열기
      </a>
    </main>
  );
}
