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

Vercel preview protection is separate. No new destination has transport approval.
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
Aural knbbkrfatygusjqjcjcy has baseline 20261031013734 and storage 20261031013913.
Production and the shared preview database are out of scope.

## Verification boundary

Focused local signature/rotation/schema/stream-size and delivery retry/egress
policy tests pass. Migration replay, full type/lint/test checks belong to remote
CI. Live transport, outage/restart, inbox API timeout, missed-event repair,
Sentry failure/recovery and role-based preview readback are not yet proven.
Video-ready/deletion acceptance is blocked on the separate video lifecycle and
must not be represented as implemented by this core webhook checkpoint.
