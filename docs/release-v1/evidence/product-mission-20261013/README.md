# Product mission evidence

All screenshot images are local unpublished candidate captures; hospital14Oct official replay, map13Oct21:11UK retained official replay. Map imagery is native-TLS PNG replay, partial tiles, not a public candidate or continuous live tracking.

Tested code: `06b72b428fa623e7daf4d244b4851683506b78d0`. Four code Draft PRs45–48 have green exact-head web checks, including offline gateway/browser/static/unprivileged-container validation. Main and the published3a preview were not modified.

Official NTA schedules/positions: CC BY4.0 (https://creativecommons.org/licenses/by/4.0/), Irish Rail reported locations (https://api.irishrail.ie/realtime/), map tiles OpenStreetMap contributors (https://www.openstreetmap.org/copyright).

Early UI/stub captures are from39f30e6 before the later tile-recovery patch; the actual-official-map replay is from the final06b72b4 source. Both proof JSONs carry their exact capture source.

See `validation.json`, `github-checks.json`, `actual-hospital-comparison.json`, `actual-live-capture-receipt.json`, `offline-scenario-matrix.json` and the browser proof JSONs. Historical mocked deployment output inside test logs is not a real operation. Raw retained tables, failing/red and passing logs remain outside the checkout in `/workspace/.ballina-execution/product-mission/`; their final hashes and counts are recorded, while GitHub Actions provides durable exact-head validation records. `smoke-tile-budget.cjs` is a prepared verification-only dispatcher with an offline proof of32 unique requests/two parallel tasks. The supplied tile fetcher must separately enforce TLS/no-redirect/PNG-size rules; this dispatcher is not deployed and does not cap visitors globally.

No actual device GPS, physical walking/accessibility, hosted CPU/RSS or7day pilot claim.
