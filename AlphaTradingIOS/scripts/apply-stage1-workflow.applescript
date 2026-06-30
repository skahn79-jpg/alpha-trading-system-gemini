#!/usr/bin/env osascript
-- Stage 1: AlphaTrading-CI + Archive 배포 준비 없음 + Test OFF (MaterialDelivery Build 27)
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

on run
	tell application "Xcode"
		activate
		open projectPath
	end tell
	delay 2.5

	my openWorkflowManager()
	delay 1.5
	my openEditWorkflow()
	delay 2

	-- General: Scheme → AlphaTrading-CI
	my clickText("General")
	delay 0.5
	my pickScheme("AlphaTrading-CI")
	delay 0.5

	-- Test OFF
	my clickText("Test - iOS")
	delay 0.5
	my tryDisableCheckbox()

	-- Archive: 배포 준비 없음
	my clickText("Archive - iOS")
	delay 0.5
	my clickText("Archive")
	delay 0.8
	my pickPopup({"없음", "None", "No Distribution", "Do Not Distribute"})

	-- Post-Actions OFF
	my clickText("Post-Actions")
	delay 0.3
	my clickText("Post-actions")
	delay 0.2
	my tryDisableCheckbox()

	my saveWorkflow()
	delay 0.5
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
			delay 0.5
			try
				click (first button whose description contains "Edit") of sheet 1 of window 1
			on error
				try
					click button "Edit" of sheet 1 of window 1
				on error
					keystroke "e" using {command down}
				end try
			end try
		end tell
	end tell
end openEditWorkflow

on pickScheme(schemeName)
	tell application "System Events"
		tell process "Xcode"
			try
				click pop up button 1 of window 1
				delay 0.3
				click menu item schemeName of menu 1
			on error
				try
					click pop up button 2 of window 1
					delay 0.3
					click menu item schemeName of menu 1
				end try
			end try
		end tell
	end tell
end pickScheme

on configureArchive()
	my clickText("Archive - iOS")
	my clickText("Archive")
	delay 0.8
	my pickPopup({"없음", "None", "No Distribution", "Do Not Distribute"})
end configureArchive

on tryDisableCheckbox()
	tell application "System Events"
		tell process "Xcode"
			try
				set cb to first checkbox whose value is 1 of window 1
				click cb
			end try
		end tell
	end tell
end tryDisableCheckbox

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
