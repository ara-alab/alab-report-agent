import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "alabReport",
  description: "사내 데이터 기반 보고서 자동 작성 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
