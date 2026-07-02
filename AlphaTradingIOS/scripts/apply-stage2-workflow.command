#!/usr/bin/env bash
# Xcode Cloud Stage 2: TestFlight 업로드 설정
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=============================================="
echo " Xcode Cloud Stage 2 — Upload 설정"
echo "=============================================="
echo ""
echo "1) Scheme: AlphaTrading-CI 또는 AlphaTrading"
echo "2) Actions: Archive only"
echo "3) Archive → Deployment Preparation: TestFlight and App Store"
echo "4) Post-Actions: TestFlight Internal Testing OFF"
echo "5) Test: OFF (권장)"
echo "6) Xcode Version: 16.4 (16F6)"
echo "7) 환경 변수: APPSTORE_* / ASC API 키 없음 (워크플로 자체 인증 사용)"
echo ""
echo "App Store Connect와 Xcode에서 워크플로를 열어 설정을 검증하세요."
echo ""
echo "App Store Connect → Xcode Cloud → Default 워크플로 편집"
echo ""
open "$ROOT/AlphaTradingIOS/AlphaTrading.xcodeproj" 2>/dev/null || true
osascript "$ROOT/AlphaTradingIOS/scripts/open-xcode-cloud-workflows.applescript" 2>/dev/null || true

echo ""
read -r -p "설정 완료 후 Enter 키를 누르세요..."
