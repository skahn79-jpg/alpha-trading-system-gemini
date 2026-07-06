#!/usr/bin/env bash
# TestFlight / App Store Connect 업로드용 Archive 스크립트
set -euo pipefail

IOS="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$IOS/.." && pwd)"
SCHEME="AlphaTrading"
ARCHIVE="$IOS/build/AlphaTrading.xcarchive"
EXPORT="$IOS/build/export"

echo "==> API 설정 동기화 (Release)"
cd "$ROOT"
npm run sync:ios:release

echo "==> Archive (Release / iOS Device)"
cd "$IOS"
xcodebuild -project AlphaTrading.xcodeproj \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  clean archive

echo "==> IPA Export"
# App Store 프로파일 자동 발급용 인증 (ASC API 키가 있으면 사용)
EXPORT_AUTH=()
if [[ -f "$ROOT/.env.local" ]]; then
  ENV_TMP0="$(mktemp)"
  grep -E '^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_ISSUER_ID|ASC_API_KEY_PATH)=' "$ROOT/.env.local" > "$ENV_TMP0" 2>/dev/null || true
  # shellcheck disable=SC1090
  set -a && source "$ENV_TMP0" && set +a
  rm -f "$ENV_TMP0"
fi
ASC_ISSUER_ID="${ASC_ISSUER_ID:-${ASC_API_ISSUER_ID:-}}"
if [[ -n "${ASC_API_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && -f "${ASC_API_KEY_PATH:-}" ]]; then
  EXPORT_AUTH=(-authenticationKeyPath "$ASC_API_KEY_PATH" -authenticationKeyID "$ASC_API_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist scripts/ExportOptions-upload.plist \
  -exportPath "$EXPORT" \
  -allowProvisioningUpdates ${EXPORT_AUTH[@]+"${EXPORT_AUTH[@]}"}

IPA="$EXPORT/AlphaTrading.ipa"
echo ""
echo "✅ Archive 완료"

# ExportOptions destination=upload 는 export 단계에서 바로 업로드하고 IPA를 남기지 않음
if [[ ! -f "$IPA" ]]; then
  echo "✅ TestFlight 업로드 완료 (export 단계에서 업로드됨)"
  exit 0
fi
echo "   IPA: $IPA"

# App Store Connect 업로드 (환경변수 또는 .env.local)
if [[ -f "$ROOT/.env.local" ]]; then
  # 프로세스 치환(<())은 일부 샌드박스 셸에서 조용히 실패하므로 임시 파일 사용
  ENV_TMP="$(mktemp)"
  grep -E '^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_ISSUER_ID|ASC_API_KEY_PATH|APPLE_ID|APPLE_APP_PASSWORD)=' "$ROOT/.env.local" > "$ENV_TMP" 2>/dev/null || true
  # shellcheck disable=SC1090
  set -a && source "$ENV_TMP" && set +a
  rm -f "$ENV_TMP"
fi

ASC_ISSUER_ID="${ASC_ISSUER_ID:-${ASC_API_ISSUER_ID:-}}"

if [[ -n "${ASC_API_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && -n "${ASC_API_KEY_PATH:-}" && -f "${ASC_API_KEY_PATH}" ]]; then
  echo "==> App Store Connect 업로드 (API Key)"
  xcrun altool --upload-app --type ios --file "$IPA" \
    --apiKey "$ASC_API_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID"
  echo "✅ TestFlight 업로드 완료"
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  echo "==> App Store Connect 업로드 (Apple ID)"
  xcrun altool --upload-app --type ios --file "$IPA" \
    -u "$APPLE_ID" -p "$APPLE_APP_PASSWORD"
  echo "✅ TestFlight 업로드 완료"
else
  echo ""
  echo "업로드 자동화: .env.local 에 다음 중 하나를 설정하세요."
  echo "  ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_KEY_PATH"
  echo "  또는 APPLE_ID / APPLE_APP_PASSWORD (앱 전용 비밀번호)"
  echo ""
  echo "수동 업로드:"
  echo "  1) Xcode → Window → Organizer → Distribute App"
  echo "  2) Transporter 앱에서 IPA 업로드"
fi
