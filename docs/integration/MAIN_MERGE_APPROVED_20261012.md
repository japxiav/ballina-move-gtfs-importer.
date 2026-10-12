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
