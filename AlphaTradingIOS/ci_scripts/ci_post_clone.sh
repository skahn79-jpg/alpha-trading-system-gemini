#!/bin/sh
# Xcode Cloud: 저장소 클론 직후 — API 설정 동기화 (항상 exit 0)
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
GEN="$REPO_ROOT/AlphaTradingIOS/Config/Generated.xcconfig"

echo "==> Xcode Cloud post-clone"
cd "$REPO_ROOT" || exit 0
mkdir -p "$(dirname "$GEN")"

if command -v npm >/dev/null 2>&1; then
  npm ci --ignore-scripts >/dev/null 2>&1 || npm install --ignore-scripts >/dev/null 2>&1 || echo "note: npm install skipped"
fi

export VITE_API_URL="${VITE_API_URL:-https://alpha-trading-server.onrender.com}"

if command -v node >/dev/null 2>&1 && [ -f "$REPO_ROOT/scripts/sync-ios-api-config.mjs" ]; then
  node "$REPO_ROOT/scripts/sync-ios-api-config.mjs" release >/dev/null 2>&1 || echo "note: sync script skipped"
fi

if [ ! -f "$GEN" ]; then
  printf '%s\n' '// Xcode Cloud fallback' \
    'API_BASE_URL = https://alpha-trading-server.onrender.com' \
    'APP_API_KEY =' > "$GEN"
fi

echo "==> Generated.xcconfig ready"
exit 0
