#!/bin/bash
# HTTPS dev server startup script (for mobile microphone testing)
#
# Prerequisites:
#   brew install mkcert
#   mkcert -install
#
# Usage:
#   ./dev-https.sh [LAN_IP]
#   e.g.: ./dev-https.sh 192.168.0.56

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAN_IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")}"
CERT_DIR="$SCRIPT_DIR/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

echo "=== HTTPS Dev Server ==="
echo "LAN IP: $LAN_IP"

# Check mkcert is installed
if ! command -v mkcert &> /dev/null; then
  echo "mkcert is not installed."
  echo "   brew install mkcert && mkcert -install"
  exit 1
fi

# Generate certificates
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Generating certificates..."
  mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" \
    "$LAN_IP" localhost 127.0.0.1
  echo "Certificates generated"
else
  echo "Using existing certificates"
fi

echo ""
echo "Mobile access: https://$LAN_IP:3000"
echo "   (If you see a certificate warning on mobile, tap 'Advanced' -> 'Proceed')"
echo ""

# Run both servers in parallel
trap 'kill 0' EXIT

echo "Starting backend (HTTPS, port 8000)..."
cd "$SCRIPT_DIR/backend"
source .venv/bin/activate
uvicorn main:app --reload --port 8000 --host 0.0.0.0 \
  --ssl-keyfile="$KEY_FILE" --ssl-certfile="$CERT_FILE" &

echo "Starting frontend (HTTPS, port 3000)..."
cd "$SCRIPT_DIR/frontend"
npx next dev --hostname 0.0.0.0 \
  --experimental-https \
  --experimental-https-key "$KEY_FILE" \
  --experimental-https-cert "$CERT_FILE" &

wait
