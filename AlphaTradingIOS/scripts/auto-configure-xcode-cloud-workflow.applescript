#!/usr/bin/env osascript
-- Xcode Cloud: Archive 배포 준비 없음 (MaterialDelivery Stage 1 — ASC Secret 없음)
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

on run
	tell application "Xcode"
		activate
		open projectPath
	end tell
	delay 2

	my openWorkflowManager()
	delay 1.5
	my openEditWorkflow()
	delay 2
	my configureArchive()
	delay 0.5
	my saveWorkflow()

	return "OK"
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
			-- 워크플로 목록에서 Default 선택
			repeat 2 times
				key code 125
				delay 0.15
			end repeat
			delay 0.3
			-- 편집: 연필 버튼 또는 메뉴
			try
				click (first button whose description is "Edit") of sheet 1 of window 1
			on error
				try
					keystroke "e" using {command down}
				on error
					key code 36
				end try
			end try
			delay 2
		end tell
	end tell
end openEditWorkflow

on configureArchive()
	tell application "System Events"
		tell process "Xcode"
			my clickText("Archive - iOS")
			my clickText("Archive")
			delay 0.8
			my pickPopup({"없음", "None", "No Distribution", "Do Not Distribute"})
			delay 0.3
			my clickText("Post-Actions")
			my clickText("Post-actions")
			delay 0.2
			try
				click checkbox 1 of window 1
			end try
		end tell
	end tell
end configureArchive

on saveWorkflow()
	tell application "System Events"
		tell process "Xcode"
			try
				click button "Save" of window 1
			on error
				try
					click button "저장" of window 1
				on error
					keystroke "s" using {command down}
				end try
			end try
		end tell
	end tell
end saveWorkflow

on clickText(txt)
	try
		tell application "System Events"
			tell process "Xcode"
				click static text txt of window 1
			end tell
		end tell
	on error
		try
			tell application "System Events"
				tell process "Xcode"
					click static text txt
				end tell
			end tell
		end try
	end try
end clickText

on pickPopup(choices)
	tell application "System Events"
		tell process "Xcode"
			repeat with labelText in choices
				try
					tell pop up button 1 of window 1
						click
						delay 0.3
						click menu item labelText of menu 1
						return
					end tell
				end try
			end repeat
		end tell
	end tell
end pickPopup
