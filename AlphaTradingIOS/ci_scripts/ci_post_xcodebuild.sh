#!/bin/sh
# Xcode Cloud: Archive 성공 후 TestFlight 업로드 (Prepare Build 실패 우회)
# 워크플로 Environment 비밀 변수: ASC_API_KEY_ID, ASC_ISSUER_ID, ASC_API_PRIVATE_KEY
echo "[CI] ===== ci_post_xcodebuild.sh started ====="

if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "[CI] archive failed, skip upload"
  exit 0
fi

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "[CI] not an archive build, skip"
  exit 0
fi

if [ -z "${ASC_API_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ] || [ -z "${ASC_API_PRIVATE_KEY:-}" ]; then
  echo "[CI] ASC API env not set — TestFlight 자동 업로드 스킵"
  echo "[CI] Workflow Environment에 ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_PRIVATE_KEY 추가"
  exit 0
fi

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
EXPORT_DIR="${TMPDIR:-/tmp}/alpha-testflight-export-$$"
KEY_DIR="$HOME/private_keys"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"

mkdir -p "$KEY_DIR" "$EXPORT_DIR"
printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"

echo "[CI] export IPA from archive"
if ! xcodebuild -exportArchive \
  -archivePath "$CI_ARCHIVE_PATH" \
  -exportOptionsPlist "$IOS_DIR/scripts/ExportOptions-export.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates; then
  echo "[CI] WARN: exportArchive failed"
  exit 0
fi

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
if [ -z "$IPA" ] || [ ! -f "$IPA" ]; then
  echo "[CI] WARN: IPA not found in $EXPORT_DIR"
  exit 0
fi

echo "[CI] upload via iTMSTransporter: $IPA"
if xcrun iTMSTransporter -m upload \
  -assetFile "$IPA" \
  -apiKey "$ASC_API_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID" \
  -v informational; then
  echo "[CI] TestFlight upload requested successfully"
else
  echo "[CI] WARN: iTMSTransporter upload failed (Prepare Build may still show error)"
fi

echo "[CI] ===== ci_post_xcodebuild.sh finished ====="
