#!/usr/bin/env bash
# App Store Connect IPA → TestFlight 자동 업로드
# 사용법: ./upload-ipa-testflight.sh [path/to/AlphaTrading.ipa]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IPA="${1:-}"
UPLOADED=0

if [[ -z "$IPA" ]]; then
  IPA="$(find "$HOME/Downloads" -maxdepth 4 -name '*.ipa' -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1 || true)"
fi

if [[ -z "$IPA" || ! -f "$IPA" ]]; then
  echo "❌ IPA 파일을 찾을 수 없습니다."
  echo ""
  echo "【다운로드 방법】"
  echo "  App Store Connect → ALPHA TRADING → Xcode Cloud"
  echo "  → 빌드 16 또는 17 → Archive - iOS → 아티팩트"
  echo "  → 'AlphaTrading 1.0.0 app-store' 옆 [다운로드] 클릭"
  echo ""
  echo "  (다운로드 후 파일명이 다를 수 있습니다. 예: AlphaTrading 1.0.0.ipa)"
  echo ""
  echo "【업로드】다운로드한 .ipa 경로로 실행:"
  echo "  bash AlphaTradingIOS/scripts/upload-ipa-testflight.sh ~/Downloads/다운받은파일.ipa"
  echo ""
  open "https://appstoreconnect.apple.com" 2>/dev/null || true
  open -a Transporter 2>/dev/null || true
  exit 1
fi

if [[ -f "$ROOT/.env.local" ]]; then
  # 프로세스 치환(<())은 일부 샌드박스 셸에서 조용히 실패하므로 임시 파일 사용
  ENV_TMP="$(mktemp)"
  grep -E '^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_ISSUER_ID|ASC_API_KEY_PATH|ASC_API_PRIVATE_KEY|APPLE_ID|APPLE_APP_PASSWORD)=' "$ROOT/.env.local" > "$ENV_TMP" 2>/dev/null || true
  # shellcheck disable=SC1090
  set -a
  source "$ENV_TMP"
  set +a
  rm -f "$ENV_TMP"
fi

# .env.local 표준 이름은 ASC_ISSUER_ID (구 ASC_API_ISSUER_ID 호환)
ASC_ISSUER_ID="${ASC_ISSUER_ID:-${ASC_API_ISSUER_ID:-}}"

# Downloads 의 AuthKey_*.p8 자동 감지
# 주의: ASC_API_KEY_ID가 설정돼 있으면 해당 ID와 일치하는 키만 사용 (엉뚱한 키 선택 방지)
if [[ -z "${ASC_API_KEY_PATH:-}" || ! -f "${ASC_API_KEY_PATH:-}" ]]; then
  if [[ -n "${ASC_API_KEY_ID:-}" ]]; then
    AUTO_P8="$(find "$HOME/Downloads" -maxdepth 2 -name "AuthKey_${ASC_API_KEY_ID}.p8" 2>/dev/null | head -1)"
  else
    AUTO_P8="$(find "$HOME/Downloads" -maxdepth 2 -name 'AuthKey_*.p8' 2>/dev/null | head -1)"
  fi
  if [[ -n "$AUTO_P8" && -f "$AUTO_P8" ]]; then
    ASC_API_KEY_PATH="$AUTO_P8"
    if [[ -z "${ASC_API_KEY_ID:-}" ]]; then
      ASC_API_KEY_ID="$(basename "$AUTO_P8" .p8 | sed 's/^AuthKey_//')"
      echo "⚠️  .env.local에 ASC_API_KEY_ID가 없어 Downloads에서 자동 감지했습니다: $ASC_API_KEY_ID"
    fi
    echo "==> API Key 감지: $ASC_API_KEY_PATH (ID: $ASC_API_KEY_ID)"
  fi
fi

echo "==> TestFlight 업로드: $IPA"

# Xcode 26부터 iTMSTransporter가 제거됨 — altool(아직 포함됨) 우선 사용
if [[ -n "${ASC_API_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  # altool은 키 경로 인자가 없고 표준 디렉터리(~/private_keys 등)에서 ID로 찾음
  KEY_DIR="$HOME/private_keys"
  mkdir -p "$KEY_DIR"
  KEY_PATH="$KEY_DIR/AuthKey_${ASC_API_KEY_ID}.p8"
  if [[ ! -f "$KEY_PATH" ]]; then
    if [[ -n "${ASC_API_KEY_PATH:-}" && -f "${ASC_API_KEY_PATH}" ]]; then
      cp "$ASC_API_KEY_PATH" "$KEY_PATH"
      chmod 600 "$KEY_PATH"
    elif [[ -n "${ASC_API_PRIVATE_KEY:-}" ]]; then
      printf '%s\n' "$ASC_API_PRIVATE_KEY" > "$KEY_PATH"
      chmod 600 "$KEY_PATH"
    fi
  fi
  if [[ -f "$KEY_PATH" ]]; then
    xcrun altool --upload-app --type ios \
      -f "$IPA" \
      --apiKey "$ASC_API_KEY_ID" \
      --apiIssuer "$ASC_ISSUER_ID"
    UPLOADED=1
  fi
fi

if [[ "$UPLOADED" -eq 0 && -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
  xcrun altool --upload-app --type ios \
    -f "$IPA" \
    -u "$APPLE_ID" \
    -p "$APPLE_APP_PASSWORD"
  UPLOADED=1
fi

if [[ "$UPLOADED" -eq 0 ]]; then
  if [[ -n "${ASC_API_KEY_ID:-}" && -z "${ASC_ISSUER_ID:-}" ]]; then
    echo "⚠️  API Key는 있으나 ASC_ISSUER_ID 가 없습니다."
    echo "   App Store Connect → 사용자 및 액세스 → 키 → Issuer ID 복사 후:"
    echo "   ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \\"
    echo "   bash AlphaTradingIOS/scripts/upload-ipa-testflight.sh \"$IPA\""
    echo ""
  else
    echo "⚠️  .env.local 에 업로드 자격 증명이 없습니다."
    echo "   ASC_API_KEY_ID / ASC_ISSUER_ID / ASC_API_KEY_PATH (또는 ASC_API_PRIVATE_KEY)"
    echo "   또는 APPLE_ID / APPLE_APP_PASSWORD (앱 전용 비밀번호)"
    echo ""
  fi
  echo "Transporter 앱으로 업로드합니다..."
  open -a Transporter "$IPA" 2>/dev/null || open -a Transporter
  echo "IPA를 Transporter 창에 드래그하세요: $IPA"
  exit 0
fi

echo "✅ 업로드 요청 완료 — App Store Connect → TestFlight 에서 빌드 처리(10~30분)를 확인하세요."
