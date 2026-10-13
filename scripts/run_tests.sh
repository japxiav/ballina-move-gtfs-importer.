#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '[1/3] Python importer, workflow and API-contract tests'
python -m unittest discover -s tests -v
python -m py_compile import_gtfs.py scripts/check_post_activation.py
if ! command -v tsc >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo '[2/3] Required TypeScript compiler/Node unavailable: gateway checks NOT executed'
  exit 1
fi
echo '[2/3] TypeScript strict type checks'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed '1d' supabase/functions/transport-api/index.ts > /tmp/ballina_transport_api.ts
sed '1d;s|"../transport-api/journeys.ts"|"./ballina_journeys"|' supabase/functions/journey-api/index.ts > /tmp/ballina_journey_api.ts
cp supabase/functions/transport-api/journeys.ts /tmp/ballina_journeys.ts
sed '1d' supabase/functions/gtfs-import-api/index.ts > /tmp/ballina_import_api.ts
cat > /tmp/deno-shim.d.ts <<'TS'
declare const Deno: { env: { get(name:string):string|undefined }, serve(handler:(req:Request)=>Response|Promise<Response>):void };
TS
mkdir -p /tmp/ballina-ts-compiled
tsc --target es2022 --lib es2022,dom,dom.iterable --strict --skipLibCheck --module commonjs --outDir /tmp/ballina-ts-compiled /tmp/ballina_transport_api.ts /tmp/deno-shim.d.ts
tsc --target es2022 --lib es2022,dom,dom.iterable --strict --skipLibCheck --module commonjs --outDir /tmp/ballina-ts-compiled /tmp/ballina_journey_api.ts /tmp/deno-shim.d.ts
tsc --target es2022 --lib es2022,dom --strict --skipLibCheck --module commonjs --outDir /tmp/ballina-ts-compiled /tmp/ballina_import_api.ts /tmp/deno-shim.d.ts
echo '[3/3] Simulated transport and importer API request tests'
node tests/runtime/test_transport_api.cjs
node --test tests/runtime/test_stop_journeys.cjs
node --test tests/runtime/test_schedule_topology.cjs
node --test tests/runtime/test_schedule_selection.cjs
node tests/runtime/test_schedule_oracle.cjs
node --test tests/runtime/test_journey_api.cjs
node tests/runtime/test_import_api.cjs
node --test tests/runtime/test_import_body_bounds.cjs
echo 'ALL LOCAL TESTS PASSED'
