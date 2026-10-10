'use strict';
// Offline private-staging contract. Wrapper suffix snapshotted from ACTIVE v6
// on 2026-10-10. No credentials, network, billing, or deploy actions.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../..');
const bundle=fs.readFileSync(path.join(root,'routing/artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
const marker='\n};\nconst __ballinaCache';
const cut=bundle.indexOf(marker);
assert.ok(cut>0,'16-module artifact trailer missing');
const suffix=fs.readFileSync(path.join(root,'staging/ballina-routing-v010-private-staging/wrapper_suffix.txt'),'utf8');
const executable=(bundle.slice(0,cut)+suffix).replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\r?\n/,'');
const privateToken='a091-fake-private-token-'+'z'.repeat(48);
function start(env={}){
 let handler;
 let network=0;
 const variables={BALLINA_V010_STAGING_TOKEN:privateToken,...env};
 vm.runInNewContext(executable,{
  URL,Request,Response,ReadableStream,AbortSignal,TextEncoder,Uint8Array,Date,console,Map,Set,JSON,Promise,Math,crypto:globalThis.crypto,
  Deno:{env:{get:k=>variables[k]},serve:fn=>{handler=fn;}},
  fetch(){network++;throw Error('network forbidden in offline private preview');},
 },{timeout:4500});
 assert.equal(typeof handler,'function');
 return {handler,networkCalls:()=>network};
}
const url=(suffix='')=>'https://private.test/functions/v1/ballina-routing-v010-private-staging'+suffix;
const request=(end='',token,method='GET')=>new Request(url(end),{method,headers:token===undefined?{}:{'x-ballina-preview-token':token}});

test('A09.1: active v6 wrapper is snapshotted without credential values',()=>{
 assert.equal(suffix.length,5712);
 let hash=2166136261;
 for(const char of suffix)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
 assert.equal(hash.toString(16),'ffeec881','private v6 wrapper changed; review and resnapshot before deployment');
 assert.ok(!suffix.includes(privateToken));
 assert.match(suffix,/BALLINA_V010_STAGING_TOKEN/);
 assert.doesNotMatch(suffix,/new StadiaWalkingRouter\(/);
 assert.match(suffix,/synthetic_private_staging_only/);
 assert.match(suffix,/not_for_passengers:true/);
});

test('A09.1: private token gate denies unauthorized users on all routes without network',async()=>{
 const {handler,networkCalls}=start();
 for(const endpoint of ['?test=health','/health','?test=gtfs-summary','?test=journeys','/v1/journeys']){
  const res=await handler(request(endpoint));
  assert.equal(res.status,401,endpoint);
 }
 assert.equal(networkCalls(),0);
});

test('A09.1: authenticated Dashboard health is sealed simulation',async()=>{
 const {handler,networkCalls}=start();
 const r=await handler(request('?test=health',privateToken));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.version,'0.10.0');
 assert.equal(body.mode,'private_simulation');
 assert.equal(body.public_routing_enabled,false);
 assert.equal(body.walking_geometry_real,false);
 assert.equal(body.paid_walking_provider_calls_enabled,false);
 assert.equal(body.snapshot_configured,false);
 assert.equal(networkCalls(),0);
});

test('A09.1: DB-absent journeys and GTFS summary never fall back to paid walking',async()=>{
 const {handler,networkCalls}=start();
 for(const [endpoint,method] of [['?test=journeys','POST'],['?test=gtfs-summary','GET']]){
  const r=await handler(request(endpoint,privateToken,method));
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'staging_snapshot_not_configured');
 }
 assert.equal(networkCalls(),0);
});

test('A09.1: missing configured token denies access',async()=>{
 const {handler,networkCalls}=start({BALLINA_V010_STAGING_TOKEN:''});
 assert.equal((await handler(request('?test=health',privateToken))).status,401);
 assert.equal(networkCalls(),0);
});
