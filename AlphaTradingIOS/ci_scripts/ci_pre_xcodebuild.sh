#!/bin/sh
# Xcode Cloud: xcodebuild 직전 — API 설정 검증 (실패해도 npm 오류로 빌드 중단 방지)
echo "[CI] ===== ci_pre_xcodebuild.sh started ====="

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
GEN="$IOS_DIR/Config/Generated.xcconfig"
EXAMPLE="$IOS_DIR/Config/Generated.xcconfig.example"
ACTION="${CI_XCODEBUILD_ACTION:-unknown}"

echo "[CI] REPO_ROOT=$REPO_ROOT"
echo "[CI] IOS_DIR=$IOS_DIR"
echo "[CI] xcodebuild_action=$ACTION"

mkdir -p "$IOS_DIR/Config" || {
  echo "[CI] ERROR: cannot create Config directory"
  exit 1
}

if [ ! -f "$GEN" ] && [ -f "$EXAMPLE" ]; then
  cp "$EXAMPLE" "$GEN" || true
  echo "[CI] Copied Generated.xcconfig from example"
fi

if [ ! -f "$GEN" ]; then
  printf '%s\n' \
    '// Xcode Cloud — production defaults' \
    'API_BASE_URL = https://alpha-trading-server.onrender.com' \
    'APP_API_KEY =' > "$GEN"
  echo "[CI] Created default Generated.xcconfig"
fi

if command -v node >/dev/null 2>&1 && [ -f "$REPO_ROOT/scripts/sync-ios-api-config.mjs" ]; then
  echo "[CI] Running sync-ios-api-config.mjs (release)"
  (cd "$REPO_ROOT" && node scripts/sync-ios-api-config.mjs release) || echo "[CI] WARN: sync-ios-api-config skipped"
fi

if ! grep -q "API_BASE_URL" "$GEN"; then
  echo "[CI] ERROR: Generated.xcconfig missing API_BASE_URL"
  exit 1
fi

echo "[CI] Generated.xcconfig ready"
echo "[CI] DEVELOPMENT_TEAM=VWAZ3CVW5Z (hardcoded in project.pbxproj)"
echo "[CI] NOTE: ExportOptions.plist removed from project root (MaterialDelivery pattern)"
echo "[CI] ===== ci_pre_xcodebuild.sh finished ====="
