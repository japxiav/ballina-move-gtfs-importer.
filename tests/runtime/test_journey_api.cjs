const {test}=require('node:test');const assert=require('node:assert/strict');
let handler;const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'server-only-fixture',SUPABASE_PUBLISHABLE_KEY:'gateway-public-fixture',BALLINA_JOURNEY_GATEWAY_SECRET:'a'.repeat(64)};
globalThis.Deno={env:{get:k=>env[k]},serve:h=>{handler=h;}};
require('/tmp/ballina-ts-compiled/ballina_journey_api.js');
let requests=[];globalThis.fetch=async(url,init)=>{requests.push({url,init});return Response.json([{allowed:false}]);};
function req(path,headers={},method='GET'){return handler(new Request('https://fixture.supabase.co/functions/v1/journey-api?'+path,{method,headers:{'x-ballina-gateway':'a'.repeat(64),...headers}}));}
test('isolated journey API refuses credentials, browser origins, unknown actions and malformed input before DB or quota',async()=>{
 for(const [path,headers,method,status] of [
 ['action=stops',{},'GET',401],['action=stops',{apikey:'wrong'},'GET',401],['action=stops',{apikey:'gateway-public-fixture',origin:'https://browser.example'},'GET',403],
 ['action=vehicles',{apikey:'gateway-public-fixture'},'GET',404],['action=stops&url=https://private.example',{apikey:'gateway-public-fixture'},'GET',400],
 ['action=journeys&from=A',{apikey:'gateway-public-fixture'},'GET',400],['action=stops&action=journeys',{apikey:'gateway-public-fixture'},'GET',404],
 ['action=stops',{apikey:'gateway-public-fixture'},'POST',405],
 ]){requests=[];assert.equal((await req(path,headers,method)).status,status);assert.equal(requests.length,0);}
});
test('published keys alone, forged or duplicate gateway credentials cannot spend quota',async()=>{
 for(const credential of ['', 'b'.repeat(64), 'a'.repeat(63), 'a'.repeat(64)+', '+ 'a'.repeat(64), 'private debug']) {
  requests=[];const r=await req('action=stops',{apikey:'gateway-public-fixture','x-ballina-gateway':credential});
  assert.equal(r.status,401);assert.equal(requests.length,0);assert.equal(await r.text(),'{"error":"unauthorized"}');
 }
});
test('private admission confirms protocol only without quota or snapshot reads and rejects browser or extra input',async()=>{
 globalThis.fetch=async()=>{throw Error('Admission must not read a source or quota');};
 requests=[];
 const result=await req('action=admission',{apikey:'gateway-public-fixture'});
 assert.equal(result.status,200);assert.deepEqual(await result.json(),{version:1,source:'journey-api',admission:'gateway-secret-v1',quotaConsumed:false,snapshotRead:false});
 assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(requests.length,0);
 for(const [path,headers,method,status] of [
  ['action=admission',{apikey:'gateway-public-fixture','x-ballina-gateway':'b'.repeat(64)},'GET',401],
  ['action=admission',{apikey:'gateway-public-fixture',origin:'https://browser.example'},'GET',403],
  ['action=admission&url=https://private.example',{apikey:'gateway-public-fixture'},'GET',400],
  ['action=admission&action=stops',{apikey:'gateway-public-fixture'},'GET',404],
  ['action=admission',{apikey:'gateway-public-fixture'},'POST',405],
 ])assert.equal((await req(path,headers,method)).status,status);
});
test('missing or malformed private configuration never falls back to publishable authorization',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),{createRequire}=require('node:module');
 const path='/tmp/ballina-ts-compiled/ballina_journey_api.js',code=fs.readFileSync(path,'utf8');
 for(const secret of ['', 'a'.repeat(63), 'A'.repeat(64), 'public-fixture', 'a'.repeat(65)]) {
  let isolated,calls=0;
  vm.runInNewContext(code,{exports:{},require:createRequire(path),Deno:{env:{get:k=>({...env,BALLINA_JOURNEY_GATEWAY_SECRET:secret})[k]},serve:h=>{isolated=h;}},Request,Response,URL,AbortController,Uint8Array,TextDecoder,setTimeout,clearTimeout,fetch:async()=>{calls++;throw Error('unexpected_network');}});
  const response=await isolated(new Request('https://fixture.supabase.co/functions/v1/journey-api?action=stops',{headers:{apikey:'gateway-public-fixture','x-ballina-gateway':'a'.repeat(64)}}));
  assert.equal(response.status,503);assert.equal(await response.text(),'{"error":"configuration_missing"}');assert.equal(calls,0);
 }
});
test('quota streamed body limits and abort deadlines fail closed without snapshot reads',async()=>{
 for(const response of [new Response('x'.repeat(1025)),new Response('[]',{headers:{'Content-Length':'1025'}}),Response.json([{allowed:1}]),new Response(new Uint8Array([0xff]))]) {
  let count=0;globalThis.fetch=async()=>{count++;return response;};
  const r=await req('action=stops',{apikey:'gateway-public-fixture'});
  assert.equal(r.status,503);assert.equal(count,1);assert.equal(await r.text(),'{"error":"schedules_unavailable"}');
 }
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}));
 const r=await req('action=stops',{apikey:'gateway-public-fixture'});
 assert.equal(r.status,503);assert.equal(cancelled,true);
});
test('shared quota denial and schema failure stop before snapshot and never return key or raw error',async()=>{
 globalThis.fetch=async(url,init)=>{requests.push({url,init});return Response.json([{allowed:false}]);};
 requests=[];let r=await req('action=stops',{apikey:'gateway-public-fixture'});assert.equal(r.status,429);assert.equal(requests.length,1);assert.equal(requests[0].init.redirect,'error');
 assert.equal(requests[0].url,'https://fixture.supabase.co/rest/v1/rpc/consume_transport_api_rate_limit');
 globalThis.fetch=async()=>Response.json([{allowed:'true',private_debug:'secret-never-forward'}]);
 r=await req('action=stops',{apikey:'gateway-public-fixture'});assert.equal(r.status,503);assert.equal(await r.text(),'{"error":"schedules_unavailable"}');
});
