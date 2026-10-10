'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const ts=require('typescript');
test('v0.10.0 16-module single-file candidate fails closed even with rail provider flag enabled',async()=>{
 const raw=fs.readFileSync(path.join(__dirname,'../artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
 assert.equal((raw.match(/': function\(module, exports, require\) \{/g)||[]).length,16);
 const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const env={SUPABASE_URL:'https://demo.supabase.co',BALLINA_RAIL_REALTIME_ENABLED:'true',STADIA_API_KEY:'NOT-A-REAL-KEY',SUPABASE_SECRET_KEYS:'{"default":"server-placeholder"}',SUPABASE_PUBLISHABLE_KEYS:'{"default":"publishable-placeholder"}'};
 let handler,networkCalls=0;
 const Deno={env:{get:name=>env[name]},serve:h=>{handler=h}};
 const neverFetch=async()=>{networkCalls++;throw Error('network_must_not_run')};
 const main=new Function('Deno','fetch','Request','Response','URL','crypto','TextEncoder','Uint8Array','console','exports','require',js);
 main(Deno,neverFetch,Request,Response,URL,crypto,TextEncoder,Uint8Array,{info:()=>{},log:()=>{},error:()=>{}},{},name=>{if(name==='jsr:@supabase/functions-js/edge-runtime.d.ts')return {};throw Error('unexpected dependency '+name)});
 assert.equal(typeof handler,'function');
 const status=await handler(new Request('https://demo.supabase.co/functions/v1/private/health',{headers:{apikey:'publishable-placeholder'}}));assert.equal(status.status,200);
 assert.equal((await status.json()).public_planning_enabled,false);
 const route=await handler(new Request('https://demo.supabase.co/functions/v1/private/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 assert.equal(route.status,503);
 const rail=await handler(new Request('https://demo.supabase.co/functions/v1/private/v1/rail/station-board?station=Ballina'));
 assert.equal(rail.status,503);
 assert.equal(networkCalls,0);
});

test('outer private preview gate recognizes rail endpoint but denies incorrect private token before network',async()=>{
 const raw=fs.readFileSync(path.join(__dirname,'../artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
 const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const env={SUPABASE_URL:'https://demo.supabase.co',BALLINA_ROUTING_PREVIEW_TOKEN:'private-railtoken-for-ci-requires-thirty-two-characters',STADIA_API_KEY:'fake-secret-for-test',SUPABASE_SECRET_KEYS:'{"default":"server-placeholder"}',SUPABASE_PUBLISHABLE_KEYS:'{"default":"publishable-placeholder"}',BALLINA_RAIL_REALTIME_ENABLED:'true'};
 let handler,network=0;
 new Function('Deno','fetch','Request','Response','URL','crypto','TextEncoder','Uint8Array','console','exports','require',js)(
  {env:{get:key=>env[key]},serve:fn=>{handler=fn}},async()=>{network++;throw Error('network_used')},Request,Response,URL,crypto,TextEncoder,Uint8Array,
  {info:()=>{},log:()=>{},error:()=>{}},{},name=>{if(name==='jsr:@supabase/functions-js/edge-runtime.d.ts')return {};throw Error('unexpected '+name)});
 const routes=['/v1/rail/stations','/v1/rail/station-board?station=Ballina'];
 for(const route of routes){
  const result=await handler(new Request('https://demo.supabase.co/functions/v1/private'+route,{headers:{'x-ballina-preview-token':'incorrect'}}));
  assert.equal(result.status,401,'rail endpoint must reach private token gate, not unknown path');
 }
 assert.equal(network,0);
});
