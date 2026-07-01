#!/usr/bin/env bash
# Stage 1: Archive-only + 빌드 번호 bump (ASC Secret 없음 — MaterialDelivery 패턴)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> 1) 로컬 CI preflight"
bash "$ROOT/AlphaTradingIOS/scripts/run-local-ci-preflight.sh"

echo ""
echo "==> 2) Xcode Cloud Stage 1 (Test OFF + AlphaTrading-CI + Archive 없음)"
osascript "$ROOT/AlphaTradingIOS/scripts/apply-stage1-workflow.applescript" || {
  echo "   ⚠️  UI 자동화 일부 실패 — fallback"
  osascript "$ROOT/AlphaTradingIOS/scripts/save-archive-none-only.applescript" 2>/dev/null || true
}

echo ""
echo "==> 3) ASC Secret — 스킵 (MaterialDelivery와 동일, Xcode Cloud 자체 인증 사용)"
echo "   수동 IPA 업로드만: npm run setup:asc"

echo ""
echo "==> 4) 빌드 번호 bump (push는 수동)"
CUR="$(grep '^CURRENT_PROJECT_VERSION' AlphaTradingIOS/Config/Release.xcconfig | awk '{print $3}')"
NEXT=$((CUR + 1))
sed -i '' "s/CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = $NEXT/" AlphaTradingIOS/Config/Release.xcconfig
sed -i '' "s/CURRENT_PROJECT_VERSION = .*/CURRENT_PROJECT_VERSION = $NEXT/" AlphaTradingIOS/Config/Debug.xcconfig
echo "   CFBundleVersion: $CUR → $NEXT"
echo ""
echo "다음: git add/commit/push 후 Xcode Cloud Start Build"
echo "   git add AlphaTradingIOS/Config/*.xcconfig AlphaTradingIOS/ci_scripts/ AlphaTradingIOS/scripts/"
echo "   git commit -m \"Xcode Cloud Stage 1 (MaterialDelivery pattern), build $NEXT\""
echo "   git push origin main"
