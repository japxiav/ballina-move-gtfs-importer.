# A12 bounded-frontier premature-prune regression

This branch targets **only** the reviewed `fix/a12-routing-preflight-pareto` branch; it does not change `main`, data, the private Edge Functions deployed in Supabase, or paid-provider limits.

## Reproduced failure

With 23 safe paths from different vehicles and one inferior snap-confirmation path already filling the 24-label frontier, an incoming **better snap-confirmation** label was discarded by the early two-unrelated-vehicle shortcut. The normal bounded selection reserves the earliest/lowest-walking/latest-leave labels **within each snap-risk class**, so the shortcut was skipping the selector's own rules.

A new `routing/tests/a12DominanceGuardRegression.test.cjs` probes the real compiled private `addBest` function without changing its production exports. Before the change, the assertion failed. Removing only the unsafe shortcut makes the test pass. Normal Pareto dominance and the 24-label cap remain unchanged.

## Integrity and review

- Canonical engine TypeScript and Deno mirror updated identically (apart from Deno import extensions).
- Official v0.10 candidate and A11 canary artifacts changed only by removal of the corresponding compiled shortcut. No private endpoint or deployed function was modified.
- On the reconstructed offline checkout, 321/321 routing tests and 11/11 staging tests passed; compiled module parity was 16/16 and the A11 canary builder verified. The remote GitHub CI for **this** branch is the authoritative integration gate.
- This change does **not** resolve the A12 performance regression found by Codex, and the fixed 24-label search remains approximate. **Do not merge into `main` or deploy for passengers without further review, benchmark and real integration tests.**
