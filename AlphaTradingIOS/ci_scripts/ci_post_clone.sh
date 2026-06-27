#!/bin/sh
# Xcode Cloud: 저장소 클론 직후 — API 설정 동기화
set -eu

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_ROOT"

echo "==> Xcode Cloud post-clone: sync iOS API config"

if command -v npm >/dev/null 2>&1; then
  npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
fi

if command -v node >/dev/null 2>&1; then
  # Xcode Cloud 환경 변수 (워크플로에서 설정 가능)
  export VITE_API_URL="${VITE_API_URL:-https://alpha-trading-server.onrender.com}"
  export VITE_APP_API_KEY="${VITE_APP_API_KEY:-${APP_API_KEY:-}}"
  node scripts/sync-ios-api-config.mjs release
else
  echo "warning: node not found, using Release.xcconfig defaults"
fi

echo "==> post-clone done"
