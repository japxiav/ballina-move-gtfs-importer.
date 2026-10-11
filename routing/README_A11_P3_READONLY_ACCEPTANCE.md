# Ballina Move · A11 Phase 3: post-deploy read-only acceptance

The isolated Supabase Edge Function `ballina-a11-realwalking-canary` v1 was deployed with `verify_jwt=true`. This workflow checks the already-deployed function; it **does not deploy** anything and does **not** call Stadia/Valhalla.

## Files

- `.github/workflows/a11-private-canary-readonly.yml`: opt-in GitHub Actions workflow, `main` only.
- `routing/scripts/a11_canary_readonly_acceptance.cjs`: six GET-only requests.
- `routing/tests/a11CanaryReadOnlyAcceptance.test.cjs`: seven offline negative and positive tests.
- This runbook.

## Authentication and private credentials

Add the following GitHub Actions **repository secrets** (never put them in source files, issue comments, chat, PR descriptions, or screenshots):

- `BALLINA_SUPABASE_ANON_JWT`: the project's **legacy anon JWT** for the existing Supabase JWT gateway. It has three dot-separated JWT segments. An `sb_publishable_...` value is **not** a JWT and is intentionally rejected by the runner. Do NOT use the service-role/secret key for this test.
- `BALLINA_ROUTING_PREVIEW_TOKEN`: the **same existing private token** already configured in Supabase for the A11 canary. It is distinct from the anon JWT. If the token is unavailable, stop and plan a coordinated rotation; don't silently overwrite the working Supabase secret.

Supabase project identity is public and pinned in the runner. The workflow never prints credentials or full request headers.

## Safe workflow procedure

1. Create `feature/a11-readonly-acceptance` from `main` and upload the files preserving paths.
2. Open a **Draft PR** into `main`. The existing routing CI will test the script because it lives under `routing/tests`.
3. Inspect GitHub Actions and review the file diff. Only after CI is green, merge with `Create a merge commit`.
4. Configure the two repository secrets (if not already configured) in **Settings → Secrets and variables → Actions**. Confirm they are correctly scoped to this repo.
5. Open **Actions → A11 private canary read-only acceptance (zero Stadia calls)** on `main`, choose `YES_SIX_GET_REQUESTS`, and run once.
6. Inspect the output. Expected: `private_read_only_acceptance_success`, `requests: 6`, `authenticationChecksPassed: 4`, `paidWalkingRequests: 0`, actual GTFS counts and a truncated feed version prefix.

## What the six requests check

1. Missing JWT is rejected (gateway must enforce `verify_jwt=true`).
2. Wrong preview token is rejected.
3. Missing preview token is rejected.
4. Browser-origin request is rejected.
5. Authenticated `/health` returns a configured private canary with `syntheticWalking:false` and `ready:true`.
6. Authenticated `/v1/gtfs-summary` returns actual active GTFS counts and reports zero paid walking requests.

**No POST requests. No paid walking queries. No Supabase staging mutation.** This is a network integration test and does not by itself prove timetable route selection, cost behavior under stress, or actual walkability. If the test fails, do not keep rerunning: investigate missing credentials, JWT gateway settings, private token mismatch and feed readiness. The later paid journey probe requires separate review and explicit cost approval.

## Local offline test

```sh
node --test routing/tests/a11CanaryReadOnlyAcceptance.test.cjs
```
