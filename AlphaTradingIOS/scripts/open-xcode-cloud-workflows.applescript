#!/usr/bin/env osascript
-- Xcode Cloud 워크플로 관리 창 열기 (TestFlight Post-Action 추가용)
tell application "Xcode"
	activate
end tell
delay 0.8
tell application "System Events"
	tell process "Xcode"
		try
			click menu item "Manage Workflows…" of menu "Xcode Cloud" of menu item "Xcode Cloud" of menu "Product" of menu bar 1
		on error
			try
				click menu item "워크플로 관리…" of menu "Xcode Cloud" of menu item "Xcode Cloud" of menu "Product" of menu bar 1
			on error errMsg
				display dialog "Xcode 메뉴에서 직접 선택하세요:" & return & return & "Product → Xcode Cloud → Manage Workflows…" buttons {"확인"} default button 1
			end try
		end try
	end tell
end tell
