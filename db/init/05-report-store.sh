#!/bin/bash
# 보고서 저장소 — MES 데이터베이스와 분리된 alab_report 스키마, 앱 계정만 읽기·쓰기 허용
# 이미지 초기화 단계에서 source 로 실행, 조회 전용 계정(04)에는 권한 미부여
: "${MARIADB_USER:?MARIADB_USER 가 필요합니다}"

docker_process_sql --database=mysql <<-EOSQL
	CREATE DATABASE IF NOT EXISTS alab_report CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

	-- 보고서 — 메타와 서식 키별 채움 값(JSON), 시스템 키(문서번호·작성일)는 컬럼으로 보관
	CREATE TABLE alab_report.report (
	    report_id BIGINT AUTO_INCREMENT PRIMARY KEY,
	    doc_no VARCHAR(40) NOT NULL UNIQUE,         -- 문서번호 (서식 접두어-작성일-일련번호)
	    template_id VARCHAR(50) NOT NULL,           -- 서식 ID (public 서식 레지스트리)
	    title VARCHAR(200) NOT NULL,                -- 문서 제목
	    account_id VARCHAR(50) NOT NULL,            -- 작성 계정 ID
	    writer VARCHAR(100) NOT NULL,               -- 작성 시점 기안자 표기
	    period_from DATE NULL,                      -- 대상 기간 시작일
	    period_to DATE NULL,                        -- 대상 기간 종료일
	    request_text TEXT NULL,                     -- 기안 요청 원문
	    fills JSON NOT NULL CHECK (JSON_VALID(fills)),  -- 서식 키별 구조화 채움 값
	    draft JSON NULL CHECK (draft IS NULL OR JSON_VALID(draft)),  -- 수정 재개용 기안 입력(참조 형태)과 참조 원천 조회 목록
	    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	    INDEX ix_report_account (account_id, created_at)
	);

	-- 보고서 수치 — 수치 키별 값·분자·분모와 출처 조회, 원본 재조회 대조의 단위
	CREATE TABLE alab_report.report_number (
	    report_id BIGINT NOT NULL,
	    num_key VARCHAR(120) NOT NULL,              -- 수치 위치 (서식 키·항목 경로)
	    label VARCHAR(200) NULL,                    -- 표시 라벨
	    value DECIMAL(24, 6) NOT NULL,              -- 보고서 기재 값
	    numerator DECIMAL(24, 6) NULL,              -- 비율 지표 분자
	    denominator DECIMAL(24, 6) NULL,            -- 비율 지표 분모
	    unit VARCHAR(20) NULL,                      -- 단위
	    query_id VARCHAR(80) NULL,                  -- 출처 조회 ID
	    source_path VARCHAR(200) NULL,              -- 출처 결과 내 경로
	    source_call JSON NULL CHECK (source_call IS NULL OR JSON_VALID(source_call)),  -- 출처 조회 이름·입력
	    PRIMARY KEY (report_id, num_key),
	    FOREIGN KEY (report_id) REFERENCES alab_report.report(report_id) ON DELETE CASCADE
	);

	-- 문서번호 일련번호 — 접두어·일자별 마지막 번호
	CREATE TABLE alab_report.doc_seq (
	    prefix VARCHAR(20) NOT NULL,
	    issue_date DATE NOT NULL,
	    last_no INT NOT NULL,
	    PRIMARY KEY (prefix, issue_date)
	);

	GRANT SELECT, INSERT, UPDATE, DELETE ON alab_report.* TO '${MARIADB_USER}'@'%';
	FLUSH PRIVILEGES;
EOSQL
