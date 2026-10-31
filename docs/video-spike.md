# Webcam capture and recovery spike

Preview only. This branch is not authorized for merge or production deployment.

The internal tester opts into webcam recording before starting an ordinary audio
assessment. Video takes the existing audio recorder's mixed microphone/TTS stream;
it does not request screen capture. Audio, transcript and report remain separate.
Camera loss, recorder failure or the backlog ceiling ends the conversation and
marks the surviving video partial. This spike does not reconnect a new recorder
into the same container.

## Implemented boundary

- One stable UUID and one WebM VP8/Opus recorder container per session.
- Five-second target chunks persisted to IndexedDB before direct private upload.
  Callback times are measured; chunk count is not a duration clock.
- Server-assigned immutable paths include sequence/checksum. Acknowledgement
  downloads and verifies byte length and SHA-256 before deleting local pending data.
- Same-device retry restores the durable manifest and pending chunks. An unsealed
  manifest recovered after reload is always partial. An undelivered recorder tail
  cannot be recovered. Browser storage is best effort, not crash-proof.
- Backlog threshold: 60 seconds or 20 MiB; oversized callback and queued-write
  buffers are bounded. 30-minute capture cutoff. Final manifest limited to 512 MiB.
- Finalization checks all reserved/acknowledged chunks under a database lock and
  rejects conflicting manifests. It sets processing, never ready.
- Scheduled worker claims finalized recordings, verifies hashes, assembles only this container, remuxes
  duration/seek metadata, checks both tracks and decodes before publishing ready
  or partial. Token-fenced completion cannot overwrite a tombstone.
- Ramp checks recruiter permission and its existing attempt/connection mapping.
  Aural checks the API key's project. Playback grants last five minutes and are
  obtained on demand, never stored in Ramp evidence. Pending video polls separately
  while the page is open; no transcript/report worker changes or webhook events.

## Provisioning and operation

Aural's baseline database `knbbkrfatygusjqjcjcy` is now reserved for its intended
production deployment. Preview configuration rejects that database and Ramp production.
Production activation requires an explicit production environment, the matching Aural
production database reference and the feature flag; it is not activated by this PR.

The webhook task owns one shared isolated feature-preview database and baseline
provisioning. Serialize feature schema application with that owner. Required Aural
branch-only configuration on `codex/aural-video-spike`:

- Normal Aural credentials pointing to that isolated database.
- `AURAL_VIDEO_SPIKE_ENABLED=true` and `AURAL_VIDEO_SPIKE_DATABASE_REF=<isolated ref>`.
- `VERCEL_ENV=preview` (Vercel-provided). No production flag.
- Existing protected relay and internal tester controls remain in place.

Ramp needs its existing isolated preview DB, a branch-only AURAL_CONNECTIONS entry
for the Aural video preview, and `AURAL_VIDEO_SPIKE_ENABLED=true`. Never reuse the
old deployment-specific scheduler grant or alter the baseline production settings.

Retention policy: keep source and output objects until explicit manual deletion.
Five-minute playback links expire for access control; authorized users can obtain
fresh links regardless of recording age. There is no automatic purge.

Run `scripts/video-spike-worker.ts <recording UUID>` with the isolated Aural env and
ffmpeg/ffprobe available and `AURAL_VIDEO_ENVIRONMENT=preview`. Pass `--retry`
to requeue a failed sealed asset without recapture. With no recording argument,
the worker drains the durable queue (up to three assets per invocation).

Build `deploy/video-worker.Dockerfile` remotely and run a separate Container Apps
scheduled job every minute, with no ingress, a 20-minute execution timeout and
platform retry limit zero. Database claims cap concurrent work at two recordings.
A heartbeat renews a ten-minute lease; a crashed worker can be replaced after expiry.
Transient processing errors retry after 60 then 240 seconds, at most three attempts.
Corrupt media is terminal. An operator can explicitly requeue a sealed failure.
Use the existing managed identity for ACR pull; database credentials belong in
job secrets, never the image. The preview job must point only at the isolated DB.

Production release order: apply reviewed migrations, deploy the immutable worker
image with production-specific secrets and `AURAL_VIDEO_ENVIRONMENT=production`,
then enable the matching Aural and Ramp flags and verify a real saved recording
through authenticated recruiter playback. Keep flags off until these gates pass.
Watch failed job executions and queue rows with expired leases or exhausted
attempts; logs contain only recording IDs, safe error codes and processing counts.
No worker path deletes source or output objects.
The source bucket accepts immutable 20 MiB objects. Supabase signed upload grants
last two hours (provider API limit), not five minutes; finalization/deletion gates
still deny attachment of stale uploads. Playback grants last five minutes.

## Evidence and limitations

2026-10-31: six targeted transport/isolation cases passed, covering lost upload
acknowledgement, recovery from stored manifest, backlog cutoff, manifest corruption,
local storage failure, oversized callback and production-database refusal.
A Chromium synthetic probe assembled three chunks after forced upload failures,
left zero pending chunks, and produced a 14.969-second VP8/Opus asset at 640x480.
ffmpeg remux succeeded. A second Chromium probe used the actual
`useInterviewRecording` mixing hook: 46.681 seconds, ten chunks, a forced 30-second
upload outage, 19 attempts, zero pending chunks. Spectral inspection found both
generated 440 Hz and 880 Hz sources (about 1645 and 1635 magnitude versus 0.24
at a 600 Hz control); this is not human microphone/AI interview proof.

Not yet established: real webcam/microphone/AI sample in deployed Ramp; 5/15/30-minute
runs; measured drift; all-browser compatibility; camera reconnect; browser crash
recovery; deployed scheduled-worker acceptance; manual deletion workflow;
Sentry delivery; end-to-end authorization tests. Recordings have no age-based playback cutoff or automatic deletion.
Existing expiry timestamps are cleared by the forward retention migration. Reviewer output is WebM, not MP4/Safari proof.
The existing audio recorder still buffers its entire audio file; this spike does
not claim whole-session bounded memory. No video availability/readiness is written
into canonical Ramp evidence yet, and no video event is emitted.

Disposable PostgreSQL CI passed lifecycle/access checks on `cd2806c`: missing or
conflicting chunks, duplicate finalization, stale worker fencing, failed-processing
retry, tombstone protection, RLS and denied browser grants. The Chromium mixer
probe also sought to 30 seconds and resumed playback (readyState 4, no media error).

The feature migration was applied only to shared isolated preview database
`fjagcdzwvwfdufefpglm`, with its exact filename recorded in the migration ledger.
Rollback-only lifecycle/access assertions passed there, and private bucket limits
and denied browser privileges were verified. On explicit approval, branch-specific
Aural and Ramp credentials and the preview-only connection were configured; no
production environment was changed.

Two targeted browser cases passed locally: camera denial prevents voice connection,
and an upload failure retains recovery until audio save completes, with retry then
allowing parent completion. The synthetic microphone fixture explicitly uses the
existing Unmute control. These are mocked browser cases, not deployed interview proof.

Full validation runs remotely. A clean build alone does not establish these gates.

Checklist update: microphone and optional webcam verification share the same card
layout. Explicit recording consent is collected with camera confirmation. Capture
starts only after the voice relay connects. Failed initial connections release
the camera and retain the empty attempt identity for retry, including after reload.
Browser regressions cover denial, recording consent, upload recovery and failed
connection retry. The protected relay also needs a current Microsoft session.
