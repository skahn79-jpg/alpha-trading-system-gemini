#!/usr/bin/env osascript
-- Archive - iOS → 배포 준비 없음 → 저장 (빌드 시작 없음)
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

on run
	tell application "Xcode"
		activate
		open projectPath
	end tell
	delay 2

	if not my hasText("Archive - iOS") then
		my openWorkflowManager()
		delay 1.5
		my openEditWorkflow()
		delay 2
	end if

	my clickText("Archive - iOS")
	delay 1.2
	my pickNone()
	delay 0.5
	my saveWorkflow()
	delay 1

	set modLine to my getTextContaining("Last modified")
	if modLine is "" then set modLine to my getTextContaining("마지막으로 수정")
	return "SAVED|" & modLine
end run

on hasText(needle)
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with txtItem in static texts of w
					if name of txtItem is needle then return true
				end repeat
			end repeat
		end tell
	end tell
	return false
end hasText

on getTextContaining(needle)
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with txtItem in static texts of w
					set n to name of txtItem
					if n contains needle then return n
				end repeat
			end repeat
		end tell
	end tell
	return ""
end getTextContaining

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
					if name of b is "Edit" or name of b contains "Edit" or name of b is "편집" then
						click b
						return
					end if
				end repeat
			end repeat
		end tell
	end tell
end openEditWorkflow

on clickText(needle)
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			repeat with w in windows
				repeat with txtItem in static texts of w
					if name of txtItem is needle then
						click txtItem
						return
					end if
				end repeat
			end repeat
		end tell
	end tell
end clickText

on pickNone()
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with labelText in {"없음", "None"}
					try
						click radio button labelText of w
						return
					end try
				end repeat
			end repeat
		end tell
	end tell
end pickNone

on saveWorkflow()
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			repeat with w in windows
				try
					click button "Save" of w
					return
				on error
					try
						click button "저장" of w
						return
					end try
				end try
			end repeat
		end tell
	end tell
end saveWorkflow
