const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = fs.readFileSync(path.join(__dirname, '../ballina-routing-v099-staging/index.ts'), 'utf8');
let handler;
let networkCalls = 0;
const executable = ts.replace('(request: Request)', '(request)');
vm.runInNewContext(executable, {
  Deno: {serve(fn){handler=fn}}, URL, Request, Response,
  fetch(){networkCalls++;throw Error('network forbidden in staging gate')},
}, {timeout:1000});
test('sealed staging exposes only a harmless health response', async () => {
  const response = await handler(new Request('https://example.test/functions/v1/ballina-routing-v099-staging/health'));
  assert.equal(response.status,200);
  const data = await response.json();
  assert.equal(data.phase,'sealed_preflight_only');
  assert.equal(data.route_planning_enabled,false);
  assert.equal(data.paid_provider_calls_enabled,false);
});
for(const [method,p] of [['POST','/v1/journeys'],['GET','/v1/nearby-stops'],['GET','/unrecognized'],['OPTIONS','/v1/journeys']]){
  test(`${method} ${p} denied without any outbound fetch`,async()=>{
    const response=await handler(new Request('https://example.test/functions/v1/ballina-routing-v099-staging'+p,{method}));
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,'staging_not_enabled');
    assert.equal(networkCalls,0);
  });
}
test('staging gate contains no API secret or external client integration',()=>{
  assert.doesNotMatch(ts,/STADIA_API_KEY|SUPABASE_SERVICE_ROLE_KEY|\bfetch\s*\(/);
});
