#!/bin/sh
# Xcode Cloud: xcodebuild 직전 — API 설정 보장
set -eu
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
GEN="$REPO_ROOT/AlphaTradingIOS/Config/Generated.xcconfig"
mkdir -p "$(dirname "$GEN")"
if [ ! -f "$GEN" ]; then
  cat > "$GEN" <<EOF
// Xcode Cloud pre-build fallback
API_BASE_URL = https://alpha-trading-server.onrender.com
APP_API_KEY =
EOF
fi
