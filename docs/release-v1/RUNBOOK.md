# Operations and controlled recovery

Primary preview: https://ballina-move-live.onrender.com/ ; map #/live. Free Render can sleep. No platform forwarding is provisioned; localhost is only internal validation.

On failure, maintainer first records UTC, exact deployed commit/function version/feed validity, public HTTP/data results and actual browser behavior. Distinguish cold start, source empty/unavailable, quota429, safe503, expired feed and invalid query400. Never replace real failures with fixture success. Fixed public observer scripts/release_observation.py is dry-run by default; --once permits at most3 reads, 1MiB each, response deadlines and a47s worker watchdog including DNS. It creates no monitor, retry or keepalive; http shell success does not certify browser rendering. Operator code should run it, not demand passenger commands.

Evidence retention: sanitized metadata/logs under /workspace/.ballina-execution/release-v1; no tokens, headers, coordinates, personal journey queries or exception addresses in observation output. Existing hosting log/processor retention policy still needs owner acceptance. Continuous monitoring/SLO/error budgets and recurring costs are not activated.

Reviewed future recovery target: immutable Render643bc525c1ab5f79c694259002258ed3af8468f6; current journey-api v2 sources match baseline hashes. Existing updater checks fixed free service, exact reviewed SHA, clean tree and no auto-deploy; Edge publication checks fixed project/function and exact current version. A rollback would republish retained v2 code as a new version, not reset a version counter. Maintain DTO compatibility across update order; opaque-ID links must fail closed if no matching itinerary is present. No controlled production restore has been exercised and no rollback success is claimed.

Before any future rollout/recovery mutation: freeze/review exact source, validate complete suites and consumer policy, prepare old/new source identities, owner-authorized window, offline/online abort criteria and actual browser verification. Human final v1 GO follows gates, not automatic CI success. No create/delete/plan upgrade/feed activation under this runbook.
