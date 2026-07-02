#!/usr/bin/env bash
# .env.local 의 ASC API 키 → GitHub Actions Secrets 등록용 파일 생성
# (Distribution .p12 는 prepare-github-ios-secrets.sh 로 별도 준비)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"
OUT="$ROOT/.github-secrets-export"
VERIFY="$ROOT/AlphaTradingIOS/scripts/verify-asc-api-key.sh"

if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "❌ .env.local 없음 — npm run setup:asc 로 먼저 설정하세요."
  exit 1
fi

# shellcheck disable=SC1090
while IFS= read -r line; do
  [[ "$line" =~ ^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_KEY_PATH)= ]] || continue
  key="${line%%=*}"
  val="${line#*=}"
  val="${val%$'\r'}"
  val="${val#\"}"; val="${val%\"}"
  val="${val#\'}"; val="${val%\'}"
  printf -v "$key" '%s' "$val"
done < <(grep -E '^(ASC_API_KEY_ID|ASC_ISSUER_ID|ASC_API_KEY_PATH)=' "$ENV_LOCAL" | tail -3)

KEY_ID="${ASC_API_KEY_ID:-}"
ISSUER_ID="${ASC_ISSUER_ID:-}"
P8="${ASC_API_KEY_PATH:-$HOME/Downloads/AuthKey_${KEY_ID}.p8}"
P8="${P8/#\~/$HOME}"

if [[ -z "$KEY_ID" || -z "$ISSUER_ID" ]]; then
  echo "❌ .env.local 에 ASC_API_KEY_ID / ASC_ISSUER_ID 필요"
  echo "   npm run setup:asc"
  exit 1
fi

if [[ ! -f "$P8" ]]; then
  echo "❌ .p8 없음: $P8"
  exit 1
fi

echo "==> ASC API 키 검증..."
if ! bash "$VERIFY"; then
  echo ""
  echo "❌ 검증 실패 — GitHub Secret 등록 전에 npm run setup:asc 로 올바른 Issuer ID 를 설정하세요."
  exit 1
fi

mkdir -p "$OUT"
echo "$KEY_ID" > "$OUT/ASC_API_KEY_ID.txt"
echo "$ISSUER_ID" > "$OUT/ASC_ISSUER_ID.txt"
cp "$P8" "$OUT/ASC_API_PRIVATE_KEY.p8"
chmod 600 "$OUT/ASC_API_PRIVATE_KEY.p8"

cat > "$OUT/README-ASC.txt" <<EOF
GitHub → Settings → Secrets and variables → Actions → New repository secret

| Secret 이름 | 파일 |
|-------------|------|
| ASC_API_KEY_ID | ASC_API_KEY_ID.txt |
| ASC_ISSUER_ID | ASC_ISSUER_ID.txt |
| ASC_API_PRIVATE_KEY | ASC_API_PRIVATE_KEY.p8 (전체 내용) |

Distribution 인증서 3개는 별도:
  bash scripts/prepare-github-ios-secrets.sh

등록 후 이 폴더 삭제 (git commit 금지)
EOF

if gh auth status >/dev/null 2>&1; then
  echo ""
  echo "==> gh CLI 로 ASC Secrets 자동 등록..."
  gh secret set ASC_API_KEY_ID --body-file "$OUT/ASC_API_KEY_ID.txt"
  gh secret set ASC_ISSUER_ID --body-file "$OUT/ASC_ISSUER_ID.txt"
  gh secret set ASC_API_PRIVATE_KEY --body-file "$OUT/ASC_API_PRIVATE_KEY.p8"
  echo "✅ GitHub Secrets (ASC 3개) 등록 완료"
else
  echo ""
  echo "⚠️  gh 미로그인 — $OUT/README-ASC.txt 를 참고해 수동 등록하세요."
  echo "   자동 등록: gh auth login 후 이 스크립트 재실행"
fi

echo ""
echo "✅ ASC Secret 파일 준비: $OUT"
