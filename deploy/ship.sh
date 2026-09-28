#!/usr/bin/env bash
# 이미지 빌드·전송 전용 — 서버 배치·적재·기동은 sudo 필요라 이 스크립트가 대신 실행하지 않음
# 전송 착지는 홈 하위(일반 계정 쓰기 가능), 운영 배치는 서버에서 sudo 로 /opt/alab-report 로 옮김
# 사용: SERVER=user@host [IMAGE_TAG=2026-08-21] [DROP_DIR=alab-report-drop] deploy/ship.sh
set -euo pipefail

: "${SERVER:?SERVER 미지정 — 예: SERVER=deploy@dev.example.com}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DROP_DIR="${DROP_DIR:-alab-report-drop}"        # 전송 착지점 — 홈 하위
TARGET_DIR="${TARGET_DIR:-/opt/alab-report}"    # 운영 배치 경로 — 서버에서 sudo 로 이동
IMAGE="alab-data-report:${IMAGE_TAG}"
ARCHIVE="alab-data-report-${IMAGE_TAG}.tar.gz"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "[1/3] 이미지 빌드 — ${IMAGE}"
docker build -t "${IMAGE}" "${ROOT}"

echo "[2/3] 아카이브 생성 — ${ARCHIVE}"
docker save "${IMAGE}" | gzip > "${WORK}/${ARCHIVE}"
# 태그 고정 — 서버에서 compose 가 .env 를 자동으로 읽어 IMAGE_TAG 주입
printf 'IMAGE_TAG=%s\n' "${IMAGE_TAG}" > "${WORK}/.env"

echo "[3/3] 전송 — ${SERVER}:~/${DROP_DIR}/"
ssh "${SERVER}" "mkdir -p '${DROP_DIR}'"
scp "${WORK}/${ARCHIVE}" "${WORK}/.env" "${ROOT}/docker-compose.yml" \
    "${ROOT}/deploy/nginx/demo-report.acme.conf" "${ROOT}/deploy/nginx/demo-report.conf" \
    "${SERVER}:${DROP_DIR}/"

cat <<GUIDE

전송 완료. 서버에서 아래를 직접 실행(배치·도커 모두 sudo 필요).

  ssh ${SERVER}
  sudo mkdir -p ${TARGET_DIR}
  sudo cp -a ~/${DROP_DIR}/. ${TARGET_DIR}/
  rm -rf ~/${DROP_DIR}
  cd ${TARGET_DIR}
  sudo docker load < ${ARCHIVE}
  sudo docker compose up -d
  sudo docker compose ps

확인 기준: load 가 'Loaded image: ${IMAGE}' 출력, ps 의 STATUS 가 Up — 30초쯤 뒤 healthy 표시
vhost 배치·인증서 발급은 README 배포 절 참고 — 미배치 시 도메인 접근만 불가, 컨테이너는 정상
GUIDE
