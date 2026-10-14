# Authorized technical preview update —13October2026

Owner explicitly approved updating the existing technical preview to reviewed06b72b4 and conditional reversal. The grant is completed; it does not authorize future updates, merges, new infrastructure, monitoring, spending or regional release.

Actual Render deployment `dep-db7b4uad0e5s73fv1i4g` is live at source `06b72b428fa623e7daf4d244b4851683506b78d0`, on the existing free service with autoDeployOFF. Main remainsf388266. Supabase journey-api staysACTIVE/version4 and transport-api version11; actual journey source hashes matched the protected source again after publication. No Edge/config/DB/feed/collector/cron/credential/plan writes occurred.

Publication used the existing reviewed Render API/service/canonical-binding helpers through a locally reviewed operational controller. It did not dispatch the GitHub deployment workflow: its bundled smoke lacks the approved API/tile bounds. The controller adds explicit optimization-independent guards, latest-source/free-service/backend checks, rejects pending deployments and writes an exclusive durable intent before the single native POST. The hosting branch advanced remotely3a→06 by fast-forward. No guard was bypassed by fabricating GitHub runner variables. The separate ordinary push CI38478920214 completed SUCCESS, in addition to the previously passed exact-source checks.

The provider rollback endpoint/body is confirmed by the official generated Render CLI schema: POST/services/{serviceId}/rollback with deployId. Retained schema Git blob hashes matched fresh official GitHub contents metadata. The successful3a image was still serving before the change; its deployment remains the retained rollback target. The API has no separate canRollback flag. No rollback POST or recovery rehearsal was performed because final verification passed.

Actual Chromium HTTPS verification at13Oct23:48London used current public responses, no fixtures/frozen clock/private endpoint: two exact-stop journey GETs returned6+6hospital options for14Oct07:55, including direct42008:00→08:52stop15109; details/back succeeded. One liveGET returned18locations and healthy ready sources. Real map tiles, a group and an NTA GPS card rendered. Viewports320/360/390/430/768/1440 had no horizontal overflow. Native TLS tile relay served12unique OpenStreetMap URLs at max2concurrent requests, no failed images and zero queued/active jobs after cleanup. API/tile ceilings were enforced before forwarding; no extra verification fetches or repeating monitor. Five stop-catalog reads were observed; the approved journey/live ceilings were2of4 and1of8. Train locations remain reported positions with unknown observation age/precision, not verified GPS or itinerary ETA.

Three initial Chromium attempts failed before any app/API/tile request with certificate-authority errors; failures are preserved. Native HTTPS was valid. Chromium's NSS store was mounted read-only inside normal workspace execution and could not initialize. Existing platform public roots already trusted by native TLS were imported into its preserved existing store; narrowly reviewed execution permitted store initialization. HTTPS/certificate/hostname validation was never disabled. Failed attempts consumed0journeys/0live/0tiles; the successful retry remained within the one fixed approved verification window. No private credential was copied into files or browser/child environment. The management-free browser launch uses an explicit environment allowlist.

The public index and its actual JS/CSS asset bytes matched the locally tested frozen production build. Screenshot filenames public-* now depict the deployed source, unlike the older unpublished evidence packet. OSM PNGs were fetched with native verified TLS and fulfilled at their original browser URLs by the temporary verification controller; this does not change the deployed app or normal visitor tile loading. Browser clock and actual backend responses were not replaced.

Independent security review approved the corrected controller, then the bounded smoke and cleanup. Final independent documentary cross-check also approved the manifest, deployed build equality, protected source preservation, bounded successful browser proof and retained limitations. Full frozen validation was182browser/95gateway/70rootPython/414routing/11staging, strict simulated API and1642oracle plus16module parity; no new application code was introduced during publication. Screenshots are emulated viewports, not physical devices or field walking. Regional launch remains NO-GO for the previously recorded physical/accessibility, host identity/resource/availability/recovery/legal/elapsed-pilot gates.

These operational files preserve executed logic and receipts, not instructions to repeat a completed authorization. Do not run this historical publisher against the service without fresh specific approval and current source/rollback preconditions.

Recovery of an ambiguous publication request: if `publish-intent.json` exists
but `requested.json` does not, do not retry or remove the intent automatically.
Inspect the current Render deploy history and its commit IDs/times for the
recorded service/source intent first: the POST may have succeeded despite a
missing or invalid response. If a matching deployment exists, reconcile its ID
with the intent and continue read-only verification under the original grant;
do not create another deployment. Remove the intent only after positively
establishing that no matching request was accepted and checking fresh explicit
authorization/preconditions. A network error is not proof that nothing changed.
These are recovery instructions for operators, not permission to repeat this
completed historical publication or to remove safeguards automatically.
