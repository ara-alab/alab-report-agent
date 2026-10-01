<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 프로젝트 구현 원칙

- 이 저장소는 특정 기업·업종 전용이 아닌 범용 MES/ERP 연계 보고서 Agent를 지향한다. 세부 원칙은 `docs/mvp-plan.md` §2 「범용성 원칙」을 따른다.
- 공통 계층(`src/lib/agent/`·`src/lib/llm/`·SQL 가드·카탈로그 로직)에 업종 용어·공정명·코드값·테이블명·기대 수치를 쓰지 않는다.
- 현장 지식은 데이터 계층(카탈로그 설명 `src/lib/catalog/tables.ts`, 지표 정의 `src/lib/catalog/metrics.ts`, DB 코드·규격 테이블, 계정 설정 `src/lib/accounts/`)에만 둔다.
- 조회 결과가 기대와 다르면 데이터 설명 보강 → 범용 조회·분석 능력 보강 → 업종 무관 일반 규칙 순으로 고치고, 특정 요청·시연 정답만 통과시키는 규칙·분기를 추가하지 않는다.
- 시연 요청 세트는 측정 수단이다. 세트 통과를 위한 맞춤 수정 대신 시드 이상 사례와 무관한 일반 요청으로 함께 검증한다.
