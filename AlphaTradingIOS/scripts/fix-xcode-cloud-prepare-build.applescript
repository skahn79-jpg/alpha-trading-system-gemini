#!/usr/bin/env osascript
-- Xcode Cloud: Archive 배포 준비 안내 + 워크플로 열기
display dialog "Prepare Build 오류 해결 (MaterialDelivery 방식)

ASC API 키는 필요 없습니다.
MaterialDelivery도 Environment Secret 없이 성공했습니다.

【1차 — 지금】
1. Manage Workflows → Default → Edit
2. Archive - iOS → 배포 준비: 없음
3. Post-Actions: 모두 OFF
4. Environment Variables: 비워둠 (ASC/APPSTORE 키 불필요)
5. 저장 → Start Build

【2차 — Archive ✅ 후】
Archive → 배포 준비: TestFlight and App Store

【3차 — TestFlight Processing 후】
Post-Actions → TestFlight Internal Testing ON" buttons {"워크플로 열기", "닫기"} default button 1

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
