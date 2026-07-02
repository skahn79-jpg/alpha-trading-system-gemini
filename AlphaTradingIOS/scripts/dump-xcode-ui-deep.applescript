#!/usr/bin/env osascript
tell application "System Events"
	tell process "Xcode"
		set frontmost to true
		set out to ""
		repeat with w in windows
			set out to out & "=== WINDOW: " & (name of w) & " ===" & linefeed
			try
				repeat with grp in groups of w
					set out to out & " GROUP: " & (description of grp) & linefeed
				end repeat
			end try
			try
				repeat with sb in scroll areas of w
					set out to out & " SCROLL: " & (description of sb) & linefeed
					repeat with rw in rows of sb
						set out to out & "  ROW: " & (value of rw as text) & linefeed
					end repeat
				end repeat
			end try
			try
				repeat with ol in outlines of w
					set out to out & " OUTLINE" & linefeed
					repeat with rw in rows of ol
						try
							set out to out & "  OUTROW: " & (value of rw as text) & linefeed
						end try
					end repeat
				end repeat
			end try
			repeat with txtItem in static texts of w
				set n to name of txtItem
				if n is not "" and length of n < 120 then
					set out to out & " TXT: " & n & linefeed
				end if
			end repeat
			try
				repeat with rb in radio buttons of w
					set out to out & " RADIO: " & (name of rb) & " val=" & (value of rb as text) & linefeed
				end repeat
			end try
		end repeat
		return out
	end tell
end tell
