#!/bin/bash
# HTTPS 개발 서버 시작 스크립트 (모바일 마이크 테스트용)
#
# 사전 준비:
#   brew install mkcert
#   mkcert -install
#
# 사용법:
#   ./dev-https.sh [LAN_IP]
#   예: ./dev-https.sh 192.168.0.56

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAN_IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")}"
CERT_DIR="$SCRIPT_DIR/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

echo "=== HTTPS 개발 서버 ==="
echo "LAN IP: $LAN_IP"

# mkcert 확인
if ! command -v mkcert &> /dev/null; then
  echo "❌ mkcert가 설치되어 있지 않습니다."
  echo "   brew install mkcert && mkcert -install"
  exit 1
fi

# 인증서 생성
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "📜 인증서 생성 중..."
  mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" \
    "$LAN_IP" localhost 127.0.0.1
  echo "✅ 인증서 생성 완료"
else
  echo "✅ 기존 인증서 사용"
fi

echo ""
echo "📱 모바일에서 접속: https://$LAN_IP:3000"
echo "   (모바일에서 인증서 경고가 뜨면 '고급' → '진행'을 눌러주세요)"
echo ""

# 두 서버를 병렬로 실행
trap 'kill 0' EXIT

echo "🚀 백엔드 시작 (HTTPS, port 8000)..."
cd "$SCRIPT_DIR/backend"
source .venv/bin/activate
uvicorn main:app --reload --port 8000 --host 0.0.0.0 \
  --ssl-keyfile="$KEY_FILE" --ssl-certfile="$CERT_FILE" &

echo "🚀 프론트엔드 시작 (HTTPS, port 3000)..."
cd "$SCRIPT_DIR/frontend"
npx next dev --hostname 0.0.0.0 \
  --experimental-https \
  --experimental-https-key "$KEY_FILE" \
  --experimental-https-cert "$CERT_FILE" &

wait
