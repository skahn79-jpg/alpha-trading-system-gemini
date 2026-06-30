#!/usr/bin/env osascript
-- Stage 1: Test OFF + AlphaTrading-CI + Archive 배포 준비 없음 + Start Build
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

	-- 1) Test - iOS 비활성화 (사이드바 토글)
	my disableTestAction()
	delay 0.8

	-- 2) General → Scheme AlphaTrading-CI
	my clickSidebar("General")
	delay 0.5
	my pickScheme("AlphaTrading-CI")
	delay 0.5

	-- 3) Archive → 배포 준비 없음
	my clickSidebar("Archive - iOS")
	delay 0.5
	my pickDeploymentNone()
	delay 0.5

	my saveWorkflow()
	delay 1
	my startBuild()
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

on disableTestAction()
	tell application "System Events"
		tell process "Xcode"
			-- Test - iOS 행 선택 후 토글 OFF
			try
				click static text "Test - iOS" of window 1
				delay 0.3
			end try
			try
				set tg to first checkbox of group 1 of window 1 whose value is 1
				click tg
			on error
				try
					-- workflow action enable switch (often right of action name)
					click (first checkbox whose value is 1 of window 1)
				end try
			end try
		end tell
	end tell
end disableTestAction

on clickSidebar(labelText)
	tell application "System Events"
		tell process "Xcode"
			try
				click static text labelText of window 1
			on error
				click static text labelText
			end try
		end tell
	end tell
end clickSidebar

on pickScheme(schemeName)
	tell application "System Events"
		tell process "Xcode"
			repeat with idx from 1 to 4
				try
					tell pop up button idx of window 1
						click
						delay 0.3
						click menu item schemeName of menu 1
						return
					end tell
				end try
			end repeat
		end tell
	end tell
end pickScheme

on pickDeploymentNone()
	tell application "System Events"
		tell process "Xcode"
			repeat with labelText in {"없음", "None", "No Distribution", "Do Not Distribute"}
				try
					click radio button labelText of window 1
					return
				end try
			end repeat
		end tell
	end tell
end pickDeploymentNone

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

on startBuild()
	tell application "System Events"
		tell process "Xcode"
			set frontmost to true
			try
				click button "Start Build" of sheet 1 of window 1
			on error
				try
					click button "빌드 시작" of sheet 1 of window 1
				on error
					try
						click button "Start Build" of window 1
					on error
						click button "빌드 시작" of window 1
					end try
				end try
			end try
		end tell
	end tell
end startBuild
