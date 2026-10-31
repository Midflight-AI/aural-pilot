# Invitation lifecycle preview

Existing REST creation was non-idempotent. Candidates had a unique token but no
revocation, expiry or token-rotation API. `create_invite_session` checked then
inserted without a row lock; concurrent starts could create multiple sessions.
Ramp's Close action stopped syncing without revoking the provider link.

This preview adds:

- `Idempotency-Key` (8–128 ASCII letters/digits/`._:-`) on POST `/interviews`
  and `/interviews/{id}/candidates`. Replays return the committed response;
  changed normalized payloads return 409. Keys are scoped to actor and resource,
  survive key rotation and are retained. Omitting a key preserves legacy creation.
- Initial `questions:[{text}]` on keyed interview creation, committed atomically
  with the template. Other question types still use existing question endpoints.
- `inviteExpiresAt` on keyed candidate creation; GET candidates returns
  `inviteUrl`, `inviteStatus`, `inviteExpiresAt`, `inviteVersion`.
- POST `/interviews/{id}/candidates/{candidateId}/invitation` with a required
  idempotency key and `{action:cancel|expire|reissue,version,expiresAt?}`.
  Reissue requires future expiry, rotates the token, and increments version.
  Missing/mismatched resource or insufficient project role is denied.
- Atomic invite-start row locking. A cancellation racing a start has a single
  winner. Once any session exists, controls return `INTERVIEW_ALREADY_STARTED`;
  expiry does not interrupt a started interview. Public slug plus email is no
  longer sufficient to start an invite-only interview: use the private token.

`AURAL_INVITE_LIFECYCLE_ENABLED=true` gates the new keyed operations and control
route. Apply migration before deploying the branch. No production changes.
The private ledger and functions are service-role only; no API key or invitation
capability belongs in logs. Token revocation does not remove historical evidence.

Validation: targeted route/unit tests, rollback-only `tests/sql/invite-lifecycle.sql`
on the isolated preview (never production), then deployed parallel/retry cases.
