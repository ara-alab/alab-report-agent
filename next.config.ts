import type { NextConfig } from "next";

// 배포 하위 경로 대응 — nginx 접두를 쓰는 환경에서만 값 주입
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // 컨테이너 배포 — 추적 파일만 담은 최소 산출물
  output: "standalone",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
