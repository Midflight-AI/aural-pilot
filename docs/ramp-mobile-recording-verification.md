# Mobile recording verification — merge gate

PR #5 must remain unmerged until recording is verified on real target phones.
Responsive desktop-browser screenshots and synthetic CI recording tests do not
satisfy this gate.

## Current evidence

- Candidate/login layouts inspected at 390px in desktop Chrome; no horizontal overflow.
- Webcam tile clears the mobile control bar; labelled preview uses no camera.
- Existing automated tests cover synthetic recording/mixing, denied camera,
  connection failure, upload failure/retry and encoded microphone/interviewer audio.
- No physical iPhone or Android is connected to this workspace. Xcode device and
  simulator utilities and Android adb are unavailable. Real-device results are pending.
- The preview now drives the same voice-status markup and waveform as the live
  interview with explicitly labelled simulated input. It never connects a relay,
  opens the microphone or records video.

## Browser prerequisite

The current recorder requires `video/webm;codecs=vp8,opus`, IndexedDB and
`getUserMedia`. Safari added WebM VP8/Opus MediaRecorder support in Safari 18.4:
https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
This is a prerequisite, not proof of recording, upload or playback on a device.
Older Safari is not covered by the current recording format. A webcam-recording
interview is distinct from legacy camera snapshots and screen-sharing checks;
record which checks the invitation actually requires.

## Required real-device evidence

Record phone model, OS version, browser/version, exact deployment SHA, test
invitation/session and recording IDs in a private test record (never commit
invitation tokens, credentials or candidate media).

| Case | Required result | iPhone/Safari | Android/Chrome |
| --- | --- | --- | --- |
| Normal | Consent and device checks; record 30–60 seconds with both candidate and AI speaking; complete; authorized saved playback has correctly oriented video and both voices | Pending | Pending |
| Permission denied | Deny camera; clear actionable state; no false recording indicator; retry or continue without video according to configured policy | Pending | Pending |
| Interrupted upload | Brief network interruption; upload resumes or recovery remains visible; reload resumes pending chunks without duplicate recording or false completion | Pending | Pending |
| Background/lock | Record the observed behavior; interruptions must not silently claim complete coverage or discard recoverable chunks | Pending | Pending |
| Mobile layout | Portrait/landscape, keyboard, controls and self-view do not overlap; consent and stop/end remain reachable | Pending | Pending |

Verify persisted recording status and playback in Ramp after processing, not just
an on-device preview. Preserve videos until manually deleted. Keep the PR open
if any required case is unverified or fails. Do not broaden codec or capture
behavior merely to turn a compatibility check green without a reviewed fix.
