#!/usr/bin/env osascript
tell application "System Events"
	tell process "Xcode"
		set frontmost to true
		set out to ""
		repeat with m in menus of menu bar 1
			set out to out & "MENU: " & (name of m) & linefeed
			try
				repeat with mi in menu items of m
					set out to out & "  - " & (name of mi) & linefeed
				end repeat
			end try
		end repeat
		return out
	end tell
end tell
