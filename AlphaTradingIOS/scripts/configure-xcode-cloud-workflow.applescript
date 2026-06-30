#!/usr/bin/env osascript
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

on run
	tell application "Xcode" to activate
	delay 0.5

	if not my workflowEditorOpen() then
		tell application "Xcode" to open projectPath
		delay 2
		my openWorkflowManager()
		delay 1.5
		my openEditWorkflow()
		delay 2
	end if

	my clickSidebarRow("Archive - iOS")
	delay 1
	my pickDeploymentNone()
	delay 0.5

	my saveWorkflow()
	delay 1
	my startBuild()
	return "OK"
end run

on workflowEditorOpen()
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with txtItem in static texts of w
					if name of txtItem is "Archive - iOS" then return true
				end repeat
			end repeat
		end tell
	end tell
	return false
end workflowEditorOpen

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
			keystroke "e" using {command down}
		end tell
	end tell
end openEditWorkflow

on clickSidebarRow(rowLabel)
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			repeat with w in windows
				repeat with txtItem in static texts of w
					if name of txtItem is rowLabel then
						click txtItem
						return
					end if
				end repeat
			end repeat
		end tell
	end tell
end clickSidebarRow

on toggleOffIfOn()
	try
		tell application "System Events"
			tell process "Xcode"
				repeat with w in windows
					try
						repeat with cb in checkboxes of w
							if value of cb is 1 then click cb
						end repeat
					end try
				end repeat
			end tell
		end tell
	end try
end toggleOffIfOn

on pickDeploymentNone()
	tell application "System Events"
		tell process "Xcode"
			repeat with w in windows
				repeat with labelText in {"없음", "None", "No Distribution", "Do Not Distribute"}
					try
						click radio button labelText of w
						return
					end try
				end repeat
			end repeat
		end tell
	end tell
end pickDeploymentNone

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

on startBuild()
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			repeat with w in windows
				repeat with btnName in {"Start Build", "빌드 시작"}
					try
						click button btnName of w
						return
					end try
				end repeat
			end repeat
		end tell
	end tell
end startBuild
