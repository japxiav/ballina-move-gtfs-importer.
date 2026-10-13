# Release decision: NO-GO for reliable public regional v1

Technical preview remains usable for supported official scheduled searches and the separate live map, with limited coverage and free-host availability. Reviewed corrections are in Draft, not published. No final release is authorized by merely adopting the PDF.

| Gate | Status | Evidence / owner |
|---|---|---|
| G0 provenance | PASS | Render643bc52, main22bf89c, Edgev2 exact downloaded source hashes, active feed identified / Codex |
| G1 journeys | PARTIAL | Hospital fixes, independent1642 oracle,32 regional local cases; field/completeness pending / Codex + testers |
| G2 walking | UNVERIFIED | Excluded; entrances/geometry/access unverified / regional testers |
| G3 quality | PARTIAL |414routing/116browser/63gateway/11staging, oracle, reviews; final frozen-SHA CI packet must be checked / Codex |
| G4 realtime | PARTIAL | Own cancellation freshness fixed in candidate; public old source/full identity matching incomplete / Codex + operator data |
| G5 security | PARTIAL | Bounded reads/redirect/error/privacy fixes; anonymous quota P1 remains / Codex + owner |
| G6 resources | UNVERIFIED | S1CPU+10.9% local, A12 separate local proof; no Deno-host margin / Codex + owner |
| G7 operations | PARTIAL | Manual observer/runbook; no recurring SLO window or restore rehearsal / owner + Codex |
| G8 UX/legal | PARTIAL | English compact mobile and browser tests; real-device accessibility/terms pending / owner + reviewers |
| G9 external proof | UNVERIFIED | No field/pilot7days / regional testers |
| G10 release | BLOCKED | Preceding gates and human finalGO absent / owner |

No demonstrated new P0 found in scoped code reviews; no full security certification. Open P1: anonymous quota/fairness, actual host resource/availability proof, field/pilot evidence. P2: legal/source retention/real-device accessibility review. Owners/actions are in RISK_REGISTER.md. Keep emergency caps and no unsupported walking/RT claims.

Safe automation completed: code corrections, negative contracts, local integration, source provenance, offline regional replay, manual observation and prepared evidence. Remaining decisions require a concrete reviewed staging/consumer-policy/monitoring/restore proposal plus authorization; physical field validation needs genuine observations. Final GO cannot be inferred from successful build.
