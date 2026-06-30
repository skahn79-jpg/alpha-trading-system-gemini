#!/usr/bin/env osascript
-- Xcode Cloud: 최신 commit으로 빌드 시작
property projectPath : "/Users/aiden.an/Desktop/alpha-trading-system-gemini/AlphaTradingIOS/AlphaTrading.xcodeproj"

tell application "Xcode"
	activate
	open projectPath
end tell
delay 2

tell application "System Events"
	tell process "Xcode"
		set frontmost to true
		try
			click menu item "Start Build" of menu "Integrate" of menu bar 1
		on error
			try
				click menu item "빌드 시작" of menu "Integrate" of menu bar 1
			on error errMsg
				return "FAIL:" & errMsg
			end try
		end try
	end tell
end tell

delay 2
return "OK"
