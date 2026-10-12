# Ballina Move A11 Phase 3 — isolated GTFS + real pedestrian canary

**Status:** Review candidate. Not deployed, not suitable for passenger navigation.

Historical integration/deployment statements below are not a fresh production check. The current offline execution and unresolved gates are recorded in `docs/ENGINEERING_EXECUTION_LOG.md`; no new live or paid request is authorized by this document.

## Why this is separate

The existing `ballina-routing-v010-private-staging` v6 runs **synthetic** walks. It must remain unchanged. The existing GitHub A11 P2 test confirmed **two real Stadia/Valhalla route responses** in Ballina. Phase 3 exercises the **full GTFS → timetable planner → Stadia → itinerary response** chain in a NEW Edge Function without replacing the existing staging.

## Files

- `routing/staging/a11_realwalking_canary_suffix.ts`: narrow, double-authenticated server entrypoint.
- `routing/scripts/build_a11_realwalking_canary.cjs`: deterministic builder from the 16-module **canonical** A11 preview artifact already on `main`.
- `routing/artifacts/ballina-a11-realwalking-private-canary.ts`: generated standalone Edge Function. No dynamic `eval` or build dependencies at runtime.
- `routing/tests/a11PrivateCanary.test.cjs`: negative security tests and a real engine integration test with mocked upstream HTTP.
- `routing/tests/a13CanaryBodyBounds.test.cjs`: real-stream, byte/time/abort limits and cleanup regressions before any provider work.

## Security and cost envelope

1. Deploy **ONLY** as new function slug `ballina-a11-realwalking-canary`, with **`verify_jwt=true`**. An upstream Supabase gateway MUST verify the JWT. The function additionally enforces `x-ballina-preview-token`, whose value comes from already-configured `BALLINA_ROUTING_PREVIEW_TOKEN`, and rejects browser `Origin` requests. Do not disable JWT verification.
2. No API key or private token may be committed, printed in logs or sent to the frontend.
3. Only three hardcoded test itineraries are accepted: Ballina–Foxford bus, Ballina–Foxford rail, Ballina–Castlebar bus. Each requires an explicit `YES_UP_TO_12_WALKS` in the POST body. Times use Europe/Dublin dates, today through 14 days ahead. These coordinates are **test approaches near public GTFS stops**, not verified street access.
4. Atomic Supabase `consume_transport_api_rate_limit` RPC caps A11 integration attempts at **two per hour across instances**. The existing routing API independently caps walking-provider calls at **12 per itinerary**, with its own shared limiter. Maximum planned paid provider attempts for the canary are thus approximately **24 per hour**; no lifetime cost cap is claimed. The shared limiter writes counters only. All GTFS loading is read-only.
5. No synthetic walk fallback: missing Stadia or database key fails closed; a successful result containing a walk from an unexpected provider is rejected. The function reports `notForPassengers:true` and never claims no transport exists from an empty result.
6. A real Stadia route is **not** confirmation of sidewalk safety, accessibility or the exact side of the street. Existing endpoint-snap warnings must be examined. No public rollout.
7. POST JSON is limited to **512 actual UTF-8 bytes**, including whitespace, with a10s read deadline and request cancellation. Content-Length can reject early but never overrides the real byte limit. Oversize413, deadline408, abort499 and invalid JSON400 all occur before consuming the hourly limiter or calling routing. Authentication/Origin/method gates still run first.

## Deployment requires separate explicit authorization

Local checks and a green CI do not authorize deployment. Before any proposed rollout, verify the current private function version/JWT settings, retain its exact previous bytes and bindings through the platform's protected mechanism, and prepare rollback to that version without changing feeds, collectors or quotas. Current remote version and rollback execution are not verified.

Generate and verify locally from the **exact GitHub main artifact**, not from an old source snapshot:

```
cd routing
node scripts/build_a11_realwalking_canary.cjs --verify
node --test tests/a11PrivateCanary.test.cjs
```

Only after review and explicit user approval may the committed `routing/artifacts/ballina-a11-realwalking-private-canary.ts` be proposed as `index.ts` of the private Edge Function `ballina-a11-realwalking-canary`, in Supabase project `ballina-move`, setting `verify_jwt=true`. Never replace `ballina-routing-v010-private-staging`, `ballina-routing-preview`, or any collector.

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
- At most one specifically approved real-provider **GTFS journey** call and examination of results; a second attempt/retry requires new consent.
- Mayo regional matrix, no-path, ferry/river/crossing cases, times and real boarding-point verification before any passenger preview.
