#!/usr/bin/env bash
# Xcode Cloud app-store IPA → TestFlight 업로드 (자동 시도 → Transporter 폴백)
set -euo pipefail
cd "$(dirname "$0")/../.."
bash AlphaTradingIOS/scripts/upload-ipa-testflight.sh "${1:-}"
read -r -p "Enter 키를 누르면 종료합니다..."
