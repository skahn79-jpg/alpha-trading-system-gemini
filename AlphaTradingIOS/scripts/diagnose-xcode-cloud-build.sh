#!/usr/bin/env bash
# Xcode Cloud 빌드 실패 원인 빠른 진단 (MaterialDelivery diagnose_testflight_blockers.sh 패턴)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$IOS_DIR/.." && pwd)"

section() { echo; echo "=== $1 ==="; }

section "프로젝트"
echo "Scheme: AlphaTrading"
echo "Bundle ID: com.alpha.trading.ios"
echo "CURRENT_PROJECT_VERSION: $(grep CURRENT_PROJECT_VERSION "$IOS_DIR/Config/Release.xcconfig" | awk '{print $3}')"
echo "MARKETING_VERSION: $(grep MARKETING_VERSION "$IOS_DIR/Config/Release.xcconfig" | awk '{print $3}')"

section "ci_post_xcodebuild.sh exit code 정책"
echo "- 모든 경로에서 exit 0 (업로드 실패해도 Xcode Cloud 전체 상태 변경 없음)"
echo "- 로그에서 SUMMARY upload_attempted=1 upload_succeeded=1 이면 TestFlight 업로드 요청 성공"
echo "- ci_post ✅ + 빌드 ❌ → Prepare Build / Post-action / Test - iOS 중 하나 실패"

section "전체 실패 + Archive 1 error (MaterialDelivery Build 25 패턴)"
cat <<'EOF'
가능 원인 (우선순위):
  1. Prepare Build for App Store Connect — Archive 하위 오류 1개로 표시
  2. Post-action TestFlight Internal Testing — Archive ✅ 후 별도 실패
  3. Test - iOS — 시뮬레이터/OS 불일치 (iPhone 16 + iOS 16.4 등)
  4. ci_post는 원인 아님 (항상 exit 0)

조치 (MaterialDelivery 3단계):
  1차: Archive 배포 준비=없음, Post-actions=모두 OFF, Test=ON
  2차: 배포 준비=TestFlight and App Store, Internal Testing=OFF
  3차: Internal Testing=ON (TestFlight Processing 확인 후)
EOF

section "TestFlight 업로드 확인"
cat <<'EOF'
1. App Store Connect → ALPHA TRADING → TestFlight
2. 버전 1.0.x 아래 빌드 번호(23, 24…) Processing / Ready to Test
3. Xcode Cloud Build #N → ci_post_xcodebuild 로그 → SUMMARY upload_succeeded=1
4. Processing 없으면: Artifacts → app-store IPA → Transporter 수동 업로드
EOF

section "워크플로 수동 확인"
echo "bash $IOS_DIR/scripts/fix-xcode-cloud-workflow.command"

section "로컬 테스트 (선택)"
if [[ "${RUN_LOCAL:-0}" == "1" ]]; then
  bash "$IOS_DIR/scripts/run-local-ci-preflight.sh"
else
  echo "로컬 검증: RUN_LOCAL=1 bash $IOS_DIR/scripts/diagnose-xcode-cloud-build.sh"
fi
