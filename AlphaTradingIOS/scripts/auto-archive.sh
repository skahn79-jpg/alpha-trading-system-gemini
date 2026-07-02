#!/usr/bin/env bash
# 자동 코드 서명 점검 후 TestFlight 아카이브 빌드 실행
set -euo pipefail

IOS="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$IOS/.." && pwd)"

if [[ -z "${CI_KEYCHAIN_PASSWORD:-}" && -z "${ALPHA_CI_KEYCHAIN_PASSWORD:-}" ]]; then
  echo "⚠️  자동 아카이브를 실행하려면 CI_KEYCHAIN_PASSWORD 또는 ALPHA_CI_KEYCHAIN_PASSWORD를 설정하세요."
  echo "   예: CI_KEYCHAIN_PASSWORD='your_password' bash $0"
  exit 1
fi

export CI_KEYCHAIN_PASSWORD="${CI_KEYCHAIN_PASSWORD:-${ALPHA_CI_KEYCHAIN_PASSWORD:-}}"

echo "==> 1) 코드 서명 키체인 ACL 및 잠금 해제 점검"
bash "$ROOT/AlphaTradingIOS/scripts/fix-codesign-keychain.sh"

echo "==> 2) Archive 빌드 실행"
cd "$ROOT"
npm run archive:ios
