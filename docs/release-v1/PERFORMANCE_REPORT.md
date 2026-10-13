> Current13October2026 technical preview: published source `06b72b428fa623e7daf4d244b4851683506b78d0`, Render deployment `dep-db7b4uad0e5s73fv1i4g`, journey-api version4, main `f38826625e08fe6bcd92073df45685fa36bbf7cf`. The owner-approved preview update passed actual public-browser verification; see [PROGRESS](PROGRESS.md) and [published evidence](evidence/technical-preview-20261013/README.md). Regional NO-GO remains. Previous sections are historical phase evidence; do not repeat completed publication/rollback steps without fresh specific approval.

# Performance evidence / no target-host certification

S1 full captured official snapshot1518trips/30115stopTimes, same Node24.19 machine and queryBallina→Hospital15108/time02:59/max2changes. Nine fresh processes per version, alternating serial order, no warmup/HTTP/providers. CPU measured around solve (candidate includes six nativeSHA256 digests); wall likewise; OSmaxRSS is whole process peak including parsing.

| Version | Median wall ms | Median CPU ms | Median peak RSS MB |
|---|---:|---:|---:|
| main22bf solver | 45.88 | 76.77 | 77.37 |
| S1 candidate | 50.73 | 85.12 | 77.52 |

Candidate CPU changes+10.9%, peak RSS+0.2%. This correctness fix is not a performance optimization: results intentionally remove dominated detours and restore later valid trips. All samples/outliers and compiled source hashes remain in /workspace/.ballina-execution/release-v1/benchmark/reviewed-samples.json. No target-platform margin or latency percentile is certified from these samples; G6 remainsUNVERIFIED. Earlier six-sample exploratory results are retained separately. Caps150000work/25000labels/max6, buffers60/120 and max36hours are unchanged.

The actual public baseline queries19.236s and5.219s are two distinct queries with unverified cache/cold conditions, not p95 or uptime. BackendCPU is not network wall latency.

A12 is separate DraftPR26, not this solver. Prior workload1518trips/30360times nine rotating Node measurements: CPU1864→1636ms/RSS82.2→79.8MB, local gate only. No EdgeDeno or paidwalking measurement/rollout.
