#!/usr/bin/env bash
# MaterialDelivery 성공 패턴 — Xcode Cloud 워크플로 안내 (ASC API 키 불필요)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=============================================="
echo " MaterialDelivery 방식 Xcode Cloud (ASC 키 불필요)"
echo "=============================================="
echo ""
echo "MaterialDelivery는 APPSTORE_* / ASC_API_KEY 없이 성공했습니다."
echo "Alpha Trading도 동일한 3단계로 진행하세요."
echo ""
echo "【1차 — Archive 검증】(지금)"
echo "  Scheme: AlphaTrading-CI (Test 없음) — 또는 AlphaTrading + Test action OFF"
echo "  Actions: Archive만 (Test OFF 권장)"
echo "  Archive → 배포 준비: 없음"
echo "  Post-Actions: 모두 OFF"
echo "  Environment Variables: 비워둠"
echo ""
echo "【2차 — TestFlight 업로드】(1차 ✅ 후)"
echo "  Archive → 배포 준비: TestFlight and App Store"
echo "  Post-Actions: TestFlight Internal OFF"
echo ""
echo "【3차 — 내부 테스트】(TestFlight Processing 후)"
echo "  Post-Actions → TestFlight Internal Testing ON"
echo ""
echo "공통 설정:"
echo "  Xcode Version: 16.4 (16F6) — 26.x 사용 금지"
echo "  Test: iPhone 15 + iOS 18.x"
echo ""
echo "ASC API 키(401 오류)는 수동 업로드용 선택 사항입니다."
echo "Xcode Cloud 자동 배포에는 필요 없습니다."
echo ""

open "https://appstoreconnect.apple.com" 2>/dev/null || true
open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj"
sleep 2
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

read -r -p "Enter 키를 누르면 종료합니다..."
