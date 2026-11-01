# Interview release monitoring

Video routes and processing remain in Sydney; voice stays in East US 2. No media retention or playback expiry policy changes.

Operational events contain only a session UUID, an allow-listed event kind, durations and byte counts. Candidate events require the invitation bound to that session (or staff access); relay events require the existing shared relay secret. Browser roles cannot read the measurements. Batches are capped at 16, browser queues at 64, and durable storage at 4096 observations per session. Delivery retries preserve event IDs and cannot block an interview. A browser closed while offline can lose telemetry, although media recovery is independent.

`GET /api/internal/health` requires the existing `CRON_SECRET` bearer credential. The minute cron checks a rolling 15-minute window, median/p95, failures, uploads abandoned for 40 minutes, and recordings not ready within two minutes of finalization. No traffic is distinct from successful measured traffic. The voice p95 warning requires five samples and triggers above five seconds; this is an initial operational threshold, not a measured SLA.

- `voice_response`: estimated local speech-activity end to scheduled audible output, including the browser audio buffer. It is a client measurement, not proof the user heard sound. Background/suspended audio contexts do not produce a success sample.
- `voice_model_first_audio`: relay response request to first provider audio; excludes candidate network and playback delay.
- `video_upload`: one chunk's grant, storage transfer and checksum acknowledgement (bytes included). Failed attempts are recorded separately.
- `video_finalize`: candidate Finish through remaining uploads and finalization acceptance.
- `video_ready` (database): finalization acceptance to committed playback, across worker retries. Existing recordings have unknown historical timestamps, not fabricated measurements.
- `video_processing`: successful worker attempt. Detailed download/remux, validation and output-upload timings remain in structured Vercel logs.

Configure the relay's `AURAL_OBSERVABILITY_URL` to the same environment's `/api/internal/observations`. Never send preview session metrics to the production database. The `VOICE_RELAY_AUTH_SECRET` must match the receiver. Telemetry endpoint failures are logged without tokens, transcripts or raw provider responses.

Before release: run remote CI and database access/idempotency tests; verify unauthenticated ingestion/read denial; exercise real concurrent voice sessions and early disconnect, retry, upload recovery, processing and playback. Record exact deployment/image, measured concurrency, outcomes and remaining limits here. Do not infer voice capacity from the video worker benchmark.

The authenticated `/operations` page is restricted to explicit existing staff user IDs in `AURAL_OPERATIONS_USER_IDS`; it fails closed when unset. It shows the same aggregate snapshot without exposing candidate records.

## Verification checkpoint — 1 November 2026

- Isolated migration: `20261101062051`, assigned by Supabase on apply; local filename follows that actual ledger identity. No applied migration was renumbered.
- Private telemetry grants and idempotent retries verified against isolated data. Forced timeout appears in the aggregate health snapshot; rollback left no fake incident.
- CI for `2ae71f2` passed full lint, types, tests, functional browser tests, database lifecycle tests and build. Later changes require their own exact-head CI.
- Zero-traffic Azure revision `aural-relay--obs2ae71f2`, image `sha256:a22b6b632f97ff9cdf29b565af3e84f1ee3746bd3d2df692722048dfbb1a47bc`, passed six simultaneous synthetic spoken interviews with 2.508–2.819s speech-end to first received response audio, zero errors and zero retries. This is a short six-session canary test, not a sustained-load SLA or browser playback measurement. 0.5 CPU / 1 GiB; max replicas 3. Production stayed on `aural-relay--0000002` with 100% traffic.
- A baseline harness originally included four seconds of trailing silence and missed replies arriving during that silence. Those timeout results are invalid as latency measurements. With silence trimmed, the old relay answered five of six turns in 2.501–2.567s; one timed out without browser retry enabled.
- Pending release gates: new preview branch credential approval; verify deployed authenticated ingestion and operator dashboard; configure chosen alert destination; latest-head canary; end-to-end recording/playback and exact production deployment proof. Do not merge or claim rollout-ready while these remain pending.
