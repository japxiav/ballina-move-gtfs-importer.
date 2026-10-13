# Authorized live gateway hosting preparation

The user explicitly answered **sim** to hosting the read-only gateway after reviewing the concrete map/PR27 result. This authorizes that new read-only service; it does not authorize a paid plan, private routing endpoint, DB/collector change, GTFS activation or bypass of A12 acceptance.

Branch `ops/live-gateway-hosting` derives from `feature/live-map-data` evidence306846f and stays separate from A12. Files prepared:

- `render.yaml`: one Docker web service, explicitly **free**, Frankfurt, dedicated hosting branch, automatic deployments disabled, root health check and internal port10000.
- `web/Dockerfile`: official Node/Python images fixed by verified manifest digests, frozen npm lockfile and a runtime UID10001. Only compiled frontend, read-only gateway and the already-public publishable-key health workflow enter runtime. No Node/npm, checkout, private credentials or optional build-stage proxy CA in runtime.
- `.dockerignore`: strict context allowlist excludes local files, environment files, caches and unrelated backend data.
- `scripts/deploy_live_gateway_render.py`: agent-only API helper. Credentials come from secure `RENDER_API_KEY`; fixed Render HTTPS endpoint, redirects refused, bounded responses, sanitized errors, explicit free service payload. Missing/invalid credentials or ambiguous workspaces cause no write. Creation requires clean committed/pushed hosting branch and refuses to overwrite or duplicate existing named services. New service creation must be followed by actual deployment/readiness/browser verification; a returned ID is not proof it works.
- Nine offline deployment contracts join the23 gateway contracts:32 pass without Render/provider queries.

## Container verification

Official base pulls verified checksums. Node digest `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`; Python digest `sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641`. Docker builds include production TypeScript/Vite and standalone builds. Build-stage proxy CA is mounted as a secret and used only for Node TLS trust when present.

Cloud Docker DNS initially could not resolve the configured proxy hostname. The successful build supplied that same hostname's existing address via supported `--add-host`, preserving the configured proxy, TLS verification and lockfile integrity. No external proxy bypass. An initial unprivileged runtime check exposed file/directory modes; the image now explicitly sets app directories0555/files0444 before switching UID. Failed attempts were corrected and retained as diagnostics.

The final image runs with read-only root filesystem, all capabilities dropped and no-new-privileges. HTTP root returns200 with CSP. Actual gateway retrieval at `2026-10-12T22:05:28.529672Z` returned30 official vehicle positions, bus/rail ready and departures unavailable; this partial source failure is displayed explicitly, with no substitutes. Chromium rendered that exact container build, real OSM tiles, selected-vehicle details and all six widths without overflow/page/CSP errors or browser credentials. The internal browser transport adapter passes actual container bytes because of the platform's localhost proxy restriction. This is not public host proof.

## Remaining external prerequisite

No Render credential or connected hosting account is available. Actual environment binding names and saved metadata were checked; only existing GitHub authentication is present. GitHub has only the Pages environment, and secret metadata cannot be read through the integration. The platform exposes no authenticated forwarding or hosted-deployment tool. Cloudflare's official connector requires a direct edge TCP route, unsuitable for the provided HTTPS-proxy route; no alternate tunnel was opened.

A secure requirement for `RENDER_API_KEY` targeting only `api.render.com` was saved in the environment draft. Existing egress/presets were preserved; API and Render service domains added. The user must securely connect that credential and review/save/publish the environment configuration. Do not request values in chat, infer a credential from permission alone, or repeat permission requests after the user's authorization. Once the binding is usable, inspect the connected workspace, create only the reviewed free target, wait for the host's deployment, verify actual same-origin `/api/live` plus browser/tiles/mobile and record its real URL.

**No Render service has been created and no continuously-live public URL is claimed.** Existing Pages map remains the explicitly identified official snapshot. Free hosting can sleep when idle; platform cold starts/availability are separate from this application's 30-second active polling and do not justify claiming passenger/pilot reliability.

## Render transport diagnosis and authorized runner — 13 October 2026

The user connected `RENDER_API_KEY` in the Codex environment; binding metadata and actual presence confirm it is provisioned. Native urllib and curl, preserving the provided proxy and verified TLS, receive HTTP403 **Cloudflare HTML blocking**, before a Render JSON response. This does not establish whether the key is valid or invalid. No redirect/TLS/proxy bypass or CAPTCHA workaround was attempted.

Manual unauthenticated GitHub Actions diagnostic38325360992 reached the official API and returned401 JSON, with no Cloudflare block. Its sanitized check annotation reports `credentialsUsed:false`, `deploymentAttempted:false`, `runnerBindingPresent:false`. The cloud log download host is unavailable; standard GitHub check annotations expose only sanitized diagnostics through the already-supported API. No credential was copied/extracted from the Codex proxy binding into GitHub.

The reviewed workflow now has an explicit manual `deploy_live_gateway` input. Deployment requires the hosting ref, full reviewed commit equal to the dispatch event SHA, successful full offline web/container validation, and a fixed concurrency group with cancellation disabled. The helper requires local HEAD = expected input = GITHUB_SHA = remote branch tip before the create POST. Existing services are not overwritten or duplicated; there is no paid upgrade or automatic retry/recreation.

`scripts/run_live_gateway_deployment.py` observes the created free Docker/single-instance/no-auto-deploy service and checks its actual live deployment commit before opening the public app. It does not pass the Render key to the browser step. `web/scripts/check-live-host.cjs` retains configured proxy/TLS when present, launches with minimal environment, checks source availability/collector health and genuine GPS timestamp bounds, treats train observation time as unknown, checks real OSM tiles, six widths and preserved demo search/details. Empty valid feeds remain empty; the report records actual position counts rather than fabricating movement.

37 offline contracts now pass (23 gateway +14 deployment), static boundary/readiness2, unchanged root50Python/strict API/mock/body11 checks, and independent read-only review. Regression probes caught and fixed dispatch-vs-branch commit races and concurrent service creation. Actual hosting/browser acceptance still requires execution; no Render service is claimed created.

**Remaining prerequisite:** a protected repository Actions secret named `RENDER_API_KEY`. The Codex binding is scoped to the Render API and is not transferred to another destination. The runner has no binding at the verified probe. The user was given the secure repository secret field URL and asked to report only `pronto`, never the key value in chat. Hosting authorization remains valid and need not be requested again. Once the runner binding is present, the agent can dispatch the reviewed workflow and verify its actual URL/results without user commands or local installations.
