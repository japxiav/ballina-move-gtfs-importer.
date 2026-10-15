# Regional v1 progress / checkpoint

**Current published technical preview: `3619cc40929cea2fb540ff6b561876ed82c55969`. Regional release remains NO-GO.** The authorized14October update is live on the existing free Render service, deployment `dep-db7j0p25b2lc7384pojg`; journey-api is ACTIVE/version5 and transport-api remains11. Actual HTTPS browser verification and source/build comparison passed. Main remains `f38826625e08fe6bcd92073df45685fa36bbf7cf`; no database, credential, collector, cron, plan or paid-provider mutation. See [published evidence](evidence/published-audit-20261014/README.md). The owner subsequently authorized continued audit, corrections and publication on the current services; regional launch gates remain unresolved. Historical checkpoint rows below retain earlier stage results.

The user adopted the product-evolution PDF as the implementation roadmap. Four separate Draft PRs contain working code:

| PR | Branch | Implemented behavior |
|---|---|---|
| [45](https://github.com/japxiav/ballina-move-gtfs-importer./pull/45) | feature/passenger-place-search | Name/code/place search; compare hospital15108/15109 without asserting entrance/walking equivalence; bounded serial exact-stop reads, exact itinerary/back links, non-renewing memory cache |
| [46](https://github.com/japxiav/ballina-move-gtfs-importer./pull/46) | feature/vehicle-cards-map-view | Visible mobile/desktop vehicle cards, keyboard group lists, member-anchored markers, viewport/filter counters, focus/expiry handling |
| [47](https://github.com/japxiav/ballina-move-gtfs-importer./pull/47) | feature/passenger-local-tools | Local bounded favorites/recent routes, honest persistence/clear states, optional device-only nearest-covered-stop calculation, metadata/About/navigation corrections |
| [48](https://github.com/japxiav/ballina-move-gtfs-importer./pull/48) | fix/map-tile-deadline |15-second delayed-map warning; Refresh restarts pending cycles and clears previous partial errors after recovery |

| Stage | State | Evidence / remaining |
|---|---|---|
| S0 | PARTIAL | Exact Git/public source inventory, forced suites, active-feed capture and source hashes recorded; target margins/restore proof absent |
| S1 | IMPLEMENTED scoped |14Oct07:55 official capture preserves direct42008:00–08:52 to15109 and420→44009:24 to15108, including distinct actual interchange points; no building-arrival equivalence; thirteen offline scenarios and240trip sequence audit |
| S2 | UNVERIFIED / excluded | No pedestrian API used; physical hospital entrance, crossing/bays/access unknown; door-to-door cannot be claimed |
| S3 | BLOCKED evidence | A12/PR26 remains isolated; current web uses journey-api scheduled engine, not A12; target/rollout evidence remains missing |
| S4 | PARTIAL | Source observation ages and cancelled/unconfirmed distinctions retained; bus/train cards display only grounded fields; exact vehicle/trip/stops/path/ETA matching unavailable |
| S5 | IMPLEMENTED scoped | English compact interface, names/places, responsive cards, favorites and optional geolocation; widths320/360/390/430/768/1440 and keyboard/browser regressions; physical devices/manual WCAG audit remain |
| S6 | PARTIAL | Three independent reviews and fixes; no browser credentials or app coordinate transmission; anonymous host identity/NAT and distributed-abuse policy remains a regional P1 |
| S7 | PARTIAL | Timeout/late response/partial/quota/tile recovery implemented; native public read recovered after20s timeout; no SLO/resource/restore/7day observation claim |
| S8 | BLOCKED field evidence | Captured official and synthetic offline/emulated tests are labelled; no physical passenger pilot |
| S9 | UPDATED | Code/CI/evidence/risks/proposal/checkpoint saved; audit files retain historical evidence explicitly |
| S10 | TECHNICAL PREVIEW PASS; regional gates blocked | Approved update06 is live and publicly browser-verified. Future update/main merge still needs approval; regional GO remains unavailable |

| Gate | Status | Evidence / owner |
|---|---|---|
| G0 provenance | PASS scoped | Code/published06b72b4 / mainf388266 / Edgev4 / feed768b4b… / Codex |
| G1 journeys | PARTIAL | Exact hospital alternatives and transfer identities preserved; thirteen retained-feed scenarios; physical completeness/access unknown / Codex + field testers |
| G2 walking | UNVERIFIED | Walking excluded, no entrance/access/geometry proof / field testers + owner |
| G3 quality | PASS local technical scope |182browser,95gateway,70root Python,414routing,11staging, strict simulated API suites,1642oracle comparisons,16module parity/rebuild; all four PR web checks green; no physical-device claim / Codex |
| G4 realtime | PARTIAL | GPS vs reported location distinctions and expiry tested; no safely identified exact trip or vehicle-specific ETA / source integration |
| G5 security | PARTIAL | Adversarial reviews resolved identified local findings; host consumer/NAT/distributed-abuse remains regional P1 / owner + Codex |
| G6 resources | UNVERIFIED target | Controlled local single-run scenario timings are not Deno/Render CPU/RSS/p95/p99 evidence / owner + Codex |
| G7 operations | PARTIAL | Stable source and rollback receipts from prior authorized rollout exist; no new restore rehearsal, SLO or recurring monitor / owner + Codex |
| G8 UX/legal | PARTIAL | English compact browser/keyboard tests and explicit privacy/attribution; manual device/accessibility/legal review pending / owner + reviewers |
| G9 external proof | UNVERIFIED | No field/elapsed7day pilot / regional testers |
| G10 release | PARTIAL technical only | Owner-approved06 preview update completed; regional launch/main merge unaccepted / owner |

[Prepublication evidence packet](evidence/product-mission-20261013/validation.json), [CI checks](evidence/product-mission-20261013/github-checks.json) and [technical-update proposal](PRODUCT_MISSION_RELEASE_PROPOSAL.md). Screenshots are unpublished candidate replays: hospital official capture for14Oct, and an actual43-position official capture retrieved13Oct21:11London. Map PNGs were downloaded with native TLS and relayed into the local browser, max32/two concurrent; some tiles were pending/aborted. These images prove local rendering, not a deployed candidate or continuous live GPS.

Latest additional check13Oct21:54London: the final06 frontend was opened against actual current responses from the existing public3a gateway through an internal-only, bounded/no-credential/no-redirect relay. Two real journey reads returned the twelve hospital options; exact itinerary/back succeeded; one live read returned38 positions and a selected-vehicle card opened. Four stop-catalog reads and18 unique native-TLS tiles at at most two concurrent jobs stayed within limits. No fixtures or frozen clock were used; public frontend was not changed. See [actual-backend browser proof](evidence/product-mission-20261013/candidate-live-backend-proof.json). This does not replace device, walking, availability or regional field evidence.

Next safe work: continue from the frozen source and retained official datasets; require a securely identified service descriptor before adding vehicle stops/path/ETA. Arrive-by is deferred until departure-only/max-six semantics have a correct arrival-search implementation and evidence. Route454 is absent from retained coverage, not proof of no service. Walking/A12 stay isolated. Publication, main merge, hosting/resource/recovery experiments, any spend and recurring monitoring require the specific adopted-roadmap authorization; do not rerun completed publication instructions from historical checkpoints.

Latest actual published check13Oct23:48London: public Chromium opened source06 with current real responses, two hospital journey reads returned6+6options and exact itinerary/back; one live read returned18locations, loaded map tiles, group and selected NTA GPS card. Widths320/360/390/430/768/1440 showed no horizontal overflow; no JS errors or app credential headers. Twelve native-TLS tile URLs/max2 tasks stayed within32/two ceilings, and all jobs closed. Public HTML/JS/CSS bytes matched the frozen local build; ordinary pushCI38478920214 also passed. Initial zero-API Chromium failures and the local NSS read-only/trust fix are preserved separately, never with HTTPS validation disabled. No recovery was needed or rehearsed. These are public technical-preview/emulated browser proofs; field/device/walking/host/resource/elapsed-pilot gates remain.

## Bus coverage investigation — 15 October

Read-only diagnosis found a real route22 bus reaching the gateway outside the default Mayo bounds. The earlier empty snapshot coincided with latest GPS observations exceeding180seconds; the freshness filter was correct. A compact UI correction distinguishes bus/train feed counts, selected-route coverage and viewport absence without loosening freshness or touching collection. [Diagnosis and evidence](evidence/bus-coverage-20261015/README.md).
