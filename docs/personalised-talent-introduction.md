
## Natural conversation preview

The isolated relay opts into `AURAL_INTERVIEW_STYLE=talent-introduction`. This replaces
(rather than appends to) the generic interviewer prompt. It accepts concise negative
answers and corrections, discourages formulaic praise, and honours per-question
follow-up caps. Only this relay removes the 20-word/15-second transition threshold;
it still requires a committed answer and refuses transitions during active speech.
The default relay policy remains unchanged until a separate release.

Speech restart cancels both finalisation timers. Transcript flush, finalisation and
response creation all guard active speech; obsolete replies are not queued. Numeric
turn-commit/request/deferred observations support timing diagnosis without speech text.
The fake-clock tests execute the actual relay callbacks for the pause/resume race.
