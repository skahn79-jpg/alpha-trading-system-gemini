#!/usr/bin/env bash
# Xcode Cloud Test + Archive 전 로컬 사전 검증 (MaterialDelivery run_local_ci_preflight.sh 패턴)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$IOS_DIR/.." && pwd)"
PROJECT="$IOS_DIR/AlphaTrading.xcodeproj"
SCHEME="AlphaTrading"
DERIVED_DATA="${DERIVED_DATA:-/tmp/AlphaTradingCIPreflight}"
SIMULATOR_NAME="${SIMULATOR_NAME:-iPhone 17}"

step() { echo; echo "== $1 =="; }
fail() { echo "[preflight] ERROR: $1" >&2; exit 1; }

step "Preflight checks"
[[ -d "$PROJECT" ]] || fail "Missing project: $PROJECT"
xcodebuild -version >/dev/null || fail "xcodebuild not available"

DESTINATION="$(xcodebuild -showdestinations -project "$PROJECT" -scheme "$SCHEME" 2>/dev/null \
  | awk -F'[{},]' -v name="$SIMULATOR_NAME" '
    /platform:iOS Simulator/ && index($0, "name:" name) {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^ id:/) { gsub(/^ id:/, "", $i); print "platform=iOS Simulator,id=" $i; exit }
      }
    }')"

if [[ -z "$DESTINATION" ]]; then
  echo "[preflight] WARN: $SIMULATOR_NAME not found — using generic simulator"
  DESTINATION="generic/platform=iOS Simulator"
fi

step "CI: post-clone"
env CI_PRIMARY_REPOSITORY_PATH="$REPO_ROOT" "$IOS_DIR/ci_scripts/ci_post_clone.sh"

step "CI: pre-xcodebuild (archive)"
env CI_PRIMARY_REPOSITORY_PATH="$REPO_ROOT" CI_XCODEBUILD_ACTION=archive \
  "$IOS_DIR/ci_scripts/ci_pre_xcodebuild.sh"

step "Xcode Cloud: build-for-testing"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing

step "Xcode Cloud: test-without-building"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  test-without-building

step "Release simulator build"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  -configuration Release \
  CODE_SIGNING_ALLOWED=NO \
  build

echo
echo "All local CI preflight checks passed."
echo "Next: Xcode Cloud Workflow → Test iPhone 15 + iOS 18.x (Cloud) 또는 위와 동일 OS."
