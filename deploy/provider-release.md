# Provider release, 2 November 2026

Production database: `knbbkrfatygusjqjcjcy`. Isolated feature preview:
`fjagcdzwvwfdufefpglm`. Never point fixture SQL at production.

The production baseline, storage, video and observability migrations have
historical consolidated ledger versions that differ from the source filenames.
Do not run an unqualified migration push from this checkout or repair those
entries. Preserve the original source and both environments' histories.

For this release, use the standard Supabase CLI with a temporary deployment
directory linked explicitly to production. Populate its migration directory with
the exact statements, versions and names read from the production ledger, then
add only the reviewed, absent provider migration files from the pinned commit.
Inspect `supabase db push --linked --include-all --dry-run`: it must list only
those new files. Apply with the same CLI, which owns ledger updates, and verify
the resulting versions and function/table presence with read-only queries.
Never insert ledger entries manually or use `migration repair --status reverted`.

Verified production migrations:

- `20261031081728_webhook_outbox.sql`
- `20261101042905_webhook_delivery_controls.sql`
- `20261031092022_invite_lifecycle.sql`

The webhook and invitation PRs passed their full CI and preview builds before
merge. `tests/sql/provider-release.sql` replays the provider schema and checks
webhook recovery, invitation idempotency, token rotation, expiry, cancellation,
and browser-role denial in disposable CI PostgreSQL.

Deployment and activation are separate. Webhook subscriptions default disabled;
production invitation controls require `AURAL_INVITE_LIFECYCLE_ENABLED=true`.
Ramp's automatic introductions retain their preview-only gate and recipient
allowlist. Do not copy preview database credentials or webhook destinations to
production. Relay changes require a remotely built image and an authenticated
production rollout in addition to the Vercel web deployment.
