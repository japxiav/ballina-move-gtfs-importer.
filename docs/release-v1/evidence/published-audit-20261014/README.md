# Reviewed technical preview publication — 14 October 2026

Owner explicitly authorized audit, corrections and publication without another confirmation. Published source `3619cc40929cea2fb540ff6b561876ed82c55969` after exact-source successful CI and completed CodeRabbit full review without actionable findings. Main was not merged; only the existing hosting branch advanced. Existing free Render service and existing journey-api updated; no database migrations, credentials, transport-api, plans or paid provider calls changed.

Render deploy `dep-db7j0p25b2lc7384pojg` is live. journey-api version 5 is ACTIVE, with actual management-fetched source bytes matching the reviewed candidate. Public HTML, JS and CSS match the tested build byte for byte.

Actual HTTPS Chromium verification passed with real public API responses and no clock override or fixture substitution. Two journey reads, one live read, five catalog reads; twelve real map tiles fetched through a verified-TLS dispatcher limited to two concurrent images. No TLS bypass, JavaScript errors, credential headers, foreign requests or leftover tile jobs. Widths 320, 360, 390, 430, 768 and 1440 had no horizontal overflow. The October 15 Ballina–Mayo Hospital query returned six scheduled options, including route 420, 08:00–08:52, stop 15109; itinerary and back navigation worked.

The live feed returned 61 train positions and an empty bus feed. Train observation age remains unknown; retrieval time does not establish GPS freshness. Departure real-time feed unavailable. No walking directions or real-time boarding/cancellation assurance inferred.

Rollback target was retained: Render deploy `dep-db7b4uad0e5s73fv1i4g`, source `06b72b4`; previous Edge source preserved outside Git in the execution evidence directory. No rollback was necessary or exercised. Publication controllers are historical evidence, not reusable authorization to republish. Exclusive intent files prevent blind mutation retry.

This remains a technical preview. The shared TCP-peer rate-limit risk, hosted performance, complete disaster recovery and field validation remain unresolved; regional launch is not approved by this smoke test. Sequence-grant revocation is still only a proposal and was not applied.
