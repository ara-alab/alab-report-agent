# alab-data-report

alabReport — 사내 데이터베이스(MES/ERP)를 근거로 보고서를 자동 작성하는 Agent MVP — 화면 목업과 조회·분석 Agent

## 실행

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY 입력
npm run db:up             # 로컬 MES DB 기동 — 최초 기동 시 스키마·데이터 적재
npm run dev
```

- 앱 진입점: `http://localhost:3002/`
- 목업 화면: `http://localhost:3002/report-mockup/index.html`
- 개발 포트는 `package.json` 의 `dev` 스크립트에 3002 고정 — 노드 기본 3000 대역 혼잡 회피 목적
- 점유 시 폴백 없이 `EADDRINUSE` 로 중단(포트 명시의 결과) — 다른 포트는 `npx next dev -p <포트>`
- 컨테이너와 nginx 는 3000 유지 — 개발 포트와 무관
- SQL 가드 회귀 검사: `npm run check:guard` — DB·LLM 없이 통과·차단 사례 대조, 실패 0건이어야 정상

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/app/page.tsx` | 목업 링크만 두는 임시 진입 페이지 |
| `src/app/layout.tsx` | 루트 레이아웃 · 전역 스타일 로드 |
| `public/report-mockup/index.html` | 편집기 셸 목업 — 스타일·마크업·동작 자족형 단일 파일 |
| `public/report-mockup/data/` | 흐름 시연용 더미 데이터 — 목업이 `fetch` 로 읽음 |
| `public/report-mockup/data/datasets/` | 사내 DB 표 카탈로그와 표 본문 — 좌측 레일·데이터 선택 창의 원천 |
| `public/report-mockup/data/templates/` | 보고서 서식과 서식 레지스트리(`index.json`) — 서식별 키 선언·문서번호 접두어, Agent 서식은 `agent/` |
| `public/report-mockup/fonts/` | 문서 폰트(나눔 계열) — 원본 `@font-face` 선언 대응 |
| `public/report-mockup/js/` | 목업 서버 연동 모듈 — 신규 화면 로직 분리 위치 |
| `public/report-mockup/reports.html` | 저장 보고서 임시 목록 — 제목 선택 시 `index.html?report={id}&account={계정}`로 지면 열기 |
| `src/app/api/health/` | 서버 상태 확인 — DB 연결·LLM 키 설정 여부 |
| `src/app/api/agent/` | Agent 대화 진입점 — 계정 검증, tool 호출·결과·출처를 NDJSON 스트림으로 중계 |
| `src/app/api/accounts/` | 샘플 계정 목록 |
| `src/app/api/reports/` | 보고서 목록·저장·단건 조회 — 계정별 조회 범위, 저장 시 문서번호 발번, 단건 응답에 저장 값으로 다시 그린 지면 `html` |
| `src/app/api/dev/` | 개발 확인용 route — 조회 함수·카탈로그·SQL·분석 tool·LLM 스트림·기안 tool 실행(`tools`)·모델 응답 재생(`agent-replay`), 운영 빌드에선 404 |
| `src/lib/agent/` | Agent tool 루프 — 계정 범위 tool 구성·실행, 카탈로그 기반 시스템 프롬프트, 호출 상한 |
| `src/lib/calendar.ts` | 날짜 관행 — 월 주차(KS X ISO 8601) 계산과 `resolve_week` tool |
| `src/lib/llm/` | Anthropic 호출 계층 — 모델 폴백·취소·NDJSON 스트림 |
| `src/lib/db/` | MES DB 접속 — 조회 전용 풀과 앱 쓰기 풀 분리 |
| `src/lib/queries/` | 조회 함수 등록부·사전 정의 조회 4종·SQL 가드·`run_sql` |
| `src/lib/catalog/` | 스키마 카탈로그 — DB 구조와 테이블·컬럼 설명 결합, KPI 공식·센서 규격 원천 정의 |
| `src/lib/analysis/` | 분석 tool — `analyze_kpi` KPI·직전 기간 증감 계산, `check_limits` 규격 이탈 판정 |
| `src/lib/drafting/` | 기안 tool(서식 추천·초안·저장·목록)·수치 참조 해석과 참조 없는 숫자 검증, 서식 로더·렌더러 — 키 종류별 구조화 채움 값 검증·이스케이프 기입, 시스템·계정 키 |
| `src/lib/reports/` | 보고서 저장소 — `alab_report` 스키마의 보고서·수치 저장, 문서번호 발번 |
| `src/lib/accounts/` | 샘플 계정 3종 — 기안자·결재선·기본 서식·조회 가능 테이블 |
| `db/init/` | DB 초기화 SQL — 스키마·기준정보·거래 데이터·조회 전용 계정·보고서 저장소(`alab_report`, 앱 계정 전용) |
| `db/checks.sql` | 데이터 불변식 검사 |
| `scripts/db/` | 가상 데이터 생성기 |
| `scripts/check-sql-guard.mjs` | SQL 가드 회귀 검사 사례 |
| `compose.dev.yml` | 로컬 개발용 MariaDB 컨테이너 |
| `docs/` | 대회 과제 개요·MVP 구현 계획·로드맵 |

## 로컬 DB (가상 MES/ERP)

| 명령 | 동작 |
| --- | --- |
| `npm run db:up` | MariaDB 11.4 컨테이너 기동, 볼륨이 비어 있으면 `db/init/` 순서대로 적재 |
| `npm run db:down` | 컨테이너 중지·제거, 데이터 볼륨 유지 |
| `npm run db:reset` | 볼륨까지 삭제 후 재적재 — 스키마·데이터 변경 반영 |
| `npm run db:seed` | 생성기 재실행 — `db/init/02-master.sql`·`03-seed.sql` 재생성 |
| `npm run db:check` | 불변식 검사 — 적재 행 수와 위반 건수 출력, 위반은 모두 0 이어야 정상 |

- 접속: `127.0.0.1:13316`, 데이터베이스 `mes` — 타 프로젝트 3306·13306 과 충돌 회피
- 계정: 앱 쓰기용 `alab_app`, Agent 조회 전용 `alab_ro`(SELECT만) — 비밀번호는 `.env`
- 데이터 기간: 2026-08-03 ~ 2026-09-25 평일, 라인 3개(생산 실적 2개)·설비 5대(생산 실적 4대)·품번 4종
- 생성기는 고정 시드 — 같은 설정이면 같은 SQL 산출
- 데이터 변경은 생성기 설정(`scripts/db/generate-seed.mjs` 상단)에서만 — 산출 SQL 직접 수정 금지
- 측정 항목(`eq110`)·설비 구분별 규격(`eq120`)은 생성기 기준정보에 정의, 경보 플래그는 이 규격으로만 산출
- 설비 측정값은 상태 로그(`eq300`)와 항목별 측정값 행(`eq310`)으로 분리 — 측정 항목 추가는 `eq110`·`eq120` 행 추가로 반영
- 불량 상세 설명(`qm310.ng_desc`)은 현상만 기술 — 이상 원인은 측정값·규격 대조로만 드러남

| 이상 사례 | 설비·기간 | 데이터에 드러나는 신호 |
| --- | --- | --- |
| `humidity-appearance` | M-101, 08-26~27 | 습도(HUM) 60% 초과 경보, 외관 불량(NG03) 증가 |
| `post-pressure-stop` | F-101, 09-09 | 압력(PRS) 저하·STOP 4시간, 후처리 공정 양품 60% 수준 |
| `vibration-spike` | M-201, 09-22~24 | 진동(VIB) 7.1mm/s 초과 ALARM, 치수 불량(NG01) 급증 |

| 불변식 | 내용 |
| --- | --- |
| 생산 수량 범위 | 양품·불량 비음수, 양품+불량 ≤ 지시 수량 |
| 불량 상세 합계 | 일자·설비·품번별 `qm310` 합계 = `pp300.ng_qty` |
| 후처리 공정 지시 | 같은 날·라인·품번 가공 양품 = 후처리 지시 수량 |
| ERP 정합 | `fi200` 금액 = 수량×단가, 입고·출고 합계 = `mm200`·`sd200` 합계 |
| 설비 알람 | ALARM 상태는 알람 플래그 동반 |
| 측정 규격 | 상태 로그마다 측정값 존재, `eq120` 항목은 해당 설비 구분에서 측정됨, 경보 플래그 = 같은 로그 측정값 중 하나 이상 규격 이탈 |

- 검사 한계: 행 단위 관계만 확인 — 이상 사례의 의도된 수치 범위는 검사하지 않음

## 환경변수

- 항목과 기본값: `.env.example` — Next 앱과 `compose.dev.yml` 이 같은 `.env` 를 읽음
- `.env` 는 추적 제외 — 커밋 금지
- 모델 설정(`ALAB_*_MODEL`) 을 비우면 `src/lib/llm/client.ts` 기본값 사용

## 목업 구성

| 영역 | 현재 상태 |
| --- | --- |
| 타이틀바 | 문서명 · 저장 상태 · 실행취소/다시실행 · 내보내기(준비중) · 로그인 계정(클릭 시 샘플 계정 전환) |
| 리본 탭 | 「홈」 1개 |
| 리본 그룹 | 보고서(새 보고서) · 서식(템플릿 바꾸기·템플릿으로 저장) · 문서(저장·내보내기) — 새 보고서 외 전부 준비중 |
| 좌측 레일 | 데이터 탭(카탈로그 렌더 · 선택 상태를 데이터 선택 창과 공유) · 페이지 탭(선택·드래그 정렬·우클릭 메뉴·폭 조정·접기) |
| 캔버스 | 문서 미생성 시 시작 화면(진입 카드 3장 + 대화 입력), 생성 후 A4 지면 — 기본 배율은 쪽 맞춤, 상태바 값과 연동 |
| 우측 드로어 | LLM 대화창 — 시작 화면에선 접힘, 작성이 시작되면 펼침, 로그·빠른 지시 칩(준비중)·입력 영역, Agent 답변에 조회 진행(도구·기간·결과 형태)과 중간 안내 문장, 출처 ID 표시, 답변 본문은 제목·목록·굵게만 서식 렌더링 |
| 상태바 | 쪽 이동 · 배율 컨트롤(쪽/폭 맞춤·프리셋·직접 입력 모두 지면에 적용) |

## 사용 흐름

| 흐름 | 진입 | 구현 여부 |
| --- | --- | --- |
| 보고서 통합 | 시작 화면 카드 | 목업 구현(Agent 미연동) — 원본 보고서 선택 + 지시 입력 → 취합 문서 생성 |
| 데이터로 시작 | 시작 화면 카드 | 목업 구현(Agent 미연동) — 표 선택 + 미리보기 + 지시 입력 → 분석 보고서 생성 |
| 템플릿으로 시작 | 시작 화면 카드 | 부분 구현 — 요청 입력 + 서식 선택 → Agent 조회·기안, 초안 작성 시 지면 표시, 선택 서식의 Agent 전달은 미연동 |
| 대화로 시작 | 시작 화면 입력란 | 요청 문장 → 빈 지면 전환 → Agent 조회·기안, 초안 작성 시 지면 표시 |
| 생성 후 수정 | 우측 대화창 | 미구현 |

- 문서 생성 시 캔버스 지면·페이지 목록·문서명·대화 로그가 함께 갱신
- 리본 「새 보고서」는 문서를 폐기하고 시작 화면으로 복귀
- 생성 진입은 시작 화면 한 곳으로 모음 — 리본에는 문서를 다루는 도구만 남김
- 문서 대상 버튼은 시작 화면에서 잠금(`data-needdoc`) — 문서가 생기면 풀림
- 동작 미구현 버튼은 준비중 칩 표시(`data-soon`) — 클릭 시 안내만
- 목업 흐름의 서식 파일은 두 종을 원천만 바꿔 재사용 — 보고서 통합은 주간 집계서, 데이터로 시작은 분석 보고(생산·설비 공용), 경로 기준 캐시로 흐름 간 공유

## 데모 사용자와 지시문

- 편집기 사용자는 샘플 계정 3종 중 선택 — 타이틀바 계정 칩 메뉴로 전환, 선택은 브라우저에 보관, 기본 「생산기술부 김도현 과장」
- 계정 전환 시 Agent 대화 이력 폐기 — 조회 범위가 계정마다 다름, 이미 생성된 문서의 기안자는 유지
- 일일 보고서의 보고자 3인과는 다른 인물 — 사원이 일보를 쓰고 취합 책임자가 상위 보고를 기안하는 위계
- 생성 문서의 기안부서·작성자는 계정에서 옴 — 지시문에 쓰지 않음
- 검토자는 계정 결재선 설정값 — 기안자 계정은 「이상훈 부장」, 검토자 계정 자신은 검토자 없음, 결재란에는 이름만 표기
- 목업 흐름(보고서 통합·데이터로 시작)의 예시 지시문은 3문장 구성 — 무엇을 만들지 · 어떻게 집계할지 · 누구에게 보고할지
- 목업 흐름에서 보고 대상·문서 종류처럼 데이터로 유추 불가한 값은 지시문이 정함 — 기간·집계 축은 데이터에서 옴
- 목업 흐름의 고정 대화 응답도 3문장 — 추출 규모와 집계 축 · 핵심 수치와 최저 그룹 · 지시 반영과 기안자 출처

## 서식 선택 (템플릿으로 시작)

- 카탈로그: `data/templates/index.json` — 서식 목록, 추천·적합도는 3일차 Agent 추천으로 제공
- 창의 요청 입력란에 요청을 적고 카드를 고름 — 빈 요청은 전송하지 않고 입력 유도
- 카드 클릭이 곧 「이 서식으로 작성」 — 서식 이름의 빈 문서를 열고 요청을 Agent에 전달
- 마지막 카드 「자동 서식 만들기」는 서식 없이 「대화로 시작」과 같은 경로로 요청 전달

| 필드 | 역할 |
| --- | --- |
| `file` | 서식 파일 경로 — 현재 흐름에서 미사용 |
| `sections` | 서식 구성 절 — 카드의 절 칩 |
| `source` | 서식별 목업 원천 — `reports`(일일 보고서 취합) · `dataset`(카탈로그의 표), 현재 흐름에서 미사용 |

## 대화로 시작

- 진입: 시작 화면 하단 입력란 — 보내기 버튼과 Enter 키, 줄바꿈은 Shift+Enter
- 빈 입력은 전송하지 않음
- 요청 즉시 빈 지면으로 전환한 뒤 요청을 Agent에 전달 — 조회 진행·답변·출처는 우측 대화창에 표시
- Agent가 `draft_report`로 초안을 만들면 지면에 표시, 저장은 대화로 요청(저장 버튼은 화면 연동 단계)

## 데이터 카탈로그 (데이터로 시작)

- 카탈로그: `data/datasets/index.json` — 표 목록(원천 시스템·이름·요약·본문 경로), 좌측 레일과 선택 창이 공유
- 표 본문: `data/datasets/<id>.json` — 원본 행 + 집계 메타, 표마다 스키마가 다름
- 서식 파일: `data/templates/data-brief.html` — 개요·핵심 지표·집계표·특이 항목 4절 구성
- 지시문은 표별 문구(`demo.ask`) + 공통 마무리로 조립 — 편집 불가
- 표 규모는 원천 행수와 추출 행수를 함께 표기 — 표본 합계를 원천 전체로 읽지 않기 위함

| 메타 | 역할 |
| --- | --- |
| `fields` | 열 이름·정렬, 첫 열은 특이 항목의 시간 축 |
| `group_by` | 집계표의 행 축 — 라인·설비·품목 등 |
| `sum` | 합산 대상 열 |
| `derived` | 파생 열 — `ratio`(비율) · `diff`(차) |
| `headline` | 핵심 지표 — `sum` · `diff` · `ratio` · `groups`(그룹 수) · `rows`(행 수) |
| `note` | 행 비고 — 값이 있는 행만 특이 항목으로 수집 |
| `demo.ask` | 목업 시나리오의 지시문 앞 두 문장 |

- 파생 지표 최저 그룹을 특이 항목 머리줄로 제시 — 전체 대비 비교는 `ratio` 에서만 표기(합·차는 전체가 평균이 아님)

## 취합 규칙 (보고서 통합)

- 서식 파일: `data/templates/weekly-summary.html` — 한국 사내 보고서 형식(제목·결재란·문서정보표·항목 번호·서명부)
- 산출물 형식은 고정이 아님 — 창 하단 지시 입력이 결과 문서의 종류·수신자·기간을 정함
- 목업의 지시문은 대상 기간을 데이터에서 채운 고정 문구(편집 불가) — 그 지시에 대응하는 주간 집계서 한 종류만 생성

| 항목 | 산출 방식 |
| --- | --- |
| 총 지시·양품·불량 수량 | 선택한 일일 보고서 합산 |
| 평균 달성률 | 총 양품 ÷ 총 지시 × 100, 소수 첫째 자리 |
| 종합 불량률 | 총 불량 ÷ 총 지시 × 1,000,000 PPM, 반올림 |
| 이상 이벤트 종합 | 특이사항이 있는 보고서만 일자·보고자와 함께 수집 |

## 배포

- 대상: 리버스 프록시 스택(nginx 컨테이너)이 운영 중인 서버 — 같은 호스트에 목업 컨테이너를 추가
- 진입은 그 스택의 nginx 컨테이너가 전담 — 80·443 을 이미 점유, 목업 컨테이너는 포트 미노출
- 목업은 별도 compose 프로젝트(`alab-report`) — 프록시 스택의 외부 망에 별칭 `alab-report` 로만 참여
- 산출물은 Next standalone(`output: "standalone"`) — 추적 파일만 담아 `node server.js` 로 기동
- 이미지는 레지스트리 없이 직접 전송 — 로컬에서 만든 `docker save` 아카이브를 서버에서 `sudo docker load`
- 서버의 도커와 `/opt` 쓰기는 sudo 소관 — 원격 실행은 스크립트가 대행하지 않고 안내 문구로만 제시
- 전송 착지는 홈 하위 `alab-report-drop` — 일반 계정으로 `scp` 가능한 자리, 운영 배치는 `/opt/alab-report`

| 파일 | 역할 |
| --- | --- |
| `Dockerfile` | 3단 빌드 — 의존성 설치·standalone 빌드·비루트 실행 이미지 |
| `.dockerignore` | 이미지 제외 목록 — `node_modules`·`.next`·`.git`·`.local` 등 |
| `docker-compose.yml` | 서버 기동 정의 — 외부 망 참여, 전송받은 이미지 사용, 빌드 단계 없음 |
| `deploy/ship.sh` | 빌드·전송 전용 — 홈 하위 착지점까지, 서버 배치·기동은 안내만 출력 |
| `deploy/nginx/demo-report.acme.conf` | 발급 단계용 80 블록 — 서버 드롭인에 `demo-report.conf` 이름으로 먼저 배치 |
| `deploy/nginx/demo-report.conf` | 최종본 80+443 — 인증서 발급 뒤 같은 이름으로 덮어씀 |

### 절차

1. 〔서버〕 점검 — 망 이름·nginx 컨테이너 이름·드롭인 디렉터리 확인
2. 〔로컬〕 빌드·전송 — `SERVER=user@host deploy/ship.sh`, 이미지·compose·vhost 두 파일이 홈 하위 착지점으로
3. 〔서버〕 `/opt/alab-report` 로 배치 — `sudo cp -a ~/alab-report-drop/. /opt/alab-report/` 후 착지 디렉터리 정리
4. 〔서버〕 발급용 80 블록 배치 — `demo-report.acme.conf` 를 드롭인에 `demo-report.conf` 로 두고 reload
5. 〔서버〕 인증서 발급 — 기존 certbot 컨테이너로 webroot 발급
6. 〔서버〕 최종본 교체 — `demo-report.conf` 로 덮어쓰고 `nginx -t` 후 reload
7. 〔서버〕 적재·기동 — `sudo docker load` 후 `sudo docker compose up -d`
8. 〔로컬〕 확인 — 목업 200·`no-cache`, 운영 도메인 200 유지

```bash
sudo docker ps --format '{{.Names}}' | grep nginx      # nginx 컨테이너 이름 — 이후 명령의 <nginx컨테이너>
sudo docker network ls | grep public                   # 목업이 붙을 망 이름
sudo docker exec <nginx컨테이너> ls /etc/nginx/vhosts.d # 드롭인 반영 여부
sudo docker exec <nginx컨테이너> nginx -t              # 반영 전 문법 검사
sudo docker exec <nginx컨테이너> nginx -s reload       # 반영
```

확인 기준은 다음과 같다.

| 지점 | 성공 판단 |
| --- | --- |
| `nginx -t` | 마지막 줄 `test is successful` — `[emerg]` 면 reload 금지 |
| 발급 로그 | `Successfully received certificate` 와 live 경로 출력 |
| 최종본 반영 직후 | `curl -I https://report.example.com/` 가 502 — 앱 미기동 상태의 정상값 |
| 기동 후 | 목업 경로 200 + `cache-control: no-cache`, 운영 도메인 200 유지 |

### 인증서

- 이 서버에서 신규 발급 — 기존 certbot 컨테이너와 갱신 cron 에 그대로 얹힘
- 전제: DNS 가 이 서버를 가리키고, 80 블록의 acme-challenge location 이 이미 반영된 상태
- `certbot-www` 볼륨은 certbot 이 쓰기, nginx 가 읽기로 공유 — 별도 설정 불필요

```bash
# 프록시 스택의 compose 디렉터리에서 실행
sudo docker compose --profile certbot run --rm certbot \
  certonly --webroot -w /var/www/certbot -d report.example.com \
  --email <메일> --agree-tos --no-eff-email
```

- 발급 결과는 `/etc/letsencrypt/live/report.example.com/` — vhost 의 인증서 경로와 일치
- 갱신은 기존 `certbot renew` cron 이 전 도메인을 함께 처리 — 새 도메인만의 추가 작업 없음

### 제약과 근거

- upstream 은 변수와 resolver 로 지정 — 목업 컨테이너 부재 시 이 도메인만 502, 운영 도메인은 무영향(실측 확인)
- 목업 경로는 `no-cache` — 캐시 잔존 시 새 배포분이 보이지 않음
- 망 이름이 다르면 `PROXY_NETWORK` 로 지정 — 기본 `proxy_public`
- 서브도메인 루트 배포라 `NEXT_PUBLIC_BASE_PATH` 는 주입하지 않음

## 색 토큰 규칙

- 기준: WCAG 2.1 AA — 본문 4.5:1 · 큰 글자(24px 이상, 또는 18.66px 이상 굵게)와 비텍스트 3:1
- 색 리터럴 직접 기재 금지 — CSS·인라인 style 모두 토큰 경유. 예외 둘뿐
  - 색 선택기 그라데이션·손잡이 — 절대색 자체가 의미
  - 아바타 이니셜의 흰 글자 — 채움이 사용자별 색 배정 소관이라 토큰화 불가. 배정 쪽에서 흰 글자 4.5:1 이상 확보
- 라이트값은 `:root` 한 곳. 다크값은 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` 와 `:root[data-theme="dark"]` 두 곳 — 두 블록의 토큰 집합과 값은 항상 일치해야 함
- 라이트 팔레트는 원본 편집기 실측 기준이되 AA 미달분만 상향 — `--ink-faint` #6B6B6B(실측 #787878 은 흰 바탕 4.42:1) · `--good` #1E7A50(실측 #2E9E6B 은 3.38:1)
- `color-scheme` 을 테마마다 선언 — 미선언 시 버튼·체크박스·스크롤바가 UA 기본 밝은 색으로 남아 다크에서 검은 글리프 노출

### 배경별 글자 토큰

| 배경 | 글자 토큰 | 근거 |
| --- | --- | --- |
| `--surface` · `--surface-2` | `--ink` · `--ink-muted` · `--ink-faint`, 강조 글자는 `--accent-strong` | `--accent` 는 라이트 흰 바탕 3.0:1 |
| `--accent-weak` | `--accent-deep` | `--accent` 2.4:1 · `--ink-faint` 3.6:1 로 둘 다 미달 |
| `--accent-strong` · `--good` · `--annot` 채움 | `--on-accent` | 흰 글자는 다크 강조 채움에서 2.1:1 |
| `--bg` (캔버스) | `--on-canvas` | 라이트 캔버스가 중간 회색(#868686)이라 흰 글자로는 최대 3.6:1 |
| `--paper` (지면) | `--paper-ink` | 지면은 인쇄물 — 테마 무관 흰 바탕 고정, 위에 뜨는 조작 UI 도 같은 계열 |

- `--accent` 는 테두리·밑줄·아웃라인 등 비텍스트 전용
- 별도 계열 토큰: `--danger`(연결 끊김·잔여시간 경고) · `--info`(상태바 선택 정보) · `--ruler-*`(눈금자) · `--memo-*`(메모 쪽지)
- 비활성 컨트롤(`.tool-lg.off`)만 대비 규정 예외 — 확정된 선택지 흐림은 투명도 대신 잉크 단계로 구분

### 회귀 감시

- 라이트·다크 각각 시작 화면 · 문서 생성 후 · 시작 모달 3종(데이터·통합·서식)에서 AA 미달 0건이어야 함
- 「0건」 판정 전에 검사 대상 수를 함께 확인 — 모달은 열림 직후 목록이 비어 있어 0건이 눈멂일 수 있음
- 테마 전환 직후에는 컴포넌트 전환(.12s)이 진행 중 — 정착 후 측정하지 않으면 보간색이 잡힘
- 다크 두 블록의 토큰 집합·값 일치와 `var()` 참조 토큰의 정의 여부를 함께 점검 — `--accent-deep` 누락과 `--ui-text` 미정의가 실제 결함이었던 자리

## 목업 원본 보존과 제외 범위

- 컴포넌트 규칙은 원본 보존 — 원본과 시각 동일성 유지 목적
- 색은 전부 팔레트 토큰 경유 — 규칙은 「색 토큰 규칙」 절 소관
- 신규 컴포넌트(대화창·시작 화면·통합 창)도 팔레트 변수만 사용 — 테마 전환 자동 추종
- 제외: rhwp wasm 편집 엔진·엔진 어댑터·표 편집 아이콘
- 제외: 협업 요소(프레즌스 아바타·편집권한 위젯·페이지별 편집자 배지)
- 제외: 리본 도구 플라이아웃 21종 · 우측 드로어 폼 24종 · 요소 삽입 모달 · 첨부파일 탭 · 찾기 탭
- 재도입 시 원본 파일에서 해당 블록을 복사 — 재작성 금지
