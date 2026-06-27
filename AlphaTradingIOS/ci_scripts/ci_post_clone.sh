#!/bin/sh
# Xcode Cloud: 저장소 클론 직후 — API 설정 동기화
set -eu

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
GEN="$REPO_ROOT/AlphaTradingIOS/Config/Generated.xcconfig"
cd "$REPO_ROOT"

echo "==> Xcode Cloud post-clone: sync iOS API config"

if command -v npm >/dev/null 2>&1; then
  npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts 2>/dev/null || true
fi

mkdir -p "$(dirname "$GEN")"
export VITE_API_URL="${VITE_API_URL:-https://alpha-trading-server.onrender.com}"
export VITE_APP_API_KEY="${VITE_APP_API_KEY:-${APP_API_KEY:-}}"

if command -v node >/dev/null 2>&1; then
  node scripts/sync-ios-api-config.mjs release || true
fi

if [ ! -f "$GEN" ]; then
  printf '%s\n' '// Xcode Cloud fallback' \
    'API_BASE_URL = https://alpha-trading-server.onrender.com' \
    'APP_API_KEY =' > "$GEN"
fi

echo "==> post-clone done"
cat "$GEN"
