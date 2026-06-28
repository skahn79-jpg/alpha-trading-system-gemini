#!/usr/bin/env bash
# App Store Connect API 키 로컬 검증 (Key ID / Issuer ID / .p8)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEBUG_LOG="$ROOT/.cursor/debug-73e95f.log"
ENV_LOCAL="$ROOT/.env.local"

load_env() {
  if [[ -f "$ENV_LOCAL" ]]; then
    # shellcheck disable=SC1090
    while IFS= read -r line; do
      [[ "$line" =~ ^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_KEY_PATH|APPSTORE_KEY_ID|APPSTORE_ISSUER_ID)= ]] || continue
      key="${line%%=*}"
      val="${line#*=}"
      val="${val%$'\r'}"
      val="${val#\"}"; val="${val%\"}"
      val="${val#\'}"; val="${val%\'}"
      printf -v "$key" '%s' "$val"
    done < <(grep -E '^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_KEY_PATH|APPSTORE_KEY_ID|APPSTORE_ISSUER_ID)=' "$ENV_LOCAL" | tail -3)
  fi
}

log_debug() {
  local hypothesis="$1" message="$2" data="$3"
  mkdir -p "$(dirname "$DEBUG_LOG")"
  local ts
  ts="$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || date +%s)"
  printf '%s\n' "{\"sessionId\":\"73e95f\",\"runId\":\"verify\",\"hypothesisId\":\"$hypothesis\",\"location\":\"verify-asc-api-key.sh\",\"message\":\"$message\",\"data\":$data,\"timestamp\":$ts}" >> "$DEBUG_LOG"
}

load_env

KEY_ID="${APPSTORE_KEY_ID:-${ASC_API_KEY_ID:-}}"
ISSUER_ID="${APPSTORE_ISSUER_ID:-${ASC_ISSUER_ID:-}}"
P8="${ASC_API_KEY_PATH:-$HOME/Downloads/AuthKey_${KEY_ID}.p8}"

echo "==> ASC API Key 검증"
echo ""

fail=0

if [[ -z "$KEY_ID" ]]; then
  echo "❌ Key ID 없음 (.env.local: ASC_API_KEY_ID 또는 APPSTORE_KEY_ID)"
  log_debug "H1" "missing_key_id" "{\"ok\":false}"
  fail=1
elif printf '%s' "$KEY_ID" | grep -Eq '^[A-Z0-9]{10}$'; then
  echo "✅ Key ID 형식: 10자 영숫자"
  log_debug "H1" "key_id_format" "{\"ok\":true,\"len\":${#KEY_ID}}"
else
  echo "❌ Key ID 형식 오류 (10자 영숫자 필요)"
  log_debug "H1" "key_id_format" "{\"ok\":false,\"len\":${#KEY_ID}}"
  fail=1
fi

if [[ -z "$ISSUER_ID" ]]; then
  echo "❌ Issuer ID 없음"
  log_debug "H3" "missing_issuer" "{\"ok\":false}"
  fail=1
elif printf '%s' "$ISSUER_ID" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'; then
  echo "✅ Issuer ID 형식: UUID"
  log_debug "H3" "issuer_format" "{\"ok\":true}"
else
  echo "❌ Issuer ID 형식 오류 (UUID 필요)"
  log_debug "H3" "issuer_format" "{\"ok\":false}"
  fail=1
fi

if [[ ! -f "$P8" ]]; then
  echo "❌ .p8 파일 없음: $P8"
  log_debug "H2" "p8_missing" "{\"ok\":false}"
  fail=1
elif head -1 "$P8" | grep -q 'BEGIN PRIVATE KEY'; then
  echo "✅ .p8 파일: 존재, 헤더 정상"
  log_debug "H2" "p8_ok" "{\"ok\":true}"
else
  echo "❌ .p8 파일 헤더 오류"
  log_debug "H2" "p8_bad_header" "{\"ok\":false}"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "로컬 검증 실패 — App Store Connect에서 키 상태를 확인하세요."
  exit 1
fi

echo ""
echo "==> App Store Connect API 호출 테스트 (JWT)..."
if node "$ROOT/AlphaTradingIOS/scripts/asc-jwt-probe.mjs"; then
  echo ""
  echo "==> altool 교차 확인..."
  KEY_DIR="$HOME/private_keys"
  mkdir -p "$KEY_DIR"
  LINK="$KEY_DIR/AuthKey_${KEY_ID}.p8"
  if [[ "$P8" != "$LINK" ]]; then
    cp "$P8" "$LINK"
    chmod 600 "$LINK"
  fi
  ERR_FILE="/tmp/asc_verify_err_$$.txt"
  xcrun altool --list-apps \
    --apiKey "$KEY_ID" \
    --apiIssuer "$ISSUER_ID" \
    --apiKeyPath "$LINK" >/dev/null 2>"$ERR_FILE" || true
  if grep -q 'NOT_AUTHORIZED\|401' "$ERR_FILE" 2>/dev/null; then
    echo "⚠️  altool 은 401이어도 exit 0 — JWT 검증 결과를 신뢰하세요"
  else
    echo "✅ altool 교차 확인 통과"
  fi
  rm -f "$ERR_FILE"
else
  err_hint=""
  if [[ -f "$DEBUG_LOG" ]]; then
    err_hint="$(tail -1 "$DEBUG_LOG" 2>/dev/null || true)"
  fi
  echo ""
  echo "❌ API 인증 실패"
  if echo "$err_hint" | grep -q '"httpStatus":401'; then
    echo ""
    echo "   Apple이 이 Key ID + Issuer ID + .p8 조합을 거부했습니다."
    echo "   Xcode Cloud 'ASC_API_KEY_ID invalid value' 도 같은 원인일 수 있습니다."
    echo ""
    echo "   조치:"
    echo "   1) App Store Connect → 사용자 및 액세스 → 통합 → 키"
    echo "   2) Key ID $KEY_ID 가 활성인지 확인 (삭제됐으면 새 키 생성)"
    echo "   3) 페이지 상단 Issuer ID 가 .env.local 과 일치하는지 확인"
    echo "   4) npm run setup:asc 로 새 키 설정"
    log_debug "H4" "api_call" "{\"ok\":false,\"httpStatus\":401,\"code\":\"NOT_AUTHORIZED\"}"
  fi
  exit 1
fi

echo ""
echo "==> Xcode Cloud Environment (Secret 3개)"
echo "   APPSTORE_KEY_ID        = (Key ID 10자)"
echo "   APPSTORE_ISSUER_ID     = (Issuer UUID)"
echo "   APPSTORE_PRIVATE_KEY   = (.p8 전체)"
echo "   ⚠️  ASC_API_KEY_ID 이름은 Xcode Cloud에서 invalid value 오류"
echo ""
echo "값 출력: bash AlphaTradingIOS/scripts/encode-asc-key-for-cloud.sh"
