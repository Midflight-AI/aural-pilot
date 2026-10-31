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
