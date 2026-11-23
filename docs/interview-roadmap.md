# Aural interview roadmap

**Start with the candidate microphone check.** A failed check stops the interview before the first answer. In the payroll preview, the same error message covered both a failed connection and a disconnect. The first change should help a candidate identify the problem and recover on the same invite.

The starting point is the BUG-0018 preview. A recruiter approved five core questions and scoring guides for one AU Payroll Officer requisition. Two fictional applicants received that same core and two private questions each. The roadmap builds on that flow. [Aural #18](https://github.com/Midflight-AI/aural-pilot/pull/18) · [Ramp #3571](https://github.com/Midflight-AI/ramp-remote/pull/3571)

Each row is one change a team can pick up. The surface column shows where the work belongs.

| Order | Surface | Change | Done when |
|---|---|---|---|
| Now · 1 | Aural candidate setup | Show separate microphone, speaker and voice connection results. Give one recovery action for each failure. | In preview, deny microphone access and interrupt the voice connection in separate runs. In both cases the candidate sees the failed step, fixes it and starts on the original invite. |
| Now · 2 | Ramp recruiter setup | Show what each core question tests beside its scoring guide. Label the questions everyone will receive and show where private questions will be added. | A recruiter can open the requisition, edit a question, approve it and identify which answers will count toward the shared score without opening Aural. |
| Now · 3 | Aural operations | Measure time from Start to the first question, speech ending to the next audible reply, and Finish to a report visible in Ramp. Reuse the existing voice events. | A preview run shows the median, slowest 5% threshold (p95), sample count and failures for each interval. The team can identify which step accounts for the longest wait. |
| Next · 4 | Aural candidate session | Make recovery visible when a connection drops or a candidate reopens the invite. Show the last saved answer and where the interview will resume. | Interrupt a fictional applicant after a core answer and again after a private answer. Returning to the invite preserves each saved answer once, in order, under the correct question. |
| Next · 5 | Ramp recruiter results | Put the core score, scoring guide and supporting answer together. Give each private follow-up its own evidence link. | In the two payroll reports, a recruiter can open the exact transcript turn behind each score and private answer in one click. Private answers stay outside the core score. |
| Next · 6 | Aural and Ramp | Reduce the longest measured wait from item 3. Change one step at a time. | Repeat the same preview workload before and after the change. Proposed target: reduce that step's p95 by 20% with no additional failures or missing transcript turns. |
| Later · 7 | Aural candidate experience | Test a complete interview on a physical iPhone and Android phone. Fix the first issue that prevents completion. | On each phone, a tester can grant access, hear a question, answer, recover from an interruption and finish. The recruiter can then open the transcript and play the recording. |

**First ticket:** Improve the microphone-check failure message and retry action. Limit the first PR to the setup screen. Use a fictional invite to demonstrate a successful check, denied permission and a dropped connection. Record the screen and the outcome of each case.

Use the existing [monitoring guide](operations/interview-monitoring.md) for timing definitions and the [mobile verification notes](ramp-mobile-recording-verification.md) for device coverage.
