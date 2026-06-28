#!/usr/bin/env bash
# ASC API 키를 Xcode Cloud Workflow Environment용으로 준비
# 실행 후 출력된 3개 변수를 Workflow → Environment → Secret 으로 추가
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_ID="${ASC_API_KEY_ID:-68F8234UMH}"
P8="${ASC_API_KEY_PATH:-$HOME/Downloads/AuthKey_${KEY_ID}.p8}"
ISSUER_ID="${ASC_ISSUER_ID:-}"

if [[ ! -f "$P8" ]]; then
  echo "❌ API Key 파일 없음: $P8"
  exit 1
fi

if [[ -z "$ISSUER_ID" ]]; then
  echo "Issuer ID 필요 (App Store Connect → 사용자 및 액세스 → 키 → 상단 UUID)"
  read -r -p "ASC_ISSUER_ID: " ISSUER_ID
fi

P8_B64="$(base64 < "$P8" | tr -d '\n')"
OUT="$ROOT/AlphaTradingIOS/ci_scripts/asc_api_key.b64"
printf '%s' "$P8_B64" > "$OUT"
chmod 600 "$OUT"

echo ""
echo "=============================================="
echo " Xcode Cloud Environment — Secret 3개 추가"
echo " Product → Xcode Cloud → Manage Workflows"
echo " → Default → Environment → + Secret"
echo "=============================================="
echo ""
echo "ASC_API_KEY_ID"
echo "$KEY_ID"
echo ""
echo "ASC_ISSUER_ID"
echo "$ISSUER_ID"
echo ""
echo "ASC_API_PRIVATE_KEY"
echo "(아래 .p8 전체 내용 — BEGIN/END 포함)"
cat "$P8"
echo ""
echo "=============================================="
echo "로컬 전용 b64: $OUT (gitignore, Cloud에는 위 Secret 사용)"
echo ""
echo "⚠️  Archive → 배포 준비 = 없음 으로 설정하면"
echo "    Prepare Build 오류 없이 빌드 ✅ + ci_post_xcodebuild 업로드"
echo "=============================================="

printf '%s' "$(cat "$P8")" | pbcopy 2>/dev/null && echo "✅ PRIVATE_KEY 클립보드 복사됨" || true
