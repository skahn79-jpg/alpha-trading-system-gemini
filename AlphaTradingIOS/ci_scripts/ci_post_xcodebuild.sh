#!/bin/sh
# Xcode Cloud: Archive 성공 후 TestFlight 업로드 (Prepare Build 실패 우회)
echo "[CI] ===== ci_post_xcodebuild.sh started ====="

if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "[CI] archive failed, skip upload"
  exit 0
fi

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "[CI] not an archive build, skip"
  exit 0
fi

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
B64_FILE="$SCRIPT_DIR/asc_api_key.b64"
TMP_KEY="${TMPDIR:-/tmp}/asc_key_$$.p8"

ASC_API_KEY_ID="${ASC_API_KEY_ID:-68F8234UMH}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-12ad4880-ea76-4ebf-bbc3-49d0883321a5}"
PRIVATE_KEY="${ASC_API_PRIVATE_KEY:-}"

decode_b64_to_file() {
  _src="$1"
  _dst="$2"
  if printf '%s' "$_src" | tr -d '\n\r ' | base64 --decode > "$_dst" 2>/dev/null; then
    return 0
  fi
  printf '%s' "$_src" | tr -d '\n\r ' | base64 -d > "$_dst" 2>/dev/null
}

if [ -z "$PRIVATE_KEY" ] && [ -n "${ASC_API_PRIVATE_KEY_BASE64:-}" ]; then
  echo "[CI] decode ASC_API_PRIVATE_KEY_BASE64"
  decode_b64_to_file "$ASC_API_PRIVATE_KEY_BASE64" "$TMP_KEY" || true
  if [ -s "$TMP_KEY" ]; then
    PRIVATE_KEY="$(cat "$TMP_KEY")"
  fi
fi

if [ -z "$PRIVATE_KEY" ] && [ -f "$B64_FILE" ]; then
  echo "[CI] using asc_api_key.b64"
  B64_CONTENT="$(tr -d '\n\r ' < "$B64_FILE")"
  decode_b64_to_file "$B64_CONTENT" "$TMP_KEY" || true
  if [ -s "$TMP_KEY" ]; then
    PRIVATE_KEY="$(cat "$TMP_KEY")"
  fi
fi

if [ -z "$PRIVATE_KEY" ]; then
  echo "[CI] WARN: ASC private key missing — upload skipped"
  echo "[CI] Workflow Environment Secret 추가:"
  echo "[CI]   ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_PRIVATE_KEY"
  echo "[CI] 또는 로컬: bash AlphaTradingIOS/scripts/encode-asc-key-for-cloud.sh"
  rm -f "$TMP_KEY"
  exit 0
fi

KEY_DIR="$HOME/private_keys"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
EXPORT_DIR="${TMPDIR:-/tmp}/alpha-testflight-export-$$"

mkdir -p "$KEY_DIR" "$EXPORT_DIR"
printf '%s\n' "$PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"
rm -f "$TMP_KEY"

echo "[CI] export IPA (key_id=$ASC_API_KEY_ID)"
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
  echo "[CI] WARN: IPA not found"
  exit 0
fi

echo "[CI] upload via iTMSTransporter"
if xcrun iTMSTransporter -m upload \
  -assetFile "$IPA" \
  -apiKey "$ASC_API_KEY_ID" \
  -apiIssuer "$ASC_ISSUER_ID" \
  -v informational; then
  echo "[CI] ✅ TestFlight upload requested"
else
  echo "[CI] WARN: iTMSTransporter failed — Issuer ID·API 권한 확인"
fi

echo "[CI] ===== ci_post_xcodebuild.sh finished ====="
