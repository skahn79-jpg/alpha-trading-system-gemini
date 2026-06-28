#!/usr/bin/env bash
# Xcode Cloud 빌드 아티팩트 → TestFlight 수동 업로드
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=============================================="
echo " TestFlight 수동 업로드 (빌드 16+)"
echo "=============================================="
echo ""
echo "1) App Store Connect → ALPHA TRADING → Xcode Cloud"
echo "2) 빌드 16 → Archive - iOS → 아티팩트"
echo "3) 'AlphaTrading 1.0.0 app-store' 다운로드"
echo "4) 아래 명령 실행:"
echo ""
echo "   bash AlphaTradingIOS/scripts/upload-ipa-testflight.sh ~/Downloads/AlphaTrading.ipa"
echo ""

open "https://appstoreconnect.apple.com" 2>/dev/null || true
open -a Transporter 2>/dev/null || true

read -r -p "IPA 다운로드 후 Enter..."

bash "$ROOT/AlphaTradingIOS/scripts/upload-ipa-testflight.sh" "${1:-}"
