# Ballina Move A11 Phase 3 — isolated GTFS + real pedestrian canary

**Status:** Review candidate. Not deployed, not suitable for passenger navigation.

## Why this is separate

The existing `ballina-routing-v010-private-staging` v6 runs **synthetic** walks. It must remain unchanged. The existing GitHub A11 P2 test confirmed **two real Stadia/Valhalla route responses** in Ballina. Phase 3 exercises the **full GTFS → timetable planner → Stadia → itinerary response** chain in a NEW Edge Function without replacing the existing staging.

## Files

- `routing/staging/a11_realwalking_canary_suffix.ts`: narrow, double-authenticated server entrypoint.
- `routing/scripts/build_a11_realwalking_canary.cjs`: deterministic builder from the 16-module **canonical** A11 preview artifact already on `main`.
- `routing/artifacts/ballina-a11-realwalking-private-canary.ts`: generated standalone Edge Function. No dynamic `eval` or build dependencies at runtime.
- `routing/tests/a11PrivateCanary.test.cjs`: negative security tests and a real engine integration test with mocked upstream HTTP.

## Security and cost envelope

1. Deploy **ONLY** as new function slug `ballina-a11-realwalking-canary`, with **`verify_jwt=true`**. An upstream Supabase gateway MUST verify the JWT. The function additionally enforces `x-ballina-preview-token`, whose value comes from already-configured `BALLINA_ROUTING_PREVIEW_TOKEN`, and rejects browser `Origin` requests. Do not disable JWT verification.
2. No API key or private token may be committed, printed in logs or sent to the frontend.
3. Only three hardcoded test itineraries are accepted: Ballina–Foxford bus, Ballina–Foxford rail, Ballina–Castlebar bus. Each requires an explicit `YES_UP_TO_12_WALKS` in the POST body. Times use Europe/Dublin dates, today through 14 days ahead. These coordinates are **test approaches near public GTFS stops**, not verified street access.
4. Atomic Supabase `consume_transport_api_rate_limit` RPC caps A11 integration attempts at **two per hour across instances**. The existing routing API independently caps walking-provider calls at **12 per itinerary**, with its own shared limiter. Maximum planned paid provider attempts for the canary are thus approximately **24 per hour**; no lifetime cost cap is claimed. The shared limiter writes counters only. All GTFS loading is read-only.
5. No synthetic walk fallback: missing Stadia or database key fails closed; a successful result containing a walk from an unexpected provider is rejected. The function reports `notForPassengers:true` and never claims no transport exists from an empty result.
6. A real Stadia route is **not** confirmation of sidewalk safety, accessibility or the exact side of the street. Existing endpoint-snap warnings must be examined. No public rollout.

## Deploy after review + green CI

Generate and verify locally from the **exact GitHub main artifact**, not from an old source snapshot:

```
cd routing
node scripts/build_a11_realwalking_canary.cjs --verify
node --test tests/a11PrivateCanary.test.cjs
```

After Draft PR review and merge, deploy the committed `routing/artifacts/ballina-a11-realwalking-private-canary.ts` as `index.ts` of the **new** Edge Function `ballina-a11-realwalking-canary`, in Supabase project `ballina-move`, setting `verify_jwt=true`. Never replace `ballina-routing-v010-private-staging`, `ballina-routing-preview`, or any collector.

Required runtime environment is inherited from the Supabase project: `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (or supported aliases), `STADIA_API_KEY`, and `BALLINA_ROUTING_PREVIEW_TOKEN`. If missing, the canary reports unready and will not make paid calls.

## Authenticated acceptance plan (NO automatic live requests)

The gateway requires a valid project JWT (Bearer token). The application also requires the private `x-ballina-preview-token` header; keep both offline and secret. Verify without paid calls first:

- `GET /health`: `private:true`, `syntheticWalking:false`, `ready:true`, `stadiaConfigured:true`. This checks configuration only, not any upstream API.
- `GET /v1/gtfs-summary`: show actual active feed version and counts, `paidWalkingCalls:0`. It must agree with the database active snapshot.
- Unauthenticated, incorrect token, bad method and browser `Origin` requests must fail. Check real JWT gateway in the deployed project, not only local tests.

**Only after these checks, and after checking Stadia balance**, invoke at most one deliberately chosen case:

`POST /v1/canary-journey` (JSON):

```json
{"scenarioId":"ballina-foxford-bus","serviceDate":"<Europe/Dublin local YYYY-MM-DD>","departAt":"09:15","confirmPaidCalls":"YES_UP_TO_12_WALKS"}
```

Choose an operating weekday/service time based on GTFS. Compare confirmed route geometry and walking summaries against a map and field knowledge. Repeat with a separate case only after inspecting the first result. A green CI is NOT proof of successful live GTFS + Stadia integration.

## Offline validation done before packaging

- Source artifact character-checksum and bundle cut offset matched canonical GitHub `main` (A11 included).
- 11/11 new Node tests passed, including complete original compiled 16-module route planning using mocked GTFS and mocked Stadia HTTP. This does NOT involve real network or paid calls.
- No service deployment or remote data writes performed by packaging.

## Remaining release gates

- CI on GitHub (new Draft PR), integrity and manual review.
- Private deployment under new slug with Supabase gateway JWT enabled.
- Authenticated read-only health, GTFS summary and failure checks.
- One or two explicitly approved real-provider **GTFS journey** calls and examination of results.
- Mayo regional matrix, no-path, ferry/river/crossing cases, times and real boarding-point verification before any passenger preview.
