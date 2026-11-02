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

## Managed production alerts

`deploy/monitoring.azure.json` provisions Azure Monitor availability checks in Sydney, Singapore and Hong Kong, backed by a Sydney Log Analytics workspace. Each checks every five minutes; the stateful alert requires two failing locations, retries transient failures and automatically sends recovery notifications. The recipient is a deployment parameter. This avoids copying Ramp's mail-provider credential and works independently of the Vercel cron. Logs have 30-day retention; interview videos are unaffected and remain until manual deletion.

The interview-health check uses a separate read-only `AURAL_HEALTH_PROBE_SECRET`, supplied to both Vercel production and the Azure template's secure parameter. It cannot ingest telemetry, process videos or authenticate an interview. The endpoint returns 503 for findings or database failure, 200 for a healthy/quiet window, and 401 without either the probe or cron credential. Never commit the parameter file or probe secret. Azure readers of web-test configuration can see request headers, so this credential deliberately grants only aggregate health reads.

The relay `/healthz` check proves the process and ingress respond; it does not prove model responses. Real interview latency and provider errors come from the authenticated observations endpoint. Set `AURAL_OBSERVABILITY_URL=https://interviews.rampremote.com/api/internal/observations` on the production relay. Quiet traffic is not a synthetic model-success check.

Deploy the template disabled first, verify the web endpoints and recipient using Azure's test-notification action, then enable both checks and alerts. Verify a synthetic failure and recovery without changing candidate records or video retention. Rollback relay traffic to the previous healthy revision if spoken-session tests fail; preserve existing connections until drained.


## Twenty-interview capacity check — 2 November 2026 (NZ)

Production voice remains on `aural-relay--release-e491e9d`, image digest `sha256:96ef695c094d53a8f6056789e625ea719408db2928bd2d8211bf1ec5cbffe31d`, in East US 2. Six was the previous test size, not an enforced admission limit.

The existing `aural-pilot-voice` GlobalStandard deployment was allocated only 5 quota units: 15 requests/minute and 50,000 tokens/minute. Increased it to 30 of the subscription's 40 available units: Azure confirms 90 requests/minute and 300,000 tokens/minute. Model/version and consumption tier are unchanged. This is quota allocation, not provisioned throughput or a latency guarantee.

- Real production invitation authentication; 20 overlapping WebSocket clients, four synthetic spoken turns each. All 20 passed, 80/80 responses, zero errors/retries, zero response audio arriving before the test answer finished. Connections became ready within 1.733s; sessions ran 107.752–122.920s. Speech end to first received audio: nearest-rank p50 2.662s, p95 3.088s, worst 3.682s. This excludes browser playback buffering and is not a human microphone/device test.
- The initial unpaced stress run passed 19/20, with five retry sends and one timeout. Its client spoke after provider generation finished without waiting for queued audio playback. The corrected harness accounts for 24kHz mono PCM playback duration and waits for the audio queue before speaking. Do not cite the initial run as a clean pass, or treat the corrected normal-conversation test as exhaustive interruption testing.
- Azure scaled the production revision from one to two replicas during the burst, with zero restarts. Observed load-window maximum CPU was 0.171 cores and working set 280 MiB, below each replica's 0.5 CPU / 1 GiB allocation. Minute-granularity metrics can miss short spikes. Existing scale bounds remain 1–3; default HTTP scaling is active when explicit rules are absent. New replicas handle new connections; existing WebSockets do not move between replicas.
- Twenty separate synthetic 46.681-second recordings were uploaded and finalized together. All became ready on the first worker attempt, 1.507–7.936s from finalization request to observed readiness. Duplicate acknowledgements and finalization calls were accepted safely; every saved object supported HTTP 206 range playback. The production Ramp integration API returned HTTP 200 for all twenty. This short, low-bitrate fixture is not proof of the same processing time for long/high-bitrate interviews.
- Targeted regression test now checks twenty isolated clients, cleanup after disconnect during provider setup, a silent-provider warning, and twenty simultaneous recovered clients with no leaked upstream connections.
- Recordings have `expires_at = null` and remain until manually deleted. Synthetic candidates are labelled separately; do not delete real recordings or silently alter retention during load-test cleanup.

Run `scripts/benchmark-voice-relay.mjs <known-relay-wss-url> 20 <private-output-path>` with `VOICE_BENCH_CANDIDATES_FILE` containing isolated synthetic invitations and `VOICE_BENCH_PCM_FILE` containing synthetic 16kHz mono PCM16 audio. `VOICE_BENCH_TURNS=4` enables sustained conversation testing (bounded 1–6 turns). The default remains six clients and one turn; the hard maximum is twenty. Output excludes invitation tokens, transcript content and audio. Keep fixture credentials outside Git. Results include per-turn timing, event types and observed peak connections; a failed setup remains a failed result rather than aborting the report.

This establishes tested capacity of twenty simultaneous synthetic conversations and twenty simultaneous short-video completions. It does not establish unlimited capacity, long-duration soak reliability or maximum replica performance. Before increasing rollout concurrency beyond twenty, repeat the test at the proposed load and include model quota, response latency, reconnects, longer media and the worker queue.
