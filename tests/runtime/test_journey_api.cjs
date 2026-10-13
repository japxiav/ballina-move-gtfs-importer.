const {test}=require('node:test');const assert=require('node:assert/strict');
let handler;const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'server-only-fixture',SUPABASE_PUBLISHABLE_KEY:'gateway-public-fixture'};
globalThis.Deno={env:{get:k=>env[k]},serve:h=>{handler=h;}};
require('/tmp/ballina-ts-compiled/ballina_journey_api.js');
let requests=[];globalThis.fetch=async(url,init)=>{requests.push({url,init});return Response.json([{allowed:false}]);};
function req(path,headers={},method='GET'){return handler(new Request('https://fixture.supabase.co/functions/v1/journey-api?'+path,{method,headers}));}
test('isolated journey API refuses credentials, browser origins, unknown actions and malformed input before DB or quota',async()=>{
 for(const [path,headers,method,status] of [
 ['action=stops',{},'GET',401],['action=stops',{apikey:'wrong'},'GET',401],['action=stops',{apikey:'gateway-public-fixture',origin:'https://browser.example'},'GET',403],
 ['action=vehicles',{apikey:'gateway-public-fixture'},'GET',404],['action=stops&url=https://private.example',{apikey:'gateway-public-fixture'},'GET',400],
 ['action=journeys&from=A',{apikey:'gateway-public-fixture'},'GET',400],['action=stops&action=journeys',{apikey:'gateway-public-fixture'},'GET',404],
 ['action=stops',{apikey:'gateway-public-fixture'},'POST',405],
 ]){requests=[];assert.equal((await req(path,headers,method)).status,status);assert.equal(requests.length,0);}
});
test('shared quota denial and schema failure stop before snapshot and never return key or raw error',async()=>{
 requests=[];let r=await req('action=stops',{apikey:'gateway-public-fixture'});assert.equal(r.status,429);assert.equal(requests.length,1);assert.equal(requests[0].init.redirect,'error');
 assert.equal(requests[0].url,'https://fixture.supabase.co/rest/v1/rpc/consume_transport_api_rate_limit');
 globalThis.fetch=async()=>Response.json([{allowed:'true',private_debug:'secret-never-forward'}]);
 r=await req('action=stops',{apikey:'gateway-public-fixture'});assert.equal(r.status,503);assert.equal(await r.text(),'{"error":"schedules_unavailable"}');
});
