#!/bin/bash
# Agent 조회 전용 계정 — MES 데이터베이스 SELECT 권한만 부여
# 이미지 초기화 단계에서 source 로 실행, docker_process_sql 은 엔트리포인트 제공 함수
: "${ALAB_DB_RO_USER:?ALAB_DB_RO_USER 가 필요합니다}"
: "${ALAB_DB_RO_PASSWORD:?ALAB_DB_RO_PASSWORD 가 필요합니다}"

docker_process_sql --database=mysql <<-EOSQL
	CREATE USER IF NOT EXISTS '${ALAB_DB_RO_USER}'@'%' IDENTIFIED BY '${ALAB_DB_RO_PASSWORD}';
	GRANT SELECT ON \`${MARIADB_DATABASE}\`.* TO '${ALAB_DB_RO_USER}'@'%';
	FLUSH PRIVILEGES;
EOSQL
