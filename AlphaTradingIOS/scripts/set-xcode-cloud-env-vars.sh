#!/usr/bin/env bash
# Xcode Cloud 워크플로 Environment 변수 자동 입력
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"

load_from_env_local() {
  if [[ -f "$ENV_LOCAL" ]]; then
    KEY_ID="$(grep -E '^ASC_API_KEY_ID=' "$ENV_LOCAL" | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
    ISSUER_ID="$(grep -E '^ASC_ISSUER_ID=' "$ENV_LOCAL" | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
  fi
}
load_from_env_local

KEY_ID="${ASC_API_KEY_ID:-${KEY_ID:-}}"
ISSUER_ID="${ASC_ISSUER_ID:-${ISSUER_ID:-}}"
P8_SRC="${ASC_API_KEY_PATH:-$HOME/Downloads/AuthKey_${KEY_ID}.p8}"

if [[ -z "$KEY_ID" || -z "$ISSUER_ID" ]]; then
  echo "❌ ASC_API_KEY_ID / ASC_ISSUER_ID 없음"
  echo "   bash AlphaTradingIOS/scripts/setup-asc-api-key.sh 실행 후 다시 시도"
  exit 1
fi

if [[ ! -f "$P8_SRC" ]]; then
  echo "❌ API Key 없음: $P8_SRC"
  exit 1
fi

P8_CONTENT="$(cat "$P8_SRC")"

# 로컬 업로드용 .env.local (gitignore)
ENV_LOCAL="$ROOT/.env.local"
touch "$ENV_LOCAL"
grep -q '^ASC_API_KEY_ID=' "$ENV_LOCAL" 2>/dev/null && sed -i '' '/^ASC_API_/d' "$ENV_LOCAL" || true
{
  echo ""
  echo "# TestFlight / App Store Connect API (자동 설정)"
  echo "ASC_API_KEY_ID=$KEY_ID"
  echo "ASC_ISSUER_ID=$ISSUER_ID"
  echo "ASC_API_KEY_PATH=$P8_SRC"
} >> "$ENV_LOCAL"

mkdir -p "$HOME/private_keys"
cp "$P8_SRC" "$HOME/private_keys/AuthKey_${KEY_ID}.p8"
chmod 600 "$HOME/private_keys/AuthKey_${KEY_ID}.p8"

echo "✅ .env.local 에 ASC 변수 저장됨"
echo "   ASC_API_KEY_ID=$KEY_ID"
echo "   ASC_ISSUER_ID=$ISSUER_ID"
echo ""
echo "Xcode 워크플로 Environment 창을 엽니다..."
echo "아래 3개를 Secret 변수로 추가하세요 (+ 버튼):"
echo "  APPSTORE_KEY_ID = $KEY_ID"
echo "  APPSTORE_ISSUER_ID = $ISSUER_ID"
echo "  APPSTORE_PRIVATE_KEY = (.p8 전체 — 클립보드에 복사됨)"
echo "  (ASC_API_KEY_ID 이름은 Xcode Cloud invalid value 오류 가능 — 사용하지 마세요)"
echo ""

printf '%s' "$P8_CONTENT" | pbcopy

open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj"
sleep 2
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

echo "1) Default 워크플로 → Environment"
echo "2) + → Secret × 3 (이름/값 위 참고, PRIVATE_KEY는 ⌘V)"
echo "3) 저장"
