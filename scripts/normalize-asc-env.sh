#!/usr/bin/env bash
# .env.local ASC 변수 정규화: private_keys 복사 + 경로 갱신
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"

if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "❌ .env.local 없음"
  exit 1
fi

strip_val() {
  local v="$1"
  v="${v%$'\r'}"
  v="${v#\"}"; v="${v%\"}"
  printf '%s' "$v"
}

KEY_ID="$(strip_val "$(grep -E '^ASC_API_KEY_ID=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2-)")"
ISSUER_ID="$(strip_val "$(grep -E '^ASC_ISSUER_ID=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2-)")"
P8_SRC="$(strip_val "$(grep -E '^ASC_API_KEY_PATH=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2-)")"
P8_SRC="${P8_SRC/#\~/$HOME}"

if [[ -z "$KEY_ID" ]]; then
  echo "❌ ASC_API_KEY_ID 없음 — npm run setup:asc"
  exit 1
fi

if [[ -z "$P8_SRC" || ! -f "$P8_SRC" ]]; then
  for candidate in "$HOME/Downloads/AuthKey_${KEY_ID}.p8" "$HOME/private_keys/AuthKey_${KEY_ID}.p8"; do
    if [[ -f "$candidate" ]]; then
      P8_SRC="$candidate"
      break
    fi
  done
fi

if [[ ! -f "$P8_SRC" ]]; then
  echo "❌ .p8 파일 없음 (Key ID: $KEY_ID)"
  exit 1
fi

mkdir -p "$HOME/private_keys"
P8_DEST="$HOME/private_keys/AuthKey_${KEY_ID}.p8"
cp "$P8_SRC" "$P8_DEST"
chmod 600 "$P8_DEST"

grep -q '^ASC_API_' "$ENV_LOCAL" 2>/dev/null && sed -i '' '/^ASC_API_KEY_ID=/d;/^ASC_ISSUER_ID=/d;/^ASC_API_KEY_PATH=/d;/^ASC_API_ISSUER_ID=/d' "$ENV_LOCAL" || true

{
  echo ""
  echo "# TestFlight / App Store Connect API"
  echo "ASC_API_KEY_ID=$KEY_ID"
  if [[ -n "$ISSUER_ID" ]]; then
    echo "ASC_ISSUER_ID=$ISSUER_ID"
  fi
  echo "ASC_API_KEY_PATH=$P8_DEST"
} >> "$ENV_LOCAL"

echo "✅ .env.local ASC 경로 정규화: $P8_DEST"
if [[ -z "$ISSUER_ID" ]]; then
  echo "⚠️  ASC_ISSUER_ID 없음 — npm run setup:asc 로 Issuer ID 입력 필요"
fi
