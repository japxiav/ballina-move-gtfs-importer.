# Main merge candidate: independently approved changes

The user authorized merging changes on 12 October 2026 only if they are correct. Independent review rejected merging the existing PR15–23 integration chain because it inherits an unresolved A12 CPU/RSS regression. This branch is based on original main `4c40f4aa0ce26958a0fbbadb62110dab0b3b52a6` and excludes that engine change.

Included:

- A11 explicit reviewed service date and response-date validation (`8aa2d6f`). The workflow remains manual; no paid canary was run.
- A13 active-feed-window validation and bounded importer gateway processing (`2c46e1d`).
- Canary authenticated-body limits (`2b1cad2`) and strict scenario identifier validation (`d9915e3` source/suffix and tests only). The canary was rebuilt using the **original main** official artifact prefix after verifying its 16-module parity.
- Complete English fixture frontend from reviewed `0e7ee92`, including compact mobile controls, existing notices and navigation/error/recovery tests.
- Reviewed offline CI path filters and their regression contracts; no live workflow or schedule activation.

The existing independent source branches were merged without rewriting or deleting them. Only shared append-only engineering log conflicts occurred; the full `049823c` history was retained. Latest reviewed web/CI/canary-specific files were copied onto this new composition. Original main routing sources, mirror, candidate artifact, engine caps/ranking and paid budgets are unchanged. A12 and PR15–23 remain preserved as draft work; no claim that the performance gate is solved.

Required validation for this new composition: routing build/full suite; official 16-module artifact parity and regenerated-candidate equality; canary build verification; importer/gateway types, body bounds and mocks; sealed staging; web build/68 browser tests/static boundary; independent final composition review; remote offline CI. Results must be recorded after execution rather than inferred from the old integration run.

Merge authorization does not authorize Supabase/backend deployment, GTFS import/activation, paid requests, production transit guidance or publication of private services. The existing Pages fixture-only branch remains separate and already published under earlier authorization.

## Validation completed for source candidate5369a2a

All groups ran sequentially on `5369a2aeddfe48eca2caa836102622d3f69bc66a`:404 routing tests,50 Python tests, strict API type checks and old request mocks,11 importer-body contracts,11 sealed-staging contracts,68 desktop/mobile browser checks and1 static-preview boundary check. Routing/web production and standalone builds,16-module parity, regenerated official-candidate equality, canary parity and clean tracked tree passed. No failures or skipped tests. Evidence `/workspace/.ballina-execution/main-approved/validation.json` and underlying logs.

Independent read-only review approved the new composition:32 routing source/mirror files and official candidate unchanged from main,21 frontend/workflow paths identical to the reviewed English snapshot, exact original-main canary prefix plus hardened suffix, no removed main paths, no ancestor from the blocked A12 integration chain, and complete historical log retained. All three push workflows on5369a2a passed:38304077120 (web),38304077229 (importer/gateway),38304077355 (routing). PR24 checks must also complete before merge. This documentation follow-up does not change application source, tests, workflows or artifacts.

The standalone fixture HTML still matches published Pages SHA256 `30176300235522c009aaebcd12bb3af650364262f7b2d926ba9bd0699e92570a`; no new public deployment is needed for this main integration. The A12 gate remains failed in the excluded drafts. Merge availability and permission must be respected; do not bypass branch protections or use admin override.
