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
  buffers are bounded. 30-minute capture cutoff. Final manifest limited to 400 MiB.
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

The Vercel finalization route schedules processing with Next.js `after`, so the
candidate receives the saved-upload acknowledgement without waiting for stitching.
`/api/internal/video/process` is authenticated with `CRON_SECRET`; `vercel.json`
schedules it every minute as a recovery sweep. Vercel cron runs in production only;
preview acceptance invokes the same authenticated endpoint explicitly and tests the
immediate finalization trigger. Preview credentials remain branch-scoped.

The Node function has an 800-second limit and a 740-second work deadline. Verified
chunks stream into FFmpeg; only the seekable output occupies scratch disk. Capture
is bounded to 400 MiB and free disk is checked before processing. Packaged Linux
FFmpeg/ffprobe binaries are included explicitly in function tracing. A per-process
resource guard prevents shared scratch-disk contention; database claims cap global
concurrency at two recordings. A heartbeat renews a ten-minute lease; a crashed
processor can be replaced after expiry. Transient failures retry after 60 then 240
seconds, at most three attempts. Corrupt media is terminal. Logs report safe phase
timings, recording IDs and error codes, never media or credentials.

Production release order: apply reviewed migrations, configure production-specific
Supabase credentials and `CRON_SECRET`, deploy the Vercel functions and cron, then
enable the matching Aural and Ramp flags and verify authenticated recruiter playback.
Keep flags off until these gates pass. Monitor failed/exhausted processing rows and
expired leases. The standalone script/Dockerfile remain an operator fallback; no
Azure scheduled resource is required.
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

2026-10-31 Vercel acceptance: the real 100.353-second recording (17 chunks)
processed on its first attempt in 14,898 ms: download/remux 3,898 ms, full decode
validation 6,639 ms, output upload 3,041 ms. End-to-end HTTP time was 17.759 s.
The authenticated session-video API returned ready with no retention expiry.
A separate 46.681-second synthetic partial recording finalized through the deployed
HTTP endpoint and reached partial automatically on attempt one, proving the after
trigger without a manual processor call. These are preview measurements, not an SLA.

Candidate uploads use the invitation token already present in the session URL,
validated server-side against the exact candidate/session/interview binding on
every request. The token is sent only to same-origin video control endpoints;
storage PUTs and reviewer playback do not receive it. Revoked links are denied.
Staff testing retains authenticated organization/project authorization. The existing
interview owner is the storage custodian; invitation access does not grant recruiter
playback or access to another candidate's recording.


## External candidate release update (2026-11-01 NZ)

The earlier internal-only limitations above are historical. External invitation
access uses a secure HttpOnly invitation cookie, server-side session binding for
public tRPC and legacy candidate APIs, and signed 60-second relay initialization
tickets. The Azure outer login gate now allows anonymous transport; the relay
rejects connections without valid application tickets before contacting AI.
Vercel production protection must only be opened after this guard is deployed.
`AURAL_EXTERNAL_CANDIDATES=true` enables the invitation boundary.

Production storage migrations were applied atomically as ledger entry
`20261031203307 video_storage_manual_retention_and_processing`, containing source
migrations 20261031082242, 20261031091602 and 20261031095724. Do not replay or rename
those already-applied preview migrations. Verified private buckets, RLS, denied
browser grants and no retention expiry. Recordings remain until manual deletion.

A 71.228-second external synthetic-device interview survived a seven-second
network interruption, uploaded all 15 chunks, and became ready on processor
attempt one with partial=false. This exercised deployed capture and relay without
staff authentication. Final draining was slow, so upload concurrency is now bounded
at three independent immutable chunks; all in-flight requests settle before retry
or finalization. Real hardware evidence remains the earlier 35.236-second recording
where Josh confirmed both voices audible. These measurements are not an SLA.
