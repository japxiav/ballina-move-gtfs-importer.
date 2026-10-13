# Corrected schedule performance — offline only

Base/reference: PR36 `138951b`; main `22bf89c`; A12 PR26 is separate and unchanged. Workload: official captured1518trips/30115stop times/227stops; Ballina555051→Hospital15108,2026-10-13,02:59,max2changes. Node24.19, same machine,9fresh processes/version, serial rotated order, no warmup/network/providers. SolveCPU/wall include native IDs; maxRSS is whole-process peak including parsing.

The earlier+10.9%CPU is one retained observation, not a deterministic percentage. New two-version reproduction measured72.120→87.920ms(+21.9%); the subsequent three-version series73.147→83.826ms(+14.6%). The reusable compiler/runner series below measured+3.0%. All samples/ranges/hashes are preserved; variation is not hidden by choosing one result. The regression's direction appears in these series, but its exact size is noisy.

| Reusable runner | Main | Frozen PR36 | Optimized |
|---|---:|---:|---:|
| MedianCPU ms |74.620|76.878|61.234|
| Medianwall ms |45.418|46.663|36.440|
| MedianpeakRSS MB |75.652|78.137|77.031|

Candidate vs corrected PR36:CPU−20.3%,wall−21.9%,RSS−1.4%; complete public journeys, order, IDs, operational metadata and times are equal. CandidateRSS is+1.8% vs main in this series, not claimed zero-regression or memory-leak proof. No hostedEdge margin/p95/SLO certification.

CPU profile identified repeated dayAt/calendar work plus solver allocation. Changes: query-local5date and service memo (Map preserves key types); modesSet; display metadata once; direct alight-index loops preserving every work increment; reuse completed operational identity. No global cache by feed version, pruning change, limits increase, weaker IDs, skyline change or A12 integration.

Validation: existing independent1642exhaustive comparisons and all original selection tests pass; added mutations under the same feed version and shared-calendar exception tests. Benchmark script compiles immutable Gitrefs, disables worker fetch, preserves every sample, compares complete candidate journeys against corrected PR36. It fails if equality or medianCPU/wall/RSS versus PR36 regress. MainCPU/RSS flags are reported separately; main produces different/incorrect selection and positional IDs. This policy does not alter A12's separate gate. Target-host proof remains required.

Maintainer reproduction: scripts/benchmark_scheduled_journeys.py accepts the official captured JSON, an unused evidence output path and an immutable candidate ref; default9repeats. DatasetSHA256/source/compiled/runtime/row counts are in the output. Existing capture and raw series are preserved under /workspace/.ballina-execution/pilot-next/benchmark; no user installation or private credentials required.
