#!/usr/bin/env bash
# MaterialDelivery 패턴 — 로컬 Xcode Cloud 사전 검증
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IOS="$ROOT/AlphaTradingIOS"
SCHEME="AlphaTrading"
DEBUG_LOG="$ROOT/.cursor/debug-73e95f.log"

pass() { echo "✅ $*"; }
fail() { echo "❌ $*"; exit 1; }

log_debug() {
  local msg="$1" data="$2"
  mkdir -p "$(dirname "$DEBUG_LOG")" 2>/dev/null || true
  printf '%s\n' "{\"sessionId\":\"73e95f\",\"runId\":\"preflight\",\"location\":\"run-local-ci-preflight.sh\",\"message\":\"$msg\",\"data\":$data,\"timestamp\":$(date +%s)000}" >> "$DEBUG_LOG" 2>/dev/null || true
}

echo "== Alpha Trading Xcode Cloud Preflight (MaterialDelivery pattern) =="
echo ""

# 1) ci_scripts
[[ -x "$IOS/ci_scripts/ci_pre_xcodebuild.sh" ]] || fail "ci_pre_xcodebuild.sh missing or not executable"
[[ -f "$IOS/ci_scripts/ci_post_clone.sh" ]] || fail "ci_post_clone.sh missing"
pass "ci_scripts present"

check_scheme_configuration() {
  local scheme_file="$IOS/AlphaTrading.xcodeproj/xcshareddata/xcschemes/AlphaTrading-CI.xcscheme"

  if [[ ! -f "$scheme_file" ]]; then
    fail "AlphaTrading-CI.xcscheme not found: $scheme_file"
  fi

  if ! grep -q 'TestAction' "$scheme_file"; then
    fail "AlphaTrading-CI.xcscheme missing TestAction section"
  fi
  if ! grep -q 'enabled = \"NO\"' "$scheme_file"; then
    fail "AlphaTrading-CI.xcscheme TestAction must have enabled = \"NO\""
  fi
  if ! grep -q 'buildForTesting = \"NO\"' "$scheme_file"; then
    fail "AlphaTrading-CI.xcscheme BuildAction must have buildForTesting = \"NO\""
  fi

  pass "AlphaTrading-CI.xcscheme Stage 1 configuration verified"
}

check_scheme_configuration

# 2) No ExportOptions at project root (Prepare Build trigger)
if [[ -f "$IOS/ExportOptions.plist" ]]; then
  fail "Remove AlphaTradingIOS/ExportOptions.plist (MaterialDelivery: no root ExportOptions)"
fi
pass "no ExportOptions.plist at iOS root"

# 3) ci_pre simulation
export CI_PRIMARY_REPOSITORY_PATH="$ROOT"
export CI_XCODEBUILD_ACTION="archive"
if bash "$IOS/ci_scripts/ci_pre_xcodebuild.sh" >/tmp/at_ci_pre.log 2>&1; then
  pass "ci_pre_xcodebuild.sh (archive)"
  log_debug "ci_pre" "{\"ok\":true}"
else
  cat /tmp/at_ci_pre.log
  fail "ci_pre_xcodebuild.sh failed"
fi

# 4) ci_post MaterialDelivery mode (no ASC upload)
export CI_ARCHIVE_PATH="/tmp/fake.xcarchive"
export CI_XCODEBUILD_EXIT_CODE="0"
unset ENABLE_CI_ASC_UPLOAD APPSTORE_KEY_ID APPSTORE_ISSUER_ID APPSTORE_PRIVATE_KEY
OUT="$(bash "$IOS/ci_scripts/ci_post_xcodebuild.sh" 2>&1)"
echo "$OUT" | grep -q "MaterialDelivery mode" || fail "ci_post should skip in workflow mode"
pass "ci_post_xcodebuild.sh skips ASC upload (workflow mode)"
log_debug "ci_post_skip" "{\"ok\":true}"

# 5) Build number
VER="$(grep '^CURRENT_PROJECT_VERSION' "$IOS/Config/Release.xcconfig" | awk '{print $3}')"
pass "CURRENT_PROJECT_VERSION=$VER"

# 6) Team
grep -q 'VWAZ3CVW5Z' "$IOS/Config/Signing.xcconfig" && pass "DEVELOPMENT_TEAM=VWAZ3CVW5Z"

echo ""
echo "== Workflow checklist (manual in Xcode) =="
echo "  1차: Archive 배포 준비 = 없음, Post-Actions OFF, Environment 비움"
echo "  2차: Archive 배포 준비 = TestFlight and App Store"
echo "  3차: Post-Actions TestFlight Internal ON"
echo ""
echo "ASC API 키: 불필요 (MaterialDelivery와 동일)"
log_debug "preflight_done" "{\"ok\":true,\"build\":$VER}"
echo ""
echo "✅ Preflight passed — Xcode Cloud 1차 빌드 준비 완료"
