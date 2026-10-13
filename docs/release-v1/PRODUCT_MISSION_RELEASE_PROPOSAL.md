# Proposal: update the existing technical preview only

**Not authorized or executed. Regional passenger release remains NO-GO.** The adopted PDF section2 requires specific approval to “Trocar a imagem/versão ativa do Render” and, before that action, an exact action, impact, cost cap, versions, tests, risk, execution window, backup and rollback. The previous permission published3a96758 and has already been completed.

| Item | Concrete proposal |
|---|---|
| Action | Update only the existing Render web gateway/frontend to reviewed code `06b72b428fa623e7daf4d244b4851683506b78d0`, through the existing manual reviewed-source publisher |
| Target / impact | `srv-db6nhvrbc2fs739pb7mg`, `https://ballina-move-live.onrender.com/`; every preview visitor receives the new English search/cards/local-tools/tile-recovery interface; possible brief restart |
| Existing source | `3a96758b87d33908635f03d2e833cd5742609997`, deployment `dep-db76rdc9v7es73alv28g` |
| Candidate / branches | Source06b72b4, stacked Draft PRs45→46→47→48. Main remainsf388266. If approved, hosting branch must advance from3a96758 to exact06b72b4 by fast-forward, with matching immutable publisher input. No main merge |
| Services excluded | Supabase journey-api version4 and transport-api, credentials, database, active GTFS, collectors, cron, plan and recurring monitoring remain as they are; backend/source files are byte-identical to3a96758 |
| Cost cap | $0 additional planned cost; retain the existing free service and current CI workflow; no new service, plan change or paid pedestrian query. Abort if free plan/source/service preconditions differ |
| Preconditions already passed | Standalone build;182 final browser checks,95 gateway,70 root Python,414 routing,11 staging, strict simulated API/oracle1642 and16module parity/rebuild; independent reviews; exact-head PR48 web CI including unprivileged Docker build/verification green |
| Practical limits | Two serial exact-stop reads for the hospital place; anonymous host/NAT limits remain a regional P1. Free host may sleep. Walking/accessibility, arrive-by and exact vehicle service/stops/path/ETA remain unverified/unsupported. Local screenshot replay and emulated location are not real device tests |
| Window | One user-approved execution window, maximum30 minutes for build/publish/verification; fixed small read-only smoke, no recurring monitor or load generator |
| Before mutation | Re-read actual service/plan/source/Edge metadata and preserve sanitized receipts. Confirm previous deployment3a96758 remains available for reversal; do not copy or rotate secrets |
| Verification after publication | Confirm actual immutable Render commit and live status; actual HTTPS browser desktop/mobile opens hospital-place search, exact detail/back, map groups/card/age, and failure labels. Use at most four exact journey GETs, eight live API GETs (including normal browser polling during the fixed smoke), and at most32 unique OpenStreetMap tiles with at most two simultaneous tile requests in the dedicated verification controller. These are verification-window limits, not a global limit or capacity guarantee for preview visitors; no paid calls. Confirm Edge source version/hashes unchanged |
| Rollback | If immutable source, readiness, browser navigation, credential boundary or protected source preconditions fail, restore previous Render deployment `dep-db76rdc9v7es73alv28g` at3a96758 and recheck. Require an available provider rollback operation before publishing; no force push/history deletion or Edge/DB rollback is needed because those components are unchanged |

The user can approve this limited technical update while the regional launch gates remain incomplete. Approval must explicitly cover the update and conditional rollback. Keep the four code PRs Draft and main unchanged unless separately authorized. No new secret needs to be created or sent by the user.
