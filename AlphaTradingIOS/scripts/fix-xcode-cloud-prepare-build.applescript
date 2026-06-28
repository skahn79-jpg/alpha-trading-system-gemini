#!/usr/bin/env osascript
-- Xcode Cloud: Archive 배포 준비 안내 + 워크플로 열기
display dialog "Prepare Build 오류 해결 (MaterialDelivery 방식)

1. Manage Workflows → Default → Edit
2. Archive - iOS → 배포 준비: 없음
3. Post-Actions: 모두 OFF
4. Environment → Secret 3개 (encode-asc-key-for-cloud.sh 참고)
5. 저장 → Start Build

Prepare Build 단계가 사라져 빌드 전체가 ✅ 됩니다.
TestFlight 업로드는 ci_post_xcodebuild + ASC API Secret 으로 처리됩니다." buttons {"워크플로 열기", "닫기"} default button 1

if button returned of result is "워크플로 열기" then
	tell application "Xcode" to activate
	delay 0.5
	tell application "System Events"
		tell process "Xcode"
			try
				click menu item "Manage Workflows…" of menu "Integrate" of menu bar 1
			on error
				try
					click menu item "워크플로 관리…" of menu "Integrate" of menu bar 1
				end try
			end try
		end tell
	end tell
end if
