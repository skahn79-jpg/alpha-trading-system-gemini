#!/usr/bin/env bash
# Xcode Cloud Stage 3: Internal Testing 활성화 안내
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=============================================="
echo " Xcode Cloud Stage 3 — Internal Testing ON"
echo "=============================================="
echo ""
echo "1) 빌드가 TestFlight Processing 상태인지 확인"
echo "2) App Store Connect → TestFlight → 해당 빌드 선택"
echo "3) Post-Actions: TestFlight Internal Testing ON"
echo "4) 내부 테스트 그룹에 테스트 빌드 배포"
echo ""
echo "App Store Connect와 Xcode에서 다음을 확인하세요:"
echo "  - Archive → Deployment Preparation: TestFlight and App Store"
echo "  - Post-Actions: TestFlight Internal Testing ON"
echo ""
open "https://appstoreconnect.apple.com" 2>/dev/null || true
open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj" 2>/dev/null || true
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

echo ""
read -r -p "Internal Testing 설정 완료 후 Enter 키를 누르세요..."
