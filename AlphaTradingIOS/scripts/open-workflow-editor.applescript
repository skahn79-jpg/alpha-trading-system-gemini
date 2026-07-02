#!/usr/bin/env osascript
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

on run
	tell application "Xcode"
		activate
		open projectPath
	end tell
	delay 2
	my openWorkflowManager()
	delay 2
	my openEditWorkflow()
	delay 2
	return "OPENED"
end run

on openWorkflowManager()
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			try
				click menu item "Manage Workflows…" of menu "Integrate" of menu bar 1
			on error
				click menu item "워크플로 관리…" of menu "Integrate" of menu bar 1
			end try
		end tell
	end tell
end openWorkflowManager

on openEditWorkflow()
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with b in buttons of w
					set bn to name of b
					if bn is "Edit" or bn contains "Edit" or bn is "편집" then
						click b
						return
					end if
				end repeat
			end repeat
		end tell
	end tell
end openEditWorkflow
