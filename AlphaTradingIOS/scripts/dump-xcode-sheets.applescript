#!/usr/bin/env osascript
tell application "System Events"
	tell process "Xcode"
		set frontmost to true
		set out to ""
		repeat with w in windows
			set out to out & "W:" & (name of w) & linefeed
			try
				repeat with s in sheets of w
					set out to out & " SHEET:" & (name of s) & linefeed
					repeat with b in buttons of s
						set out to out & "  BTN:" & (name of b) & linefeed
					end repeat
					repeat with t in static texts of s
						set n to name of t
						if n is not "" then set out to out & "  TXT:" & n & linefeed
					end repeat
				end repeat
			end try
		end repeat
		return out
	end tell
end tell
