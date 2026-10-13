# Evidence index and reproducibility

Evidence root: /workspace/.ballina-execution/release-v1 (preserved cloud workspace). SHA256 hashes of retained files and source/run provenance are recorded in evidence-manifest.json there. Logs remain separate from source; earlier RED/error/exploratory logs are retained and are not described as passing.

| Artifact | What it proves / limit |
|---|---|
| s0-runtime-and-service-identity.json; render-current-config.json | Actual read-only runtime/service versions/config; not CPU margins |
| deployed-function-source-proof.json | Both downloaded deployed function source hashes match main22bf89c; v2ACTIVE after download |
| integration-routing.log / integration-web.log / integration-gateway.log / integration-staging.log / integration-root.log |414/116/63/11 suites and root50 at compositioncbd1152; exact final root adds10 observer tests |
| final-*.log / final-source-manifest.json | Exact frozen candidate repeatability/CI evidence when completed; absent entries are not assumed green |
| benchmark/reviewed-samples.json |9 serial alternating samples/version, official1518trips/30115times, CPU+10.9%/RSS+0.2%, zero HTTP; not targetDeno |
| regional-matrix.json + REGIONAL_ACCEPTANCE_MATRIX.csv |32 local capture queries,28options/4empty, zero HTTP, no field acceptance |
| observation-one-public-sample.json | One public HTTP/data sample04:05:26Z; bus empty/rail+departures ready; no browser/SLO claim |
| observation-dry-run.json / observer test logs | Defaultzero HTTP/manual bounded observer; clock/watchdog regressions covered |
| s1/s2/s4-*-red/green logs | Explicit before/after regressions; older failure retained separately |
| ../real-search/direct-public-browser-proof.json | Actual published643bc52 browser/search/map/tiles and widths320..1440 at02:07:44Z; historical observation |

Maintainer checks (agent executes, not a passenger installation request): PATH includes routing/node_modules/.bin; bash scripts/run_tests.sh; routing npm test and npm run verify:artifact; node --test staging/tests/*.test.cjs; web npm run test:gateway, npm run build:standalone, npm test (PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium), npm run test:preview. Browser tests use controlled fixtures labelled by tests, never prove current external data availability. Candidate CI must reference the PR's immutable head; deploy/probe jobs skipped by design.

Independent oracle explores complete bounded tiny graphs then pairwise Pareto, separately from production pruning;1642 comparisons include120 seeded and11 explicit datasets. Review discoveries (strict ID aliases, hanging cancellation/lateEOF, parallel sibling failure, observer sample clock/DNS) were corrected with meaningful regressions. Full regional field/original auditPDF evidence absent is explicitly UNVERIFIED.

Remote source Drafts: PR33 all applicable checks passed; PR34 routing checks passed; PR35 has one successful web run and one failed PR web run on the same source head. Job metadata identifies the browser stage; redirected log download was unavailable, so the individual failing assertion remains unclassified and is not silently marked resolved. Exact compositionPR36 is validated separately. No failed run is erased/rerun merely to obtain a green badge.
