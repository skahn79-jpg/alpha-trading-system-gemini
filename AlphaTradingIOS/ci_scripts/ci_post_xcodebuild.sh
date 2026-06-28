#!/bin/sh
# Xcode Cloud: Archive 성공 후 TestFlight 업로드 (Prepare Build 실패 우회)
echo "[CI] ===== ci_post_xcodebuild.sh started ====="
echo "[CI] CI_XCODEBUILD_EXIT_CODE=${CI_XCODEBUILD_EXIT_CODE:-unset}"
echo "[CI] CI_ARCHIVE_PATH=${CI_ARCHIVE_PATH:-unset}"

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "[CI] not an archive build, skip"
  exit 0
fi

if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != "0" ]; then
  echo "[CI] WARN: xcodebuild exit non-zero (often Prepare Build for ASC) — fallback upload will still run"
fi

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
B64_FILE="$SCRIPT_DIR/asc_api_key.b64"
TMP_KEY="${TMPDIR:-/tmp}/asc_key_$$.p8"

# Xcode Cloud는 ASC_API_KEY_ID 이름에 Apple 서버 검증이 걸려 "invalid value" 오류가 날 수 있음.
# → Workflow Environment에는 APPSTORE_* 이름 사용 (아래 fallback 순서).
ASC_API_KEY_ID="${APPSTORE_KEY_ID:-${ASC_API_KEY_ID:-}}"
ASC_ISSUER_ID="${APPSTORE_ISSUER_ID:-${ASC_ISSUER_ID:-}}"
PRIVATE_KEY="${APPSTORE_PRIVATE_KEY:-${ASC_API_PRIVATE_KEY:-}}"

if [ -z "$ASC_API_KEY_ID" ] || [ -z "$ASC_ISSUER_ID" ]; then
  echo "[CI] WARN: APPSTORE_KEY_ID / APPSTORE_ISSUER_ID missing — upload skipped"
  echo "[CI] 로컬: bash AlphaTradingIOS/scripts/setup-asc-api-key.sh"
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
  echo "[CI] decode private key (base64)"
  decode_b64_to_file "$B64_SECRET" "$TMP_KEY" || true
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
  echo "[CI] Workflow Environment Secret 추가 (권장 이름):"
  echo "[CI]   APPSTORE_KEY_ID / APPSTORE_ISSUER_ID / APPSTORE_PRIVATE_KEY"
  echo "[CI]   (ASC_API_KEY_ID 는 Xcode Cloud UI에서 invalid value 오류 가능)"
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
