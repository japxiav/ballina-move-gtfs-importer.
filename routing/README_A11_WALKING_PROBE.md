# Ballina Move A11 | Real pedestrian provider smoke & fail-closed validation

**Candidate only.** No deployment, no staging mutation, no public passenger routing. This patch builds on A10 already integrated on `main` (PR #9). It does **not** claim verified sidewalks, accessibility, or full end-to-end itinerary correctness.

## What already existed

- `StadiaWalkingRouter` sends server-side authenticated pedestrian requests to the **EU** Stadia Maps / Valhalla `POST /route/v1` endpoint and decodes polyline6.
- It applies separate user-vs-stop endpoint drift thresholds, accounts for unrouted snap gaps in estimated distance and duration, and does not plot gaps as verified footways.
- `buildPedestrianPaths` limits candidate calls, concurrency, and elapsed time. Existing full planner and v0.10 CI tests remain unchanged in purpose.
- The currently deployed `ballina-routing-v010-private-staging` v6 intentionally uses synthetic `mockRouter` paths. Do not describe its geometry as genuine, even after this patch is merged.

## A11 first slice

1. Validate every decoded geographic point and limit shapes to **10,000 points**. An invalid or oversized provider geometry raises `invalid_polyline`; there is never a synthetic fallback.
2. Reject a successful provider response if the sum of straight-line distances along its decoded geometry exceeds its stated route length by more than a small rounding margin (max of 10 metres or 3%). This prevents paying for a 2km walking shape but counting it as a few metres in journey limits and ETA. This is a necessary physical consistency check, not proof of an accessible path.
3. Add adversarial offline tests for impossible/oversized shapes, internally inconsistent route lengths, 401/403/429/500 failures, no-path, lack of retries, and synthetic-provider rejection.
4. Add a **strictly opt-in, two-request** real-provider smoke runner against two fixed public Ballina coordinates. It requires `--live` and `STADIA_API_KEY` in the process environment, emits only aggregate geometry metrics, and uses no user location. It is not called by CI or on normal app requests.

### Private live check (only in an authorized environment with the secret)

```sh
cd routing
npm ci --ignore-scripts
npm run build
STADIA_API_KEY='(set in an environment variable, not in code)' node scripts/a11_live_walking_smoke.cjs --live
```

Expected: two `stadia-valhalla-pedestrian` results with nonzero distance/duration, at least two decoded geometry points, and reported snapped endpoint distances. This costs up to **two standard routing requests** (currently 20 Stadia credits each; verify the account's current plan/limits before invoking). The command is NOT run automatically. Missing credentials or network access mean live integration remains unverified.

The two fixed scenarios are a point near central Ballina to Ballina Bus Station and a second central Ballina approach to that station. They are not user locations. An API route still does not certify the pavement is usable, crossings are safe, or accessibility is present. Review routes against local map imagery or field observations before public use.

## Release gates still open

- Secure live key/account configuration, provider usage limits and operational policies.
- Authenticated **isolated** staging running a real provider, without touching the v6 synthetic preview.
- Comparative runs across Ballina/Castlebar/Westport including no-path cases, river crossings and roadside stop geometry.
- E2E GTFS + provider + transit scheduling and documented provider-failure behavior.
- Launch policy, quota/monitoring alerts, and independent review. The current mock staging is not upgraded by merging this candidate.

Official references: https://docs.stadiamaps.com/routing/standard-routing/ ; https://docs.stadiamaps.com/authentication/ ; https://docs.stadiamaps.com/eu-gdpr-endpoints/ ; https://stadiamaps.com/pricing .
