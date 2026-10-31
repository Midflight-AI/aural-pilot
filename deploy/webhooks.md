# Aural webhook delivery (preview only)

This change depends on the matching evidence canonical-save boundary. It never
creates a Talent, invitation or application, sends mail, generates a report, or
changes a hiring stage. Webhooks schedule the same lease-fenced sync worker used
by polling. The worker fetches current provider state and saves evidence through
the existing invalidation trigger. Provider revisions are transport versions;
local immutable evidence revisions are separate.

## Implemented lifecycle

Aural emits `interview.started`, `interview.completed`, and `report.ready` from
committed session mutations using a transactional outbox. Report failure,
cancellation and all recording events remain quarantined/unimplemented until
there is a durable source lifecycle. In particular, existing audio URL metadata
is not proof of validated playable media. Video is explicitly gated pending the
separate recording/recovery spike. Existing audio/report/transcript reads remain.

## Configuration

Server-only `AURAL_WEBHOOK_ENDPOINTS` is an encrypted deployment environment JSON
array. Each item has `id`, `connectionId`, `projectId`, exact `baseUrl`, and one or
two `keys` with `id`, `secret` (at least 32 bytes), `notBefore`, `expiresAt`.
The base URL must also match the existing trusted AURAL_CONNECTIONS entry. Use
separate preview/production endpoints, subscriptions and keys. Keys overlap only
between explicit validity times. Do not put values in this document or Git.

The route is `/api/integrations/aural/webhooks/<id>`. HMAC-SHA256 covers Unix
seconds, a dot and exact raw request bytes. Headers are Aural-Timestamp,
Aural-Key-Id, Aural-Event-Id, Aural-Signature (lowercase hex). Acceptance is 202
only after inbox commit; identical replay is accepted, changed-body reuse is 409,
persistence failure is 503. Unknown event types are quarantined, unknown major
versions rejected. Unknown envelope fields are rejected to prevent accidentally
retaining identity/content. Inbox retains only identifiers, body hash and state.

Aural producer environment: AURAL_WEBHOOKS_ENABLED=true,
AURAL_WEBHOOK_DESTINATIONS (subscription id, projectId, url, keyId, secret,
expiresAt), AURAL_WEBHOOK_ALLOWED_URLS (exact HTTPS URLs), WEBHOOK_CRON_SECRET.
`GET /api/cron/webhooks` requires its dedicated Bearer secret. Destination DNS
is checked for public IPv4 and pinned for the connection; TLS verifies the
original hostname. No redirects. Configuration is operator-owned, never read
from an event. Three deliveries per tick, 10-second deadline each, fenced leases,
bounded jitter and Retry-After, dead letters after eight failures/configuration
errors. Redrive preserves the immutable event and regenerates delivery headers.

Vercel preview protection is separate. Josh approved connecting the two test apps.
Aural Preview can call Ramp Preview through short-lived Vercel identity tokens;
the existing Ramp Preview to Aural Preview rule remains in place. Set
`vercelTrustedSource: true` on the producer destination and Ramp connection.
Worker secrets and database credentials are scoped to `codex/aural-webhooks`.
Do not reuse the old dpl_7mNEBgoHhqoGTCRfDNK1SDZNVRu3 scheduler authorization,
expand its scope, or extend its 2026-11-07T05:39:26Z expiry. Provision approved
transport for the concrete new destination before enabling delivery.

## Recovery and operator inspection

Ramp's existing Aural cron performs bounded inbox maintenance before ordinary
sync. Pending mapping is retained for seven days and resolves only to an existing
connection/base URL/session/interview tuple. It coalesces required revisions with
`greatest`; a DB guard rejects saves below the required or stored revision.
It never sets an attempt to queued. Processed means the canonical revision was
persisted, distinct from HTTP delivery. Provider lag/timeouts retain pending work.
Two completed attempts per tick are rotated through ordinary polling after 23h,
excluding withdrawn/deleted sources. Matching's selected-source freshness checks
remain active. Local cancellation/withdrawal prevents resurrection.

Inspect `aural_webhook_inbox` using service-role operations: state, accepted_at,
processed_at, next_attempt_at, last_code and attempt_id. Inspect producer
`webhook_deliveries` separately (last_status, last_code, attempts, lease_until,
delivered_at) joined to content-free `webhook_outbox`. These are not exposed to
candidates or browser database roles. Alert on pending age >5 minutes, any dead
letter, sustained signature failure or missing worker check-ins.

Service-role `redrive_aural_event(connection,event)` and
`redrive_webhook_delivery(subscription,event)` replay dead letters only. Correct
configuration/source availability first. Quarantine requires reviewing the new
capability, not blind redrive. Delivered/processed metadata retention target is
30 days; unresolved rows are retained until reviewed. Automated purge is not yet
enabled; it must preserve dedupe for the producer replay window.

## Preview schema provenance

Read-only check on 31 October: isolated Ramp pzajndpjqoogcczztjxg has original
20261031032106/043224/044305. Main has renamed copies 20261031061643/44/45.
Do not run an unqualified db push against this ledger or reapply these bodies.
Verify names and normalized bodies before recording a reconciliation mapping.
The inbox migration 20261031081726 is applied to isolated Ramp pzaj with its
exact filename version and body recorded atomically in the migration ledger.
Matching prerequisites 20261031081117 and 20261031084701 were applied by their
owner; do not reapply them.

Aural feature preview uses fjagcdzwvwfdufefpglm, created without production data.
It has baseline 20261031013734, storage 20261031013913, outbox 20261031081728,
and the separately owned video spike 20261031082242. Original Aural
knbbkrfatygusjqjcjcy is reserved for production and is out of scope.
Only fictional fixtures are used for webhook testing.

## Preview verification — 31 October 2026

Runtime tests used Ramp commit `6bec8f6d5` and Aural commit `0252fab`, both with
successful full GitHub CI and Vercel preview builds. No webhook PR was merged.
Both databases were isolated previews; all records were fictional. Calls used
server API/worker credentials, not a logged-in candidate or admin browser role.

| Case | Observed result |
| --- | --- |
| Signed source event | Aural delivery received 202; Ramp persisted the inbox row. |
| Event before mapping | Retained `MAPPING_PENDING`; mapped existing attempt later reconciled to revision 3 before inbox became processed. |
| Completion before report | Revision 4 remained processing; no false ready result. |
| Delayed report | Summary, transcript and a synthetic one-second WAV's metadata reached ready at revision 5. |
| Source API unavailable | Disabled only the fixture API key; worker failed, kept required revision 5 and canonical revision 4, and scheduled retry. Restoring key recovered to ready with failures reset. |
| Duplicate/reverse order | Original events replayed newest-first returned 202 without extra rows. Same ID with altered body returned 409. |
| Invalid requests | Tampered bytes, expired timestamp and unknown key returned 401; wrong project 403; unknown major version and content-bearing extra field 400. |
| Video capability | Signed recording/video event was quarantined, never acknowledged as canonical evidence. |
| Inbox persistence outage | A bounded trigger rejected only one synthetic event. Receiver returned 503 and stored no inbox row; producer remained pending with retry time. After trigger removal, next invocation delivered the original event (attempt 2) and ordinary sync saved revision 6. |
| Missed event | Disabled fixture subscription for a later report, so no delivery/inbox existed. Advancing the fixture's last-sync age exercised rotating polling, which saved revision 7. |
| Dead letter/redrive | With one-event persistence fault restored, accelerated only its retry counter to 7. Attempt 8 parked it dead with `RETRIES_EXHAUSTED`; after removing fault, redrive preserved event identity and recovered to revision 8/processed. |

Retry due-times and the 24-hour polling age were advanced on synthetic rows;
this was not a multi-day elapsed-time soak test. The targeted local suites also
cover overlapping signing-key validity, raw-body limits, stale leases and
revision ordering. The Ramp database suite passed 25 rollback assertions.

Sentry UI recorded the deliberate source failure as
[AMPED-TALENT-VAULT-FM](https://midflight-ai.sentry.io/issues/157584317/), tagged
with preview deployment, release, safe error code and synthetic attempt ID.
No transcript, report, credential, request URL or user identity appeared in the
inspected failure event. API read access returned 403, so UI was used to inspect
failure evidence. The browser interview page required a separate Ramp login;
admin visual readback and actual audio playback were not verified in this run.

At 09:16 UTC, the synthetic attempt was cancelled with no next sync or lease,
and its Aural subscription disabled. Content-free delivery/inbox records and
fictional evidence remain for inspection. Both temporary fault triggers/functions
were removed; no fixture inbox work remains pending. The setup owner restored
the original preview scheduler at 09:16:50 UTC with its original command and
schedule, and removed the fallback restoration job.

Vercel CLI initially auto-created an automation bypass while calling `curl`.
It was immediately revoked (zero Aural automation bypasses remained). Subsequent
tests used short-lived project identity tokens from the authenticated preview
environment. No public share link was created.

## Remaining release boundaries

This is preview-only. No production webhook settings, schema or release were
applied. The matching release bot has renamed its unapplied production migration
files; this preview keeps the original filenames matching its applied ledger.
Resolve that exact-body mapping and prerequisite order before future admission;
do not blindly merge renamed prerequisites ahead of the existing inbox file.
Video-ready/deletion lifecycle and recording recovery remain owned by the
separate video spike and are not implemented by this core webhook change.
