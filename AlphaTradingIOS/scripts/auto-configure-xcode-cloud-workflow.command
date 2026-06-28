#!/usr/bin/env bash
# Xcode Cloud 워크플로 2가지 자동 설정 + 빌드 시작
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"
KEY_ID="$(grep -E '^ASC_API_KEY_ID=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
ISSUER_ID="$(grep -E '^ASC_ISSUER_ID=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
P8="${ASC_API_KEY_PATH:-${HOME}/Downloads/AuthKey_${KEY_ID}.p8}"
if [[ -f "$ENV_LOCAL" ]]; then
  _p="$(grep -E '^ASC_API_KEY_PATH=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
  [[ -n "$_p" ]] && P8="$_p"
fi

if [[ -z "$KEY_ID" || -z "$ISSUER_ID" ]]; then
  echo "❌ .env.local 에 ASC_API_KEY_ID / ASC_ISSUER_ID 없음"
  echo "   bash AlphaTradingIOS/scripts/setup-asc-api-key.sh"
  exit 1
fi

echo "==> 1) 로컬 ASC 설정 (.env.local)"
if [[ ! -f "$P8" ]]; then
  echo "❌ API Key 없음: $P8"
  exit 1
fi

ENV_LOCAL="$ROOT/.env.local"
touch "$ENV_LOCAL"
sed -i '' '/^ASC_API_/d' "$ENV_LOCAL" 2>/dev/null || true
{
  echo ""
  echo "# TestFlight / ASC API (auto)"
  echo "ASC_API_KEY_ID=$KEY_ID"
  echo "ASC_ISSUER_ID=$ISSUER_ID"
  echo "ASC_API_KEY_PATH=$P8"
} >> "$ENV_LOCAL"

mkdir -p "$HOME/private_keys"
cp "$P8" "$HOME/private_keys/AuthKey_${KEY_ID}.p8"
chmod 600 "$HOME/private_keys/AuthKey_${KEY_ID}.p8"

echo "==> 2) Xcode 워크플로 자동 설정 (배포 준비 없음 + ASC Secret)"
osascript "$ROOT/AlphaTradingIOS/scripts/auto-configure-xcode-cloud-workflow.applescript" || {
  echo "⚠️  UI 자동화 일부 실패 — 수동 확인:"
  echo "   Integrate → Manage Workflows → Default → Edit"
  echo "   Archive → 배포 준비: 없음"
  echo "   Environment → Secret 3개 (encode-asc-key-for-cloud.sh 참고)"
  osascript "$ROOT/AlphaTradingIOS/scripts/fix-xcode-cloud-prepare-build.applescript" 2>/dev/null || true
}

echo "==> 3) git push 확인 (최신 commit 빌드)"
cd "$ROOT"
git fetch origin main 2>/dev/null || true
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main 2>/dev/null || echo none)"
echo "   local=$LOCAL remote=$REMOTE"

echo ""
echo "✅ 완료"
echo "   App Store Connect → Xcode Cloud → Start Build (최신 commit)"
echo "   또는 push 후 자동 빌드 대기"
