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
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist scripts/ExportOptions-upload.plist \
  -exportPath "$EXPORT"

IPA="$EXPORT/AlphaTrading.ipa"
echo ""
echo "✅ Archive 완료"
echo "   IPA: $IPA"

# App Store Connect 업로드 (환경변수 또는 .env.local)
if [[ -f "$ROOT/.env.local" ]]; then
  # shellcheck disable=SC1090
  set -a && source <(grep -E '^(ASC_API_KEY_ID|ASC_API_ISSUER_ID|ASC_API_KEY_PATH|APPLE_ID|APPLE_APP_PASSWORD)=' "$ROOT/.env.local" 2>/dev/null || true) && set +a
fi

if [[ -n "${ASC_API_KEY_ID:-}" && -n "${ASC_API_ISSUER_ID:-}" && -n "${ASC_API_KEY_PATH:-}" && -f "${ASC_API_KEY_PATH}" ]]; then
  echo "==> App Store Connect 업로드 (API Key)"
  xcrun altool --upload-app --type ios --file "$IPA" \
    --apiKey "$ASC_API_KEY_ID" \
    --apiIssuer "$ASC_API_ISSUER_ID"
  echo "✅ TestFlight 업로드 완료"
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  echo "==> App Store Connect 업로드 (Apple ID)"
  xcrun altool --upload-app --type ios --file "$IPA" \
    -u "$APPLE_ID" -p "$APPLE_APP_PASSWORD"
  echo "✅ TestFlight 업로드 완료"
else
  echo ""
  echo "업로드 자동화: .env.local 에 다음 중 하나를 설정하세요."
  echo "  ASC_API_KEY_ID / ASC_API_ISSUER_ID / ASC_API_KEY_PATH"
  echo "  또는 APPLE_ID / APPLE_APP_PASSWORD (앱 전용 비밀번호)"
  echo ""
  echo "수동 업로드:"
  echo "  1) Xcode → Window → Organizer → Distribute App"
  echo "  2) Transporter 앱에서 IPA 업로드"
fi
