#!/usr/bin/env osascript
-- Xcode Cloud 워크플로 관리 (Integrate 메뉴 — Xcode 16+)
tell application "Xcode"
	activate
end tell
delay 0.8
tell application "System Events"
	tell process "Xcode"
		try
			click menu item "Manage Workflows…" of menu "Integrate" of menu bar 1
		on error
			try
				click menu item "워크플로 관리…" of menu "Integrate" of menu bar 1
			on error errMsg
				display dialog "Xcode 메뉴:" & return & return & "Integrate → Manage Workflows…" buttons {"확인"} default button 1
			end try
		end try
	end tell
end tell
