#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '[1/3] Python importer, workflow and API-contract tests'
python -m unittest discover -s tests -v
python -m py_compile import_gtfs.py scripts/check_post_activation.py
if ! command -v tsc >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo '[2/3] TypeScript compiler/Node unavailable: runtime mocks not executed'
  exit 0
fi
echo '[2/3] TypeScript strict type checks'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed '1d' supabase/functions/transport-api/index.ts > /tmp/ballina_transport_api.ts
sed '1d' supabase/functions/gtfs-import-api/index.ts > /tmp/ballina_import_api.ts
cat > /tmp/deno-shim.d.ts <<'TS'
declare const Deno: { env: { get(name:string):string|undefined }, serve(handler:(req:Request)=>Response|Promise<Response>):void };
TS
mkdir -p /tmp/ballina-ts-compiled
tsc --target es2022 --lib es2022,dom --strict --skipLibCheck --module commonjs --outDir /tmp/ballina-ts-compiled /tmp/ballina_transport_api.ts /tmp/deno-shim.d.ts
tsc --target es2022 --lib es2022,dom --strict --skipLibCheck --module commonjs --outDir /tmp/ballina-ts-compiled /tmp/ballina_import_api.ts /tmp/deno-shim.d.ts
echo '[3/3] Simulated transport and importer API request tests'
node tests/runtime/test_transport_api.cjs
node tests/runtime/test_import_api.cjs
echo 'ALL LOCAL TESTS PASSED'
