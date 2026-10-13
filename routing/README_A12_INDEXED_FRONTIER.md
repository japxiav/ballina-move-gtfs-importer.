# A12: bounded frontier performance correction

Based on safe maincafec985 and the logically reviewed0fc606c fixes. Preserves later-leave, snap/history Pareto dimensions, limits24/36 and walking-call ceiling12. Restores preflight/budget fixes; no live/provider request or deployment.

The selector uses stable insertion, exact cached time/walk/leave ranks and integer membership for its bounded25 labels. Caches retain only the current index per stop/query. Immutable next groups are copied directly; legs and boarding instructions are materialized only when needed. Adjacent equivalent continuation boardings retain the first instruction, exactly as the original dominance step would; the cap36 and original order occur before this optimization.

Correctness:148500 frontier insertions and360 complete queries (all0/1/2 transfer budgets) compare identically to0fc606c. Six persistent regressions cover truthy snap normalization, first boarding vs continuation, first-instruction retention and safe snap alternatives. Original assertions/timeouts are preserved. An intermediate full run exposed two legacy internal-state fixtures with missing latest-leave fields; native-sort tie behavior was restored and the same assertions pass.

Controlled original1518-trip/30360-stop-time workload, nine sequential rotated-order runs on one machine/Node, no HTTP: main medians730ms wall/1003ms CPU/76.1MB OS peak RSS; old corrected candidate6845/7329/246.4; new candidate676/1040/84.1. All three results identical in all nine runs. Relative to old corrected candidate: roughly86% lower CPU and66% lower peak memory. Compared with main: wall lower, CPU3.7% and peak memory10.5% higher. These small residual differences and nine-run sampling do **not** establish zero regression or hosting/pilot readiness; strict baseline/real-host release acceptance remains explicit, not silently relaxed. Evidence `/workspace/.ballina-execution/a12-indexed/controlled-benchmark.json` and per-run logs.

Read-only independent review approved selector/cache correctness and the adjacent-continuation proof. Full final routing/parity/staging results and remote CI must accompany the published PR. No main merge or passenger deployment is claimed by this candidate.

## 2026-10-13 follow-up: local CPU and RSS gate passed

The strict 24-to-25 path now computes selection against virtual insertion ranks, without temporary 25-element arrays or a discarded selection array. Exactly one exclusion is remapped directly. Uniform walking ranks share a frozen identity order, while retained nonuniform/leave ranks use 24-byte arrays. Every update copies cached orders before insertion. Ties, mixed snap classes, histories, Pareto dimensions, caps24/36 and the12-walk ceiling are unchanged.

The same fixed original1518-trip/30360-stop-time workload, nine serial rotated-order runs, now records main medians1410ms wall/1864ms CPU/82.2MB OS peakRSS, corrected reference12882/13754/239.1, and candidate1070/1636/79.8. All nine outputs are identical. Relative to main: CPU12.2% lower and peakRSS2.9% lower; both local zero-regression criteria pass. These are synthetic Node measurements, not Supabase/Deno or passenger/pilot acceptance. Earlier failed measurements remain preserved. Evidence: `/workspace/.ballina-execution/a12-virtual/byte-ranks/controlled-benchmark.json`.

148500 frontier insertions and360 complete queries again match the corrected reference;16-module and private-canary parity pass. The437 existing routing tests and11 staging tests pass; a new regression checks repeated caps, an earlier insertion, immutable previous groups and independent queries. Read-only independent review approved virtual ranks, frozen sharing, byte bounds and current-cache retention. An initial full run had436/437 because the Deno source mirror was not yet synchronized; its exact extension-only copy was fixed and the full437 rerun passed. No assertion, threshold or timeout was weakened.

This branch remains separate from the public stop-to-stop schedule gateway. No paid walking request, private canary deployment, main merge or real-host/pilot promotion is claimed. The remaining release gates require their own evidence.
