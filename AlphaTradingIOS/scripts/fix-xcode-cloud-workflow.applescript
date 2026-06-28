#!/usr/bin/env osascript
-- Xcode Cloud 워크플로: Test 시뮬레이터 + Environment 자동 수정 시도
on run
	set projectPath to POSIX path of (path to desktop as text) & "alpha-trading-system-gemini:AlphaTradingIOS:AlphaTrading.xcodeproj"
	set projectPath to do shell script "cd " & quoted form of (POSIX path of (path to desktop)) & "alpha-trading-system-gemini/AlphaTradingIOS && pwd)/AlphaTrading.xcodeproj"

	tell application "Xcode"
		activate
		open projectPath
	end tell
	delay 3

	tell application "System Events"
		tell process "Xcode"
			-- Product → Xcode Cloud → Manage Workflows
			try
				click menu item "Manage Workflows…" of menu "Xcode Cloud" of menu item "Xcode Cloud" of menu "Product" of menu bar 1
			on error
				try
					click menu item "워크플로 관리…" of menu "Xcode Cloud" of menu item "Xcode Cloud" of menu "Product" of menu bar 1
				on error errMsg
					return "FAIL: 워크플로 메뉴 열기 실패 — Product → Xcode Cloud → Manage Workflows… 수동 실행"
				end try
			end try
		end tell
	end tell

	delay 2
	return "OK: 워크플로 창이 열렸습니다. Test - iOS → iPhone 15 + iOS 18.x 로 변경 후 저장하세요."
end run
