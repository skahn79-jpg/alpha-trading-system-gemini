#!/usr/bin/env bash
# Xcode Cloud 워크플로 Environment 변수 자동 입력
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY_ID="68F8234UMH"
P8_SRC="$HOME/Downloads/AuthKey_${KEY_ID}.p8"
# App Store Connect → 사용자 및 액세스 → 키 상단 Issuer ID (팀별 UUID)
ISSUER_ID="${ASC_ISSUER_ID:-12ad4880-ea76-4ebf-bbc3-49d0883321a5}"

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
echo "  ASC_API_KEY_ID = $KEY_ID"
echo "  ASC_ISSUER_ID = $ISSUER_ID"
echo "  ASC_API_PRIVATE_KEY = (.p8 전체 — 클립보드에 복사됨)"
echo ""

printf '%s' "$P8_CONTENT" | pbcopy

open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj"
sleep 2
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

echo "1) Default 워크플로 → Environment"
echo "2) + → Secret × 3 (이름/값 위 참고, PRIVATE_KEY는 ⌘V)"
echo "3) 저장"
