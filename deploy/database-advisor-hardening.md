# Database advisor hardening — 5 November 2026

Target: Aural Pilot `knbbkrfatygusjqjcjcy`. This change resolves the WARN-level
security and performance advisor findings without exposing new browser access.

Migration `20261105093133_database_advisor_hardening.sql`:

- Pins `public.update_updated_at()` to an empty search path. The trigger still
  assigns `now()` to `NEW."updatedAt"` and remains SECURITY INVOKER.
- Wraps five owner-policy `auth.uid()` expressions in scalar SELECTs so identity
  is evaluated once per query. Both USING and WITH CHECK remain enforced.
- Keeps the existing organization-member SELECT policy and splits the admin
  ALL policy into INSERT, UPDATE and DELETE with identical membership/role
  conditions. UPDATE retains both old-row and new-row checks.
- Drops the redundant `idx_interviews_organization` index, retaining
  `idx_interviews_project` on the same column. The retained index must be ready,
  valid and unfiltered before removal. Live interviews occupy 96 kB at preflight;
  a five-second lock timeout bounds waiting and the migration is transactional.

The separate Auth setting **Prevent use of leaked passwords** was enabled and
read back as ENABLED in Aural Pilot's production dashboard. No password, signup
allowlist, email-confirmation setting or provider was changed. This rejects
known compromised passwords for signup/password changes; it does not require
resetting existing credentials. [Supabase password guidance](https://supabase.com/docs/guides/auth/password-security).

## Verification

`tests/sql/provider-release.sql` includes the affected baseline migrations and
`database-advisor-hardening.sql`. The test compares actual table grants before
and after, verifies the index and trigger configuration, then exercises normal
CRUD, read-back, cross-user refusal, cross-organization refusal, member versus
admin rights, attempted ownership reassignment, and retry after denial.
Temporary test grants and synthetic records are transactionally rolled back.
The focused PostgreSQL 17 test passed locally; the small task-owned server was
stopped afterwards. Full lint, types, application tests, browser tests and build
remain remote CI responsibilities.

Follow [provider-release.md](provider-release.md) for production deployment:
reconstruct the historical production ledger in a temporary deployment
directory, add only this reviewed migration from the merged commit, dry-run,
then use the Supabase CLI. Do not push this repository's differently consolidated
baseline to production or repair historical versions.

Release acceptance: green CI at the merged change, verified Vercel deployment,
the exact new ledger version and statement, unchanged data grants, no remaining
WARN/ERROR from either advisor, and successful authenticated application reads.
Record immutable workflow/deployment links and observed outcomes on the PR.

## Informational notices deliberately retained

RLS-enabled backend-only tables without policies remain closed to browser roles.
Unused-index counters from a young pilot are not evidence that indexes can be
dropped. Unindexed foreign keys and the absolute Auth connection allocation are
INFO-level capacity recommendations; assess them against workload rather than
changing access or removing useful indexes to empty the advisor list.
