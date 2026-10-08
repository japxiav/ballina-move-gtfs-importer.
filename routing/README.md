> **v0.9.9 candidata em auditoria local.** Consulte `README_RELEASE_0.9.9.md`. Não está implantada.

# Ballina Move routing v0.9.8 (candidata local nao implantada)

Leia `LEIA_PRIMEIRO_0.9.8.md` e `README_RELEASE_0.9.8.md` antes da revisao ou deploy.

# Ballina Move routing v0.9.7 (candidata não implantada)

Leia `README_RELEASE_0.9.7.md` e `docs/SELF_AUDIT_097.md` antes de qualquer promoção.

# CURRENT CANDIDATE: v0.9.6 (NOT DEPLOYED)

**Read [`README_RELEASE_0.9.6.md`](README_RELEASE_0.9.6.md) first. All older release notes below are historical.**

# CURRENT CANDIDATE: v0.9.4 (NOT DEPLOYED)

Read [`README_RELEASE_0.9.4.md`](README_RELEASE_0.9.4.md) first. Historical content below describes earlier states.

> **v0.9.2 candidate:** read [README_RELEASE_0.9.2.md](README_RELEASE_0.9.2.md) first. The rest of this file is retained from the original v0.9.0.

# Ballina Move Routing Engine v0.9.0

**Status: tested TypeScript source package, protected Supabase preview candidate, not a publicly launched journey planner.**

- New `GET /v1/nearby-stops`: static GTFS bus boarding eligibility, stop codes and approximately measured great-circle distance. **Not** live departures or walking routes.
- New `prioritize: fastest|less_walking|fewest_transfers` on `POST /v1/journeys`. Selection happens before limiting displayed options.
- The future private preview uses the existing Supabase limiter and a maximum of 12 provider-using journey searches per hour across the project. Keep all secrets on the backend.
- Validated locally via `npm test`; 106 tests currently pass. Fixed-route **real** Stadia + GTFS canary passed in v0.6; v0.9 general API is not yet end-to-end verified at the Edge gateway.
- The realtime NTA collector and existing Supabase DB are separate and unchanged by this source package.

Read [docs/PILOT_0.9.md](docs/PILOT_0.9.md) before deploying or giving access to the three testers.

---

# Current release: v0.8.0

**Status:** Local prototype. Private source only. Not deployed as a public planner.

- Supports walk-only (provider-routed), walk → bus → walk, bus → interchange → bus → walk, and up to three rides with two transfers.
- Bus/rail journey legs share a data model; **rail is off by default** until genuine Irish Rail interchange validation.
- Genuine Supabase GTFS reference: **445 Ballycastle 07:55 → Ballina 08:30; 420 Ballina 10:45 → Mayo Hospital 11:33**, on 2026-10-08. That is a long **135-minute wait**, a test of real timetable compatibility, **not** an optimality claim.
- Direct walking must be backed by a pedestrian route. Stops, side of street and platform information remain clearly unverified unless sourced separately.
- See `docs/MULTIMODAL_0.8.md` for limitations and acceptance criteria; `npm test` and `npm run real-two-bus-demo` reproduce the current acceptance tests.

---

# Ballina Move Routing Engine • Technical prototype v0.8.0 (not deployed)

A TypeScript GTFS journey engine, developed independently for Ballina Move. This is **not a deployed app**, it uses **no production credentials**, and nothing in this package changes the Supabase project, GitHub importer, realtime collector or existing GTFS version.

## Run locally

```bash
npm install
npm test
npm run demo
```

No paid map key is necessary to run unit tests or the synthetic demo. The generic demo uses fictional schedules and walking routes. The dated real-trip fixtures use authentic GTFS timetable data, with pedestrian walks explicitly mocked unless labelled as the historical live Stadia test. The engine can ingest the current Supabase GTFS tables through the `fromSupabaseTables` adapter, but this package does not directly connect to production and has not yet proven any live route.

## Design

- **`planJourneys()`**: GTFS service days, calendars, exception dates, stop order, pickup/dropoff, minimum boarding/transfer time, walking budgets; direct and up to two transfers.
- **`buildPedestrianPaths()`**: optionally requests *actual* walking paths from a provider with a strict request budget. Straight-line distance is used **only to choose candidates**, never as a walk time or as a route to show a person.
- **`StadiaWalkingRouter`**: server-side HTTP adapter for Stadia/Valhalla pedestrian routing (EU endpoint, polyline6). The API key must stay on the server. Unit tests mock requests. A paid commercial plan is required when deployed commercially; check current plan, routing quota and the terms before using it live.
- **`fromSupabaseTables()`**: transforms real Ballina Supabase column names into a strict data model. It rejects mixed feed versions. A future trusted server component will load paginated data.
- **`journeyOverlay()`**: returns GeoJSON for walked geometry and GTFS boarding/alighting pins to display using **MapLibre GL JS** when the WebApp exists. It does **not draw false straight-line roads between stops**. Actual bus polylines from `gtfs_shapes` can be attached in a future step.
- **`boardingInstruction()`**: GTFS stop ID, stop code, stop coordinate and honest uncertainty. It only exposes an explicit side of the road or bay when verification metadata has been provided. A coordinate alone does **not** verify which side of the street to wait on.

## Contracts for our future commercial app

- MapLibre GL JS: permissive BSD-3-Clause library; maintain its notices.
- Map/geodata: OpenStreetMap ODbL attribution and derivative database terms where applicable; do not confuse the data license with hosted tile-service terms.
- Stadia Maps: free tier does **not** authorize commercial use; verify a paid subscription and the route endpoint quotas before production. The current published Starter plan is $20/month. The MapLibre map style must be configured by the future WebApp (not hardcoded into this engine).
- Avoid prohibited **server-side caching**, bulk harvesting or permanent reuse of hosted map/geocode services. Consult current provider TOS; our own licensed GTFS snapshots are distinct from hosted geocoding results.
- NTA GTFS/GTFS-RT: show NTA/source attribution and data freshness; live prediction merging remains a separate, carefully tested integration.

## Important correctness limitations (before any production journey planning)

1. **Not a complete route-planning product**: this first independent algorithm keeps one earliest arrival per stop per transfer-round. It may miss alternatives with fewer steps/walking and needs Pareto-dominance routing, loop prevention, performance profiling and broader stress testing before launch.
2. **Timezone and service-date boundaries**: `departAfterSeconds` is seconds after the *GTFS local service-day clock*, not UTC; times >24h are supported. DST-change Sundays are explicitly refused. Upcoming work: timezone-safe epoch conversion for preceding/following service dates, crossings at midnight and ambiguous local time handling.
3. **Pedestrian service not live-tested**: the provider implementation is unit-tested with mock HTTP. Real route quality, footway snapping and legal crossings must be checked with actual Ballina/County Mayo coordinates and a valid API key.
4. **Coverage**: the active feed is a regional subset, not every Ireland transit service; a missing result means we cannot prove a journey, not that no service exists.
5. **Local boarding and bay certainty**: do not infer or assert correct-side-of-road, accessible crossing, stop pole or boarding bay without verifying the GTFS data or locally curated reference.
6. **No real-time guarantee**: all outputs are labelled `scheduled`. GTFS-RT cancellations, realtime-only trips and vehicle telemetry are not yet incorporated in this engine.
7. **No public HTTP endpoint**: do not expose Supabase's service-role credentials, Stadia secret keys or full data access from a browser.
8. **Transfers**: supports at most two transfers, but uses an initial algorithm rather than an exhaustive transit routing engine. Use independently verified pedestrian routes, minimum transfer buffers and risk indicators in a future revision.

## Implementation sequence

1. Compare a full, paginated production GTFS snapshot with our adapter; test a real route such as Bus 420 Ballina → Mayo Hospital against published timetable.
2. Select a commercial Stadia plan and test actual pedestrian routing **to the correct stop entrance/pole**; no key exists in this package.
3. Implement timezone-safe time handling, alternatives and production-grade path search; create independent correctness/performance tests.
4. Define backend plan API with authorization/rate limiting and private provider keys. Connect map overlays through MapLibre in the WebApp.
5. Later join trustworthy GTFS-RT and expand to Irish Rail.

## User-guidance principles

A passenger must see the **boarding stop, stop code, physical coordinates, destination displayed on the bus, and walking route**. When specific platform/side/accessibility details are unverified, say so in the UI rather than inventing them.

## Update 0.2: first real GTFS test (2026-10-08)

- `npm run real-demo` verifies a **dated actual NTA GTFS** 420 journey from Ballina Bus Stn (08:00) to Mayo Hospital (08:52) via Castlebar (08:48). The static fixture includes GTFS service calendar, the 11 timetable stops, codes, and pickup/drop-off flags. It does **not** include verified walking: the example uses test-only zero-distance access/egress paths at the stop coordinates.
- `loadActiveGtfsSnapshot()` provides a server-only private PostgREST GTFS loader with complete pagination, feed-version consistency checks, and reference validation. It has been tested with mocked HTTP, not production authenticated GET requests.
- Current rollout and limitations: see `docs/REAL_GTFS_ACCEPTANCE_2026-10-08.md`. The app is **not deployed**, Stadia walking has **not been live tested**, the collector v9 candidate remains separate, and no new GitHub commits have been made.

## Update 0.3: walking + reviewed boarding evidence

- Added `planDoorToDoor()` to connect GTFS timetables, capped pedestrian routing requests, candidate walking transfers and MapLibre-ready overlay data. Trains are explicitly off by default.
- Stadia EU Valhalla adapter now sends its API key in the `Authorization: Stadia-Auth` header rather than embedding it in the request URL. Still requires server-only configuration.
- Added `applyBoardingEvidence()` and `journeyBoardingDetails()` for a **separate, sourced, dated, version-specific review of the physical boarding point**. Unverified GTFS locations remain labelled unverified. A manually verified coordinate guides the walking endpoint and map marker without corrupting the official GTFS stop record.
- Reworked candidate transfers to avoid silently depending on the arbitrary ordering of stops in the source feed. Travel alternatives may remain incomplete due to bounded candidate search.
- The 2026-10-08 NTA 420 fixture remains part of the contract tests; pedestrian paths in tests are **mocked**, not proven in the real world.
- See `docs/BOARDING_WALKING_0.3.md` for sources, financial implications and production blockers.
- No code has been pushed to GitHub and no production system or Supabase project was changed as part of this routing-engine package.


## Update 0.4: private routing API candidate

- Added a **server-side** HTTP API contract (`src/httpApi.ts`) for `POST /v1/journeys` and liveness `GET /health`. It takes geographic coordinates and Dublin-local service time, not street names yet.
- Every valid result includes NTA GTFS route and boarding data, detailed *official/unverified* boarding locations, and `scheduled_only` status. No invented GPS or pedestrian paths are exposed.
- Added strong input/CORS/body-size validation, global + client rate limits, and safe error responses. The limiter is shared/atomic through our **existing Supabase RPC** (`src/supabaseLimiter.ts`), with hashed bucket identifiers. Test-only in-memory limiter is explicitly not for production.
- Added a short in-memory GTFS snapshot cache with concurrent-call deduplication, and deterministic ordered pagination for the multi-page `gtfs_stop_times` table.
- `npm run api-demo` runs the dated real NTA Bus 420 fixture with **synthetic walking**; `npm run walk-smoke` deliberately invokes a **real Stadia endpoint only if a private STADIA_API_KEY exists**; `npm run api-local` provides an explicitly localhost-only adapter requiring real server secrets.
- **NOT DEPLOYED.** No Stadia live calls, Supabase modifications, Vercel deployment or GitHub commits. Production readiness is blocked on route provider credentials, live walking/geography verification, hosting ingress safety, transfer/clock robustness and stress testing.
- See `docs/API_SERVER_0.4.md` for the exact request format, current behavior and risks.

## v0.5 protected Supabase preview (historical notes; see v0.6 below)

A Deno-compatible private preview adapter has been prepared at
`supabase/functions/ballina-routing-preview/`; see
`docs/SUPABASE_PREVIEW_0.5.md`. This is NOT deployed.
The standalone health-only function was deployed in v0.5 but initially
reported a missing `STADIA_API_KEY`; **this historical blocker has now been
fixed and a single real walking + GTFS canary verified**, as documented in v0.6.
The smoke tester's paid endpoint remains disabled. Do not place provider keys
inside this repository.


## v0.6: real-world integration and verified-location correctness (2026-10-08)

- Supabase GTFS + live Stadia walking **fixed-route canary succeeded** (465m / 366s to Ballina Bus Station; scheduled Bus 420 10:45 to Mayo Hospital 11:33). It was then **disabled** so no chargeable open endpoint remains. This is distinct from a deployed general planner.
- Corrected two subtle inconsistencies: the walk leg and its displayed boarding detail both now terminate at a separately reviewed physical boarding point, if such evidence exists, rather than a different official GTFS coordinate. Official GTFS fields remain untouched.
- Added regression checks for boarding geometry, recorded real walking time against the actual GTFS 08:00 fixture, negative boarding-window scenario, and Deno/Node source parity.
- Tested with Node 22 + TypeScript locally; public planning remains **not deployed**.
- Full technical notes, boundaries and evidence: `docs/REAL_WALK_GTFS_INTEGRATION_0.6.md`.
