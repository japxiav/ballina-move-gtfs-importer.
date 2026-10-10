# Ballina Move A11 · Phase 2: two-request live walking smoke

This adds a **manual-only** GitHub Actions workflow for the existing A11 smoke script. It does not change the live or synthetic Supabase staging functions, public routing or the existing CI workflow.

## Security and cost boundaries

- Manual `workflow_dispatch` **only**, with an explicit `YES_UP_TO_2_REQUESTS` input. The default is `NO_DO_NOT_RUN`.
- The job runs only on `main`. It checks out `main` with persisted checkout credentials disabled and has read-only repository permissions.
- The Stadia key is read from GitHub Actions **repository secret `STADIA_API_KEY`**, not repository files, PR input or console output. Never paste the key in a public issue, PR, screenshot or chat.
- Missing key stops **before** any provider call. The existing script makes at most two sequential route queries for fixed public sample coordinates in central Ballina, with no retries, and reports aggregate metrics.
- Each manual invocation may consume **up to two billable provider requests**; GitHub Actions concurrency prevents overlap but does not enforce a cumulative billing quota. Check the Stadia dashboard, account plan and alerts before running, and do not repeatedly rerun.
- The existing routing validation CI must pass separately. The successful live smoke is *not* proof of safe sidewalks, pedestrian accessibility, correct transit itineraries or successful Supabase staging integration.

## How to run after review and merge

1. Open GitHub → repository **Settings → Secrets and variables → Actions → Repository secrets**. Add `STADIA_API_KEY` if not already present. Use the key from your Stadia account; do not share it in chat.
2. Check Stadia routing balance and any spending limits.
3. Open GitHub **Actions → A11 private Stadia walking smoke (two-call maximum) → Run workflow**.
4. Select branch `main`, change the confirmation input from `NO_DO_NOT_RUN` to `YES_UP_TO_2_REQUESTS`, and run **once**.
5. Review the job logs for two provider routes with real geometry, distances, duration, endpoint snap warnings and any failure messages. Never paste credentials into the logs.
6. If the results are good, proceed to **isolated** authenticated staging with real walking and compare against GTFS in Ballina, Castlebar and Westport. Do not convert the v6 synthetic staging in place.

## Completion gates for Phase 2

- [ ] CI from GitHub has passed with this workflow included.
- [ ] The secret is configured and account cost limits verified.
- [ ] Two manual real-provider routes completed successfully on `main`.
- [ ] Their metrics and coordinate snapping were inspected, with no invented footpath geometry.

Until these gates pass, record `A11_PHASE2_STATUS=pending_live_provider_verification`.
