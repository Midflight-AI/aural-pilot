# Internal Aural pilot

This fork pins upstream 6f85feea999cff2b123366b1b85e634a7366037f. The interview engine is unchanged. This is not a public candidate service.

## Access boundary

- Vercel `aural-pilot`: Vercel Authentication **All Deployments**, including custom domains. Keep source private in deployment settings. Use existing authorised team members only.
- Azure relay: Container Apps external HTTPS ingress must require Microsoft Entra authentication, restricted to explicitly assigned pilot users. Create it with ingress disabled until authentication is configured. Never publish the unprotected relay, including a secondary/default hostname.
- Before interview launch, each tester signs into the relay's `/.auth/login/aad` URL. Verify browser WebSocket authentication actually works across the selected app and relay hostnames before claiming readiness; cookie restrictions may require same-site subdomains.
- Supabase migration 006 denies direct interview-table, RPC and object-storage access to browser roles. The protected app uses its server key; browser profile reads retain existing owner RLS. Signup is restricted to an explicit private email allowlist; populate it separately, never from user-editable metadata.
- Ramp server integration needs an automation credential for Vercel's outer protection in addition to the Aural API key. Do not make API routes public as a workaround. This remains unconfigured.

## Relay image

Build remotely with `docker build -f deploy/relay.Dockerfile .`. Runtime port is 8767. Use a TCP readiness probe; upstream does not expose an HTTP health endpoint. Supply runtime secrets through Azure's secret store, not the image or Git:

- `AZURE_OPENAI_ENDPOINT`: the `wss://` resource hostname only (the relay appends the API path).
- `AZURE_OPENAI_API_KEY`: Azure resource key.
- `AZURE_OPENAI_DEPLOYMENT`: `aural-pilot-voice`.
- `AZURE_OPENAI_VOICE`: `ash`.
- `VOICE_ASR_PRIMARY`: `openai`.

Web build variables select the relay with `NEXT_PUBLIC_VOICE_RELAY_PRIMARY=openai` and `NEXT_PUBLIC_OPENAI_VOICE_RELAY_URL=wss://<protected relay hostname>`.

Report generation needs its own configured text-model deployment/provider; the voice model does not produce Aural reports by itself. No provider keys are stored in this repository.

## Acceptance

Before allowing fictional interview data: anonymous website request denied; anonymous relay handshake denied without opening an Azure session; unassigned Entra user denied; direct Supabase candidate listing and session mutation denied; unapproved signup denied. Then verify approved login, microphone check, spoken answers, interruption/retry, report synchronization, both voices playing back, and reviewer access denial. Keep real candidate data out until a separate readiness review.

The current pilot voice model is `gpt-realtime-mini` 2025-12-15 because the subscription has no quota for upstream's default 1.5 model. Azure reports this version retires on 15 December 2026. Upgrade before then. Live model compatibility is not yet verified.

## Verified checkpoint — 31 October 2026

- Azure CLI authenticated to the dedicated Amped HQ — Aural Pilot subscription (`34e7b504-35c1-46d3-8cde-988c27568e63`). Microsoft.App provider registration requested; no relay host created yet.
- Supabase project `knbbkrfatygusjqjcjcy`: migrations 001–007 applied, direct-browser access checks passed, one approved internal tester added. No candidate data loaded.
- Vercel project `prj_bw2RnCtuOwEMT2BCokufwGJFlyX3`: all-deployment authentication enabled. Preview build fails because database environment variables are missing. Credential transfer requires the pending explicit destination approval; no credentials transferred.
- Relay image remote CI passes at `e11ffa7c0014588646e43f5a058a235a1e0dc5c9`, including unprivileged runtime and imports. The Docker build now includes upstream `.npmrc` (`install-links=true`).
- Next.js, DOMPurify, Zod and Undici patched within their existing major versions. The remote audit no longer reports high/critical findings. CI still stops on a moderate minimatch advisory in lint dependencies. Do not bypass the audit or force incompatible lint dependency downgrades.
- Report generation remains unconfigured. East US 2 has Standard quota for GPT-4o, but GPT-4o-mini Standard is listed as retired; Global Standard quota is zero. Select a supported deployment configuration before using the report/generator workflows.
- No public relay, successful website preview, end-to-end interview, Ramp production migration, merge or production release has been completed.
