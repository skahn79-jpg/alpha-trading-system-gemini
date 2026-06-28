#!/bin/sh
# Xcode Cloud: 클론 직후 API 설정
echo "[CI] post-clone: preparing iOS API config"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/AlphaTradingIOS"
GEN="$IOS_DIR/Config/Generated.xcconfig"
EXAMPLE="$IOS_DIR/Config/Generated.xcconfig.example"

echo "[CI] REPO_ROOT=$REPO_ROOT"
echo "[CI] GEN=$GEN"

mkdir -p "$IOS_DIR/Config" || exit 1

if [ -f "$GEN" ]; then
  echo "[CI] Generated.xcconfig already exists"
  exit 0
fi

if [ -f "$EXAMPLE" ]; then
  cp "$EXAMPLE" "$GEN"
  echo "[CI] post-clone: copied Generated.xcconfig.example"
  exit 0
fi

printf '%s\n' \
  '// Xcode Cloud — production defaults' \
  'API_BASE_URL = https://alpha-trading-server.onrender.com' \
  'APP_API_KEY =' > "$GEN"

if command -v node >/dev/null 2>&1 && [ -f "$REPO_ROOT/package.json" ]; then
  echo "[CI] post-clone: npm install + sync (best effort)"
  (cd "$REPO_ROOT" && npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts 2>/dev/null || true)
  if [ -f "$REPO_ROOT/scripts/sync-ios-api-config.mjs" ]; then
    (cd "$REPO_ROOT" && node scripts/sync-ios-api-config.mjs release) || echo "[CI] WARN: sync skipped"
  fi
fi

echo "[CI] post-clone: Generated.xcconfig ready"
