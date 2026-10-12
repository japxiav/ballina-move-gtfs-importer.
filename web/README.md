# Ballina Move web

English React/TypeScript application with compact mobile journey search, results, itineraries and an official-source vehicle map at `#/live`.

Journey search remains clearly identified **synthetic demo data**. The map and Ballina departures use a separate read-only server gateway and verified public sources; they do not turn the demo itineraries into verified passenger journeys.

## Development reference

The agent handles installation, startup and validation in the cloud; the user does not need to run these commands. Maintainers need Node 20.19+/22.12+/24 and Python 3.11+ with Dublin timezone data.

```sh
cd web
npm ci --ignore-scripts
npm run build:standalone
npm run preview:live
```

`preview:live` serves the build and `/api/live` on internal port 5173 (`BALLINA_PREVIEW_PORT` overrides it). The service never serves the checkout, credentials or arbitrary upstream URLs. Production exposure requires a separately authorized host with HTTPS and appropriate edge access/rate controls; the development server is not deployed by these scripts.

`npm run dev` and `npm run preview` provide Vite-only development. They do not provide the real-data gateway; use `preview:live` to test the actual integration. `preview:cloud` serves static files only, including an optional exported snapshot, and has no backend proxy.

## Data contracts

- `server/live_gateway.py` reads only fixed official URLs. Bus observations/departures come from the existing `transport-api`; trains come from Irish Rail `getCurrentTrainsXML`.
- Only the server uses the existing **public publishable** transport key from the tracked health workflow. An optional `BALLINA_TRANSPORT_API_KEY` must also be a publishable key; privileged keys are refused. No key, JWT or backend adapter is bundled into the browser. No private credential is required for development.
- Four upstream workers, a global nine-second refresh deadline, one shared refresh/cache, one-MiB response limits, fixed schema/provenance, redirect refusal and bounded clients prevent unbounded requests. A stuck worker prevents another refresh from being queued; unavailable channels are explicit. No database writes or paid walking/map API queries occur.
- Bus GPS uses `position_timestamp`, never ingestion time. Positions older than 180 seconds disappear. Coordinates must be finite and within Ireland. Collector health gates NTA channels.
- Rail locations are **reported positions with unknown observation time and precision**. Retrieval time is not GPS age. Service dates reject obsolete reports; train codes are not matched to GTFS trips. Reports expire after 90 seconds in live mode, one hour in a published snapshot. No interpolated movement or inferred boarding/arrival.
- Departure predictions require their own fresh source timestamp. Valid delayed predictions survive an earlier scheduled time. Expired predictions revert to scheduled, passed departures disappear, and cancellations do not carry prediction fields.
- The browser requests only its own origin and attributed `tile.openstreetmap.org` map tiles. OSM tiles require Internet access; the map shows the required attribution and sends an origin referrer. The application does not request the user's location.

## Static public preview

The existing authorized preview is https://japxiav.github.io/ballina-move-gtfs-importer./ . Its `preview/ballina-fixtures-only` branch is a generated artifact branch, separate from source and main.

Pages cannot run the Python gateway. `npm run snapshot:real` exports a **fresh official capture** to `dist/live-data.json`, failing if all sources are unavailable. Only the sanitized DTO is published; the page labels it **Published snapshot** and states that continuous updates require the server gateway. Refreshing a static file does not make it live. Original observation times are retained and old markers expire.

`dist/ballina-move.html` embeds the reviewed CSS/JS with hash CSP. Same-origin data, dynamic map styles and the exact public tile host are the only additions to the former fixture-only policy. No external scripts, private hosts or credentials are allowed.

## Validation

```sh
npm run test:gateway
npm run build:standalone
npx playwright install chromium
npm test
npm run test:preview
```

Offline gateway and Playwright tests use clearly named fixtures, without official or paid requests. Browser tests cover desktop/mobile navigation, filters, malformed input, map provenance, stale observations/predictions, snapshots, retry, cancellation and touch targets. The runner serves the production build at port 4173. Existing Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Actual-source/browser checks are separate evidence under `/workspace/.ballina-execution/live-map`; see [LIVE_MAP_20261012.md](../docs/integration/LIVE_MAP_20261012.md). Integrated “Abrir em” lacks platform forwarding/browser provisioning; no tunnel or private service exposure is used to work around it. No main merge or public continuous gateway is implied by a successful local build.
