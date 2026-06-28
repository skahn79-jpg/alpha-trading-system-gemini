#!/usr/bin/env bash
# App Store Connect API 키 대화형 설정 + .env.local 갱신 + 검증
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"
VERIFY="$ROOT/AlphaTradingIOS/scripts/verify-asc-api-key.sh"

echo "=============================================="
echo " App Store Connect API 키 설정"
echo "=============================================="
echo ""
echo "App Store Connect에서 확인:"
echo "  사용자 및 액세스 → 통합 → App Store Connect API"
echo "  - 상단 Issuer ID (UUID)"
echo "  - 키 → Key ID (10자) + .p8 다운로드"
echo ""
open "https://appstoreconnect.apple.com/access/integrations/api" 2>/dev/null || true

read -r -p "Key ID (10자): " KEY_ID
KEY_ID="$(echo -n "$KEY_ID" | tr -d ' \r\n\t')"
read -r -p "Issuer ID (UUID): " ISSUER_ID
ISSUER_ID="$(echo -n "$ISSUER_ID" | tr -d ' \r\n\t')"
DEFAULT_P8="$HOME/Downloads/AuthKey_${KEY_ID}.p8"
read -r -p "p8 경로 [$DEFAULT_P8]: " P8_IN
P8="${P8_IN:-$DEFAULT_P8}"
P8="${P8/#\~/$HOME}"

if [[ ! -f "$P8" ]]; then
  echo "❌ .p8 파일 없음: $P8"
  exit 1
fi

if ! printf '%s' "$KEY_ID" | grep -Eq '^[A-Z0-9]{10}$'; then
  echo "❌ Key ID 형식 오류 (10자 영숫자)"
  exit 1
fi

if ! printf '%s' "$ISSUER_ID" | grep -Eq '^[0-9a-fA-F-]{36}$'; then
  echo "❌ Issuer ID 형식 오류 (UUID)"
  exit 1
fi

mkdir -p "$HOME/private_keys"
cp "$P8" "$HOME/private_keys/AuthKey_${KEY_ID}.p8"
chmod 600 "$HOME/private_keys/AuthKey_${KEY_ID}.p8"

touch "$ENV_LOCAL"
if grep -q '^ASC_API_' "$ENV_LOCAL" 2>/dev/null; then
  sed -i '' '/^ASC_API_KEY_ID=/d;/^ASC_ISSUER_ID=/d;/^ASC_API_KEY_PATH=/d' "$ENV_LOCAL"
fi
{
  echo ""
  echo "# TestFlight / App Store Connect API"
  echo "ASC_API_KEY_ID=$KEY_ID"
  echo "ASC_ISSUER_ID=$ISSUER_ID"
  echo "ASC_API_KEY_PATH=$P8"
} >> "$ENV_LOCAL"

echo ""
echo "✅ .env.local 갱신 완료"
echo ""
echo "==> Apple API 인증 테스트..."
if bash "$VERIFY"; then
  echo ""
  echo "==> Xcode Cloud Secret (이름 그대로 사용)"
  echo "   APPSTORE_KEY_ID        = $KEY_ID"
  echo "   APPSTORE_ISSUER_ID     = $ISSUER_ID"
  echo "   APPSTORE_PRIVATE_KEY   = (.p8 전체)"
  echo ""
  bash "$ROOT/AlphaTradingIOS/scripts/encode-asc-key-for-cloud.sh" | sed -n '/^APPSTORE_/,$p' | head -20
else
  echo ""
  echo "❌ 인증 실패 — Key ID·Issuer ID·.p8 가 같은 키에서 나온 것인지 다시 확인하세요."
  echo "   키가 삭제됐다면 App Store Connect에서 새 키를 생성해야 합니다."
  exit 1
fi
