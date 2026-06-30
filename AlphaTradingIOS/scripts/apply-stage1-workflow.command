#!/usr/bin/env bash
cd "$(dirname "$0")/../.."
echo "Xcode Cloud Stage 1 설정 중..."
osascript AlphaTradingIOS/scripts/apply-stage1-workflow.applescript
echo ""
read -r -p "완료. Enter 키를 누르면 종료합니다."
