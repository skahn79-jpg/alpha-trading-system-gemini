#!/usr/bin/env bash
# App Store Connect IPA → TestFlight 자동 업로드
# 사용법: ./upload-ipa-testflight.sh [path/to/AlphaTrading.ipa]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IPA="${1:-}"
UPLOADED=0

if [[ -z "$IPA" ]]; then
  IPA="$(find "$HOME/Downloads" -maxdepth 2 -name '*.ipa' -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1 || true)"
fi

if [[ -z "$IPA" || ! -f "$IPA" ]]; then
  echo "❌ IPA 파일을 찾을 수 없습니다."
  echo ""
  echo "1) App Store Connect → Xcode Cloud → 빌드 → Archive - iOS → 아티팩트"
  echo "   → 'AlphaTrading 1.0.0 app-store' 다운로드"
  echo "2) 다시 실행:"
  echo "   bash AlphaTradingIOS/scripts/upload-ipa-testflight.sh ~/Downloads/AlphaTrading.ipa"
  exit 1
fi

if [[ -f "$ROOT/.env.local" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^(ASC_API_KEY_ID|ASC_API_ISSUER_ID|ASC_API_KEY_PATH|ASC_API_PRIVATE_KEY|APPLE_ID|APPLE_APP_PASSWORD)=' "$ROOT/.env.local" 2>/dev/null || true)
  set +a
fi

echo "==> TestFlight 업로드: $IPA"

if [[ -n "${ASC_API_KEY_ID:-}" && -n "${ASC_API_ISSUER_ID:-}" ]]; then
  KEY_DIR="$HOME/private_keys"
  mkdir -p "$KEY_DIR"
  if [[ -n "${ASC_API_KEY_PATH:-}" && -f "${ASC_API_KEY_PATH}" ]]; then
    KEY_PATH="$ASC_API_KEY_PATH"
  elif [[ -n "${ASC_API_PRIVATE_KEY:-}" ]]; then
    KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
    printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$KEY_PATH"
    chmod 600 "$KEY_PATH"
  fi
  if [[ -n "${KEY_PATH:-}" && -f "$KEY_PATH" ]]; then
    xcrun iTMSTransporter -m upload \
      -assetFile "$IPA" \
      -apiKey "$ASC_API_KEY_ID" \
      -apiIssuer "$ASC_API_ISSUER_ID" \
      -v informational
    UPLOADED=1
  fi
fi

if [[ "$UPLOADED" -eq 0 && -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  xcrun iTMSTransporter -m upload \
    -assetFile "$IPA" \
    -u "$APPLE_ID" \
    -p "$APPLE_APP_PASSWORD" \
    -v informational
  UPLOADED=1
fi

if [[ "$UPLOADED" -eq 0 ]]; then
  echo "⚠️  .env.local 에 업로드 자격 증명이 없습니다."
  echo "   ASC_API_KEY_ID / ASC_API_ISSUER_ID / ASC_API_KEY_PATH (또는 ASC_API_PRIVATE_KEY)"
  echo "   또는 APPLE_ID / APPLE_APP_PASSWORD (앱 전용 비밀번호)"
  echo ""
  echo "Transporter 앱으로 업로드합니다..."
  open -a Transporter "$IPA" 2>/dev/null || open -a Transporter
  echo "IPA를 Transporter 창에 드래그하세요: $IPA"
  exit 0
fi

echo "✅ 업로드 요청 완료 — App Store Connect → TestFlight 에서 빌드 처리(10~30분)를 확인하세요."
