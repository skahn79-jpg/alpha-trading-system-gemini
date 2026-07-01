#!/bin/sh
# Xcode Cloud: Archive 직후 — 선택적 수동 TestFlight 업로드
# MaterialDelivery는 이 스크립트 없이 워크플로 TestFlight만 사용합니다.
echo "[CI] ===== ci_post_xcodebuild.sh started ====="

if [ "${ENABLE_CI_ASC_UPLOAD:-}" != "1" ]; then
  echo "[CI] MaterialDelivery mode: ENABLE_CI_ASC_UPLOAD≠1 — ASC 수동 업로드 스킵"
  echo "[CI] TestFlight는 워크플로 Archive → TestFlight and App Store 로 처리"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0 (workflow mode)"
  echo "[CI] ===== ci_post_xcodebuild.sh finished ====="
  exit 0
fi

echo "[CI] CI_XCODEBUILD_EXIT_CODE=${CI_XCODEBUILD_EXIT_CODE:-unset}"
echo "[CI] CI_ARCHIVE_PATH=${CI_ARCHIVE_PATH:-unset}"

UPLOAD_ATTEMPTED=0
UPLOAD_SUCCEEDED=0

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "[CI] not an archive build, skip"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0"
  exit 0
fi

if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "[CI] WARN: xcodebuild exit non-zero — fallback upload may still run"
fi

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
B64_FILE="$SCRIPT_DIR/asc_api_key.b64"
TMP_KEY="${TMPDIR:-/tmp}/asc_key_$$.p8"
DEBUG_LOG="$REPO_ROOT/.cursor/debug-73e95f.log"

log_debug() {
  _msg="$1"
  _data="$2"
  _ts="$(date +%s)000"
  mkdir -p "$(dirname "$DEBUG_LOG")" 2>/dev/null || true
  printf '%s\n' "{\"sessionId\":\"73e95f\",\"runId\":\"ci-post\",\"location\":\"ci_post_xcodebuild.sh\",\"message\":\"$_msg\",\"data\":$_data,\"timestamp\":$_ts}" >> "$DEBUG_LOG" 2>/dev/null || true
}

ASC_API_KEY_ID="${APPSTORE_KEY_ID:-${ASC_API_KEY_ID:-}}"
ASC_ISSUER_ID="${APPSTORE_ISSUER_ID:-${ASC_ISSUER_ID:-}}"
PRIVATE_KEY="${APPSTORE_PRIVATE_KEY:-${ASC_API_PRIVATE_KEY:-}}"

if [ -z "$ASC_API_KEY_ID" ] || [ -z "$ASC_ISSUER_ID" ]; then
  echo "[CI] WARN: APPSTORE_KEY_ID / APPSTORE_ISSUER_ID missing — upload skipped"
  log_debug "asc_missing" "{\"ok\":false}"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0"
  exit 0
fi

decode_b64_to_file() {
  _src="$1"
  _dst="$2"
  if printf '%s' "$_src" | tr -d '\n\r ' | base64 --decode > "$_dst" 2>/dev/null; then
    return 0
  fi
  printf '%s' "$_src" | tr -d '\n\r ' | base64 -d > "$_dst" 2>/dev/null
}

B64_SECRET="${APPSTORE_PRIVATE_KEY_BASE64:-${ASC_API_PRIVATE_KEY_BASE64:-}}"
if [ -z "$PRIVATE_KEY" ] && [ -n "$B64_SECRET" ]; then
  decode_b64_to_file "$B64_SECRET" "$TMP_KEY" || true
  if [ -s "$TMP_KEY" ]; then
    PRIVATE_KEY="$(cat "$TMP_KEY")"
  fi
fi

if [ -z "$PRIVATE_KEY" ] && [ -f "$B64_FILE" ]; then
  decode_b64_to_file "$(tr -d '\n\r ' < "$B64_FILE")" "$TMP_KEY" || true
  if [ -s "$TMP_KEY" ]; then
    PRIVATE_KEY="$(cat "$TMP_KEY")"
  fi
fi

if [ -z "$PRIVATE_KEY" ]; then
  echo "[CI] WARN: ASC private key missing — upload skipped"
  log_debug "p8_missing" "{\"ok\":false}"
  rm -f "$TMP_KEY"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0"
  exit 0
fi

KEY_DIR="$HOME/private_keys"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
EXPORT_DIR="${TMPDIR:-/tmp}/alpha-testflight-export-$$"

mkdir -p "$KEY_DIR" "$EXPORT_DIR"
printf '%s\n' "$PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"
rm -f "$TMP_KEY"

if ! xcodebuild -exportArchive \
  -archivePath "$CI_ARCHIVE_PATH" \
  -exportOptionsPlist "$IOS_DIR/scripts/ExportOptions-export.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates; then
  log_debug "export_failed" "{\"ok\":false}"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0"
  exit 0
fi

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
if [ -z "$IPA" ] || [ ! -f "$IPA" ]; then
  log_debug "ipa_missing" "{\"ok\":false}"
  echo "[CI] SUMMARY upload_attempted=0 upload_succeeded=0 exit=0"
  exit 0
fi

UPLOAD_ATTEMPTED=1
if xcrun iTMSTransporter -m upload \
  -assetFile "$IPA" \
  -apiKey "$ASC_API_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID" \
  -v informational; then
  UPLOAD_SUCCEEDED=1
  log_debug "upload_ok" "{\"ok\":true}"
else
  log_debug "upload_fail" "{\"ok\":false}"
fi

echo "[CI] SUMMARY upload_attempted=${UPLOAD_ATTEMPTED} upload_succeeded=${UPLOAD_SUCCEEDED} exit=0"
echo "[CI] ===== ci_post_xcodebuild.sh finished ====="
exit 0
