#!/bin/sh
# Xcode Cloud: 클론 직후 API 설정 (실행 권한 필수: chmod +x)
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
GEN="$REPO_ROOT/AlphaTradingIOS/Config/Generated.xcconfig"
mkdir -p "$(dirname "$GEN")"
printf '%s\n' \
  '// Xcode Cloud — production defaults' \
  'API_BASE_URL = https://alpha-trading-server.onrender.com' \
  'APP_API_KEY =' > "$GEN"
exit 0
