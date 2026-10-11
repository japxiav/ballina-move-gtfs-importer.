'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {checkCanary,BASE}=require('../scripts/a11_canary_readonly_acceptance.cjs');
const jwt='eyJ0eXAiOiJKV1QifQ.eyJyb2xlIjoiYW5vbiJ9.signatureisfake',preview='private-canary-test-token-32-characters-minimum';
function fakeFetch({healthReady=true,gtfsReady=true,misconfigure={}}={}) {
  const records=[];
  async function mock(url,options) {
    assert.ok(url.startsWith(BASE+'/'));
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.ok(!('body' in options));
    records.push({url,headers:options.headers});
    const h=options.headers;
    if (misconfigure.acceptWithoutJWT || h.authorization!==`Bearer ${jwt}`)
      return new Response('{}',{status:misconfigure.acceptWithoutJWT?200:401});
    if (h['x-ballina-preview-token']!==preview)return new Response('{}',{status:401});
    if (h.origin)return new Response('{}',{status:403});
    if (url.endsWith('/health'))return Response.json({service:'ballina-a11-realwalking-canary',private:true,
      notForPassengers:true,syntheticWalking:false,ready:healthReady,stadiaConfigured:true});
    if (!gtfsReady)return new Response('{}',{status:503});
    return Response.json({service:'ballina-a11-realwalking-canary',notForPassengers:true,paidWalkingCalls:0,
      feedVersion:'768b4b82327a1b83eb7f9365e4dd4495417df14163e5980889f0df2b223088d3',
      counts:{stops:227,routes:9,trips:1518,stopTimes:30115}});
  }
  return {fetcher:mock,records};
}
test('A11 read-only acceptance runs only six GETs and validates protected GTFS without walking',async()=>{
  const mock=fakeFetch();
  const r=await checkCanary({anonJwt:jwt,previewToken:preview,fetcher:mock.fetcher});
  assert.equal(r.requests,6);assert.equal(r.paidWalkingRequests,0);assert.equal(mock.records.length,6);
  assert.equal(r.counts.stops,227);
  assert.deepEqual(mock.records.map(x=>new URL(x.url).pathname.split('/').at(-1)),
    ['health','health','health','health','health','gtfs-summary']);
});
test('A11 read-only acceptance requires both credentials before connecting',async()=>{
  const f=fakeFetch();
  await assert.rejects(()=>checkCanary({anonJwt:'',previewToken:preview,fetcher:f.fetcher}),/missing_or_invalid/);
  await assert.rejects(()=>checkCanary({anonJwt:jwt,previewToken:'missing',fetcher:f.fetcher}),/missing_or_invalid/);
  assert.equal(f.records.length,0);
});
test('A11 read-only acceptance rejects non-JWT publishable keys',async()=>{
  const f=fakeFetch();await assert.rejects(()=>checkCanary({anonJwt:'sb_publishable_example_non_jwt_key',previewToken:preview,fetcher:f.fetcher}),/legacy_JWT/);
  assert.equal(f.records.length,0);
});
test('A11 read-only acceptance fails if protected health says not ready',async()=>{
  const f=fakeFetch({healthReady:false});
  await assert.rejects(()=>checkCanary({anonJwt:jwt,previewToken:preview,fetcher:f.fetcher}),/configuration_not_ready/);
});
test('A11 read-only acceptance fails on inaccessible GTFS',async()=>{
  const f=fakeFetch({gtfsReady:false});
  await assert.rejects(()=>checkCanary({anonJwt:jwt,previewToken:preview,fetcher:f.fetcher}),/authenticated_gtfs_http_503/);
});
test('A11 read-only acceptance must reject a gateway that fails to enforce JWT',async()=>{
  const f=fakeFetch({misconfigure:{acceptWithoutJWT:true}});
  await assert.rejects(()=>checkCanary({anonJwt:jwt,previewToken:preview,fetcher:f.fetcher}),/without_jwt_must_deny_http_200/);
});
test('A11 workflow is manual-only, restricted to main and uses GitHub Secrets',()=>{
  const w=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/a11-private-canary-readonly.yml'),'utf8');
  assert.match(w,/^on:\s*\n\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(w,/^\s{2}(push|pull_request|schedule|workflow_run):/m);
  assert.match(w,/github\.ref == 'refs\/heads\/main'/);
  assert.match(w,/default: NO_DO_NOT_RUN/);
  assert.match(w,/secrets\.BALLINA_SUPABASE_ANON_JWT/);
  assert.match(w,/secrets\.BALLINA_ROUTING_PREVIEW_TOKEN/);
  assert.match(w,/persist-credentials: false/);
  assert.doesNotMatch(w,/--live|a11_live_walking_smoke/);
});
