# Product mission evidence

All screenshots are local unpublished candidate captures. The later `candidate-live-hospital-mobile.png` and `candidate-live-vehicle-mobile.png` use actual current public-backend responses at13Oct21:54London, without fixtures or a frozen clock, through an internal-only public-gateway relay; they do not depict a deployed frontend. Hospital images replay official14Oct responses. The early `candidate-vehicle-mobile.png` and `candidate-vehicle-desktop.png` use illustrative vehicle fixtures and stub tiles. Only `candidate-real-map-mobile.png` and `candidate-real-vehicle-mobile.png` replay the actual43-position13Oct21:11UK capture, with native-TLS tile PNGs delivered to the browser and partial tile loading. None depicts a deployed candidate or continuous live tracking.

Tested code: `06b72b428fa623e7daf4d244b4851683506b78d0`. Four code Draft PRs45–48 have green exact-head web checks, including offline gateway/browser/static/unprivileged-container validation. Main and the published3a preview were not modified.

Official NTA schedules/positions: CC BY4.0 (https://creativecommons.org/licenses/by/4.0/), Irish Rail reported locations (https://api.irishrail.ie/realtime/), map tiles OpenStreetMap contributors (https://www.openstreetmap.org/copyright).

Early UI/stub captures are from39f30e6 before the later tile-recovery patch; the actual-official-map replay is from the final06b72b4 source. Both proof JSONs carry their exact capture source.

See `validation.json`, `github-checks.json`, `actual-hospital-comparison.json`, `actual-live-capture-receipt.json`, `offline-scenario-matrix.json` and the browser proof JSONs. Historical mocked deployment output inside test logs is not a real operation. Raw retained tables, failing/red and passing logs remain outside the checkout in `/workspace/.ballina-execution/product-mission/`; their final hashes and counts are recorded, while GitHub Actions provides durable exact-head validation records. `smoke-tile-budget.cjs` is a prepared verification-only dispatcher with an offline proof of32 unique requests/two parallel tasks. The supplied tile fetcher must separately enforce TLS/no-redirect/PNG-size rules; this dispatcher is not deployed and does not cap visitors globally.

No actual device GPS, physical walking/accessibility, hosted CPU/RSS or7day pilot claim.

The temporary internal diagnostic servers on5180/5181 were stopped. `diagnostic-shutdown.json` records a passive no-listener check after terminating the verified own static-preview process; a tool exit alone was not used as shutdown proof. The existing public Render preview was unaffected. The documentary handoff and current-backend supplement also received independent approval, including confirmation that5181 had closed.
