# Recording reliability audit — 2026-11-01

Scope: webcam capture through private Ramp playback, including recovery, processing
leases, resource limits, access renewal and retention. Release is authorized after
verification. This audit does not promise the absence of all bugs.

## Confirmed fixes

1. Aggregate storage budget was only enforced at finalization. A caller could
   reserve up to 400 × 20 MiB before reaching the 400 MiB manifest limit. The
   reservation RPC now checks total reserved bytes under the recording row lock,
   before an upload grant is created. Identical retries/acknowledgements do not
   count bytes twice. Redundant recording/chunk updates are avoided.
2. A setup network failure can leave a durable, empty reservation. Automatic
   recovery previously sealed that empty manifest, then failed validation forever.
   Empty unsealed reservations now retain their ID and remain available to setup;
   recovery reports idle rather than claiming a nonexistent video was uploaded.
3. FFmpeg/ffprobe nonzero decoder exits were classified as generic transient
   failures. Invalid media now stops automatic retries; timeout, cancellation and
   disk exhaustion remain retryable. Operator retry and all retained objects remain.

## Existing safeguards checked

- Immutable sequence/hash upload paths; checksum and size verified before local
  acknowledgement. Ambiguous upload/acknowledgement retries preserve the same bytes.
- Uploads run during recording; at most three in flight, with a 60-second/20 MiB
  backlog limit and a 400 MiB/30-minute recording limit.
- Finalization is idempotent and checks every acknowledged chunk. It never publishes
  ready before processing. Partial capture remains partial.
- Worker leases, heartbeats, global concurrency of two, stale-token fencing and
  three-attempt backoff; immediate dispatch plus a minute recovery sweep.
- Seekable remux without re-encoding, bounded scratch disk, both audio/video tracks
  required and a complete decode validation before publication.
- Private storage, scoped candidate uploads, recruiter authorization and renewable
  five-minute playback grants. Preview cannot inherit production databases.
- No automatic deletion or age-based playback cutoff. Source and output copies
  remain until manual deletion; retaining both roughly doubles storage versus the
  playback object alone, intentionally preserving recoverability.

## Evidence

Production read-only baseline: one ready recording, one processing attempt, no
expired leases and no automatic expiry. Eleven source objects total 5,887,344 bytes;
one output object is 5,887,935 bytes. This is too little traffic for a load/capacity
claim. Targeted transport/access/recovery tests pass locally. Database lifecycle,
budget, backoff, crash recovery, stale workers and tombstones run in disposable
PostgreSQL CI. Browser setup-outage and upload-retry cases run in remote functional CI.

Remote CI run 41276292748 passed full lint, type checking, unit tests, browser
functional tests, build and disposable database tests for implementation commit
494b3dd. The configured isolated Vercel preview passed a real missing-chunk recovery:
recording 8bd622d1-cb3e-4d4f-9ea4-4e178b2cd1b4 failed with chunk_missing and a retry
time; after restoring its source chunks, the same recording became ready on attempt
two. Its 82.55-second, 16-chunk video took 38.549 seconds to process: 32.931 seconds
download/remux, 2.374 seconds decode validation, 1.897 seconds output upload. This is
one observed sample, not a latency SLA. Expiry remained null. The test deliberately
advanced only that fixture's scheduled retry time; production backoff was unchanged.

Production release and post-deploy verification are tracked in PR #6.

## Remaining boundaries

IndexedDB is best-effort; clearing browser data or losing the undelivered recorder
tail cannot be repaired server-side. A browser crash requires same-device recovery.
Capture support remains gated by WebM VP8/Opus MediaRecorder support. A sustained
outage over the backlog limit stops capture with partial evidence. Processing capacity
is deliberately bounded, not an unlimited throughput guarantee. Cold playback lookups
still require authentication and a provider request. No retention cleanup was added.
