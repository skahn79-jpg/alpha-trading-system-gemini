#!/usr/bin/env bash
# ASC API 키를 Xcode Cloud Workflow Environment용으로 준비
# 실행 후 출력된 3개 변수를 Workflow → Environment → Secret 으로 추가
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
KEY_ID="${ASC_API_KEY_ID:-68F8234UMH}"
P8="${ASC_API_KEY_PATH:-$HOME/Downloads/AuthKey_${KEY_ID}.p8}"
ISSUER_ID="${ASC_ISSUER_ID:-}"

if [[ ! -f "$P8" ]]; then
  echo "❌ API Key 파일 없음: $P8"
  exit 1
fi

if [[ -z "$ISSUER_ID" ]]; then
  if [[ -f "$REPO_ROOT/.env.local" ]]; then
    ISSUER_ID="$(grep -E '^ASC_ISSUER_ID=' "$REPO_ROOT/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' \r"'"'"'')"
  fi
fi
if [[ -z "$ISSUER_ID" ]]; then
  echo "Issuer ID 필요 (App Store Connect → 사용자 및 액세스 → 키 → 상단 UUID)"
  read -r -p "APPSTORE_ISSUER_ID: " ISSUER_ID
fi

P8_B64="$(base64 < "$P8" | tr -d '\n')"
OUT="$ROOT/ci_scripts/asc_api_key.b64"
printf '%s' "$P8_B64" > "$OUT"
chmod 600 "$OUT"

KEY_ID_VALID=0
if printf '%s' "$KEY_ID" | grep -Eq '^[A-Z0-9]{10}$'; then
  KEY_ID_VALID=1
fi

# #region agent log
DEBUG_LOG="$REPO_ROOT/.cursor/debug-73e95f.log"
mkdir -p "$(dirname "$DEBUG_LOG")"
TS="$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || date +%s)"
printf '%s\n' "{\"sessionId\":\"73e95f\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H1\",\"location\":\"encode-asc-key-for-cloud.sh\",\"message\":\"key_id_format_check\",\"data\":{\"keyIdLen\":${#KEY_ID},\"keyIdValid\":$KEY_ID_VALID,\"p8Exists\":true},\"timestamp\":$TS}" >> "$DEBUG_LOG"
printf '%s\n' "{\"sessionId\":\"73e95f\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H2\",\"location\":\"encode-asc-key-for-cloud.sh\",\"message\":\"use_appstore_env_names\",\"data\":{\"recommended\":[\"APPSTORE_KEY_ID\",\"APPSTORE_ISSUER_ID\",\"APPSTORE_PRIVATE_KEY\"],\"avoidInXcodeCloud\":[\"ASC_API_KEY_ID\"]},\"timestamp\":$TS}" >> "$DEBUG_LOG"
# #endregion

echo ""
echo "=============================================="
echo " Xcode Cloud Environment — Secret 3개 추가"
echo " Product → Xcode Cloud → Manage Workflows"
echo " → Default → Environment → + Secret"
echo "=============================================="
echo ""
echo "⚠️  ASC_API_KEY_ID 이름은 Xcode Cloud가 Apple API로 검증해"
echo "    'invalid value' 오류가 날 수 있습니다."
echo "    아래 APPSTORE_* 이름을 사용하세요."
echo ""
echo "APPSTORE_KEY_ID"
echo "$KEY_ID"
echo ""
echo "APPSTORE_ISSUER_ID"
echo "$ISSUER_ID"
echo ""
echo "APPSTORE_PRIVATE_KEY"
echo "(아래 .p8 전체 내용 — BEGIN/END 포함)"
cat "$P8"
echo ""
echo "=============================================="
echo "로컬 전용 b64: $OUT (gitignore, Cloud에는 위 Secret 사용)"
echo ""
echo "⚠️  Archive → 배포 준비 = 없음 으로 설정하면"
echo "    Prepare Build 오류 없이 빌드 ✅ + ci_post_xcodebuild 업로드"
echo "=============================================="

printf '%s' "$KEY_ID" | pbcopy 2>/dev/null && echo "✅ APPSTORE_KEY_ID 클립보드 복사됨" || true
