#!/usr/bin/env bash
# GitHub Actions iOS 서명용 Secrets 준비 도우미 (로컬 Mac에서 실행)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.github-secrets-export"
mkdir -p "$OUT"

echo "=============================================="
echo " GitHub Actions iOS Secrets 준비"
echo " 출력 폴더: $OUT"
echo "=============================================="
echo ""
echo "1) Apple Distribution 인증서(.p12)보내기"
echo "   Keychain Access → 내 인증서 → Apple Distribution"
echo "   우클릭 →보내기 → .p12 저장"
read -r -p "   .p12 파일 경로: " P12_PATH

if [[ ! -f "$P12_PATH" ]]; then
  echo "파일을 찾을 수 없습니다: $P12_PATH"
  exit 1
fi

read -r -s -p "   .p12 비밀번호: " P12_PASS
echo ""

base64 < "$P12_PATH" | tr -d '\n' > "$OUT/IOS_DIST_SIGNING_CERTIFICATE_BASE64.txt"
echo "$P12_PASS" > "$OUT/IOS_DIST_SIGNING_CERTIFICATE_PASSWORD.txt"
openssl rand -base64 32 | tr -d '\n' > "$OUT/IOS_KEYCHAIN_PASSWORD.txt"

echo ""
echo "2) App Store Connect API Key (.p8)"
echo "   App Store Connect → 사용자 및 액세스 → 키 → App Store Connect API"
read -r -p "   Key ID (예: AB12CD34EF): " KEY_ID
read -r -p "   Issuer ID (UUID): " ISSUER_ID
read -r -p "   .p8 파일 경로: " P8_PATH

if [[ ! -f "$P8_PATH" ]]; then
  echo "파일을 찾을 수 없습니다: $P8_PATH"
  exit 1
fi

echo "$KEY_ID" > "$OUT/ASC_API_KEY_ID.txt"
echo "$ISSUER_ID" > "$OUT/ASC_ISSUER_ID.txt"
cp "$P8_PATH" "$OUT/ASC_API_PRIVATE_KEY.p8"

cat > "$OUT/README.txt" <<EOF
GitHub → Settings → Secrets and variables → Actions → New repository secret

아래 파일 내용을 각 Secret 이름으로 등록하세요.
등록 후 이 폴더는 삭제하세요. (.gitignore 에 포함됨)

| Secret 이름 | 파일 |
|-------------|------|
| IOS_DIST_SIGNING_CERTIFICATE_BASE64 | IOS_DIST_SIGNING_CERTIFICATE_BASE64.txt |
| IOS_DIST_SIGNING_CERTIFICATE_PASSWORD | IOS_DIST_SIGNING_CERTIFICATE_PASSWORD.txt |
| IOS_KEYCHAIN_PASSWORD | IOS_KEYCHAIN_PASSWORD.txt |
| ASC_API_KEY_ID | ASC_API_KEY_ID.txt |
| ASC_ISSUER_ID | ASC_ISSUER_ID.txt |
| ASC_API_PRIVATE_KEY | ASC_API_PRIVATE_KEY.p8 (전체 내용 복사) |

(선택)
| APP_API_KEY | Render 와 동일한 API 키 |
| VITE_API_URL | https://alpha-trading-server.onrender.com |
EOF

echo ""
echo "✅ 준비 완료: $OUT"
echo "   README.txt 를 열어 GitHub Secrets 에 등록하세요."
echo "   ⚠️  이 폴더는 절대 git commit 하지 마세요."
