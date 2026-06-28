#!/bin/sh
# Xcode Cloud: Archive 직후 IPA export + TestFlight 업로드 (Prepare Build 우회)
# 워크플로 환경 변수: ASC_API_KEY_ID, ASC_ISSUER_ID, ASC_API_PRIVATE_KEY (비밀)
set -eu

if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "==> ci_post_xcodebuild: archive failed, skip upload"
  exit 0
fi

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "==> ci_post_xcodebuild: not an archive build, skip"
  exit 0
fi

if [ -z "${ASC_API_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ] || [ -z "${ASC_API_PRIVATE_KEY:-}" ]; then
  echo "==> ci_post_xcodebuild: ASC API env not set — workflow에 아래 3개 추가 후 재빌드:"
  echo "    ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_PRIVATE_KEY"
  exit 0
fi

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
EXPORT_DIR="${TMPDIR:-/tmp}/alpha-testflight-export"
KEY_DIR="$HOME/private_keys"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"

mkdir -p "$KEY_DIR" "$EXPORT_DIR"
printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"

echo "==> ci_post_xcodebuild: export IPA"
xcodebuild -exportArchive \
  -archivePath "$CI_ARCHIVE_PATH" \
  -exportOptionsPlist "$IOS_DIR/ExportOptions-ci.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
if [ -z "$IPA" ] || [ ! -f "$IPA" ]; then
  echo "==> ci_post_xcodebuild: IPA not found in $EXPORT_DIR"
  exit 0
fi

echo "==> ci_post_xcodebuild: upload via iTMSTransporter ($IPA)"
# Xcode 26 altool JWT 버그 우회 — iTMSTransporter 사용
xcrun iTMSTransporter -m upload \
  -assetFile "$IPA" \
  -apiKey "$ASC_API_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID" \
  -v informational

echo "==> ci_post_xcodebuild: TestFlight upload requested"
