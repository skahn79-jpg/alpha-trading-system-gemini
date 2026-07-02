#!/usr/bin/env osascript
-- 워크플로 편집 창의 static text / radio button 상태 덤프
tell application "System Events"
	tell process "Xcode"
		set frontmost to true
		set out to ""
		repeat with w in windows
			set wn to name of w
			if wn contains "Workflow" or wn contains "워크플로" or wn contains "AlphaTrading" or wn contains "Test" or wn contains "Archive" then
				set out to out & "WINDOW: " & wn & linefeed
				repeat with txtItem in static texts of w
					set n to name of txtItem
					if n is not "" then set out to out & "  TXT: " & n & linefeed
				end repeat
				try
					repeat with rb in radio buttons of w
						set out to out & "  RADIO: " & name of rb & " val=" & (value of rb as text) & linefeed
					end repeat
				end try
			end if
		end repeat
		return out
	end tell
end tell
