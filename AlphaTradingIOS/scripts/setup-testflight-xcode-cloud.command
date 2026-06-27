#!/usr/bin/env bash
# TestFlight + Xcode Cloud 워크플로 설정 페이지 열기
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "1) App Store Connect — 워크플로 편집 (Post-Action: TestFlight)"
open "https://appstoreconnect.apple.com/apps"

echo "2) App Store Connect — TestFlight 내부 테스터"
echo "   (앱 선택 후 TestFlight → 내부 테스트)"

echo "3) Xcode — 워크플로 관리"
open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj"
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

echo ""
echo "=== TestFlight Post-Action 체크리스트 ==="
echo "  [ ] Archive → Deployment Preparation: TestFlight and App Store"
echo "  [ ] Post-Actions: TestFlight Internal Testing"
echo "  [ ] TestFlight → 내부 테스트 → 테스터 추가"
echo ""
echo "저장 후 App Store Connect → Xcode Cloud → 빌드 시작"
