'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const suffix=fs.readFileSync(process.env.BALLINA_CANARY_TEST_SOURCE||path.join(__dirname,'../staging/a11_realwalking_canary_suffix.ts'),'utf8');
const token='test-canary-token-with-at-least-32-characters';
const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const field=k=>parts.find(p=>p.type===k).value;
const input={scenarioId:'ballina-foxford-bus',serviceDate:`${field('year')}-${field('month')}-${field('day')}`,departAt:'09:15',confirmPaidCalls:'YES_UP_TO_12_WALKS'};
function boot({deadline=100,DateImpl=Date}={}){
 let fn,routeCalls=0,limiterCalls=0,dbLoads=0;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"fake-secret"}',STADIA_API_KEY:'fake-stadia',BALLINA_ROUTING_PREVIEW_TOKEN:token};
 const modules={
  './httpApi':{createSnapshotCache:f=>f,createRoutingApi:()=>async()=>{routeCalls++;return Response.json({journeys:[]});}},
  './gtfsSnapshot':{loadActiveGtfsSnapshot:async()=>{dbLoads++;throw Error('unexpected_snapshot');}},
  './pedestrian':{StadiaWalkingRouter:class{}},
  './supabaseLimiter':{createSupabaseRateLimiter:()=>async()=>{limiterCalls++;return true;}},
 };
 vm.runInNewContext(suffix,{
  __ballinaRequire:name=>modules[name],Deno:{env:{get:k=>env[k]??''},serve:f=>{fn=f;}},
  Request,Response,URL,TextEncoder,TextDecoder,crypto:webcrypto,Date:DateImpl,
  setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,deadline)),clearTimeout,
  fetch:()=>{throw Error('unexpected_external_fetch');},console:{error:()=>{}},
 },{timeout:2000});
 return{fn,get calls(){return{routeCalls,limiterCalls,dbLoads};}};
}
function streamed(chunks,{headers={},signal,stall=false}={}){
 let reads=0,cancels=0,index=0,controller;
 const body=new ReadableStream({
  start:c=>{controller=c;},
  pull(c){reads++;if(index<chunks.length)c.enqueue(chunks[index++]);else if(!stall)c.close();},
  cancel(){cancels++;},
 },{highWaterMark:0});
 const req=new Request('https://example.test/v1/canary-journey',{
  method:'POST',headers:{'content-type':'application/json','x-ballina-preview-token':token,...headers},body,duplex:'half',signal,
 });
 return{req,get reads(){return reads;},get cancels(){return cancels;},close(){try{controller.close();}catch{}}};
}
const zero={routeCalls:0,limiterCalls:0,dbLoads:0};
test('A13 canary: reject oversized stream before buffering it completely',async()=>{
 const a=boot(),s=streamed(Array.from({length:8},()=>new Uint8Array(256).fill(32)));
 const r=await a.fn(s.req);assert.equal(r.status,413);assert.ok(s.reads<=3);assert.equal(s.cancels,1);assert.deepEqual(a.calls,zero);
});
test('A13 canary: oversized declared length is rejected before reading',async()=>{
 const a=boot(),s=streamed([new TextEncoder().encode(JSON.stringify(input))],{headers:{'content-length':'513'}});
 assert.equal((await a.fn(s.req)).status,413);assert.equal(s.reads,0);assert.deepEqual(a.calls,zero);s.close();
});
test('A13 canary: UTF8 bytes and malformed encoding are bounded independently of characters',async()=>{
 const a=boot(),s=streamed([new TextEncoder().encode(JSON.stringify({x:'é'.repeat(260)}))]);
 assert.equal((await a.fn(s.req)).status,413);assert.deepEqual(a.calls,zero);
 const b=boot(),bad=streamed([Uint8Array.of(0xff)]);
 assert.equal((await b.fn(bad.req)).status,400);assert.deepEqual(b.calls,zero);
});
test('A13 canary: exact 512-byte body preserves valid consent and fixed scenario',async()=>{
 const a=boot(),text=JSON.stringify(input).padEnd(512,' '),s=streamed([new TextEncoder().encode(text)],{headers:{'content-length':'512'}});
 assert.equal((await a.fn(s.req)).status,200);assert.deepEqual(a.calls,{routeCalls:1,limiterCalls:1,dbLoads:0});
});
test('A13 canary: stalled body hits deadline before any limiter or route call',async()=>{
 const a=boot({deadline:20}),s=streamed([Uint8Array.of(32)],{stall:true});
 const result=await Promise.race([a.fn(s.req),new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
 s.close();assert.ok(result,'reader failed to finish within the bounded negative experiment');assert.equal(result.status,408);assert.equal(s.cancels,1);assert.deepEqual(a.calls,zero);
});
test('A13 canary: request abort stops host-owned body before any route call',async()=>{
 const a=boot({deadline:100}),abort=new AbortController(),s=streamed([],{stall:true,signal:abort.signal});
 const pending=a.fn(s.req);setTimeout(()=>abort.abort(),20);
 const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
 s.close();assert.ok(result);assert.equal(result.status,499);assert.equal(s.cancels,0);assert.deepEqual(a.calls,zero);
});
test('A13 canary: auth and browser-origin gates run before reading a body',async()=>{
 for(const headers of [{'x-ballina-preview-token':'wrong'},{origin:'https://browser.example'}]){
  const a=boot(),s=streamed([],{headers,stall:true});
  assert.ok([401,403].includes((await a.fn(s.req)).status));assert.equal(s.reads,0);assert.deepEqual(a.calls,zero);s.close();
 }
});
test('A13 canary: EOF after absolute deadline cannot slip past timer dispatch',async()=>{
 let now=Date.now();class Clock extends Date{static now(){return now;}}
 const a=boot({DateImpl:Clock});
 const req={url:'https://example.test/v1/canary-journey',method:'POST',headers:new Headers({'content-type':'application/json','x-ballina-preview-token':token}),signal:new AbortController().signal,
  body:{getReader:()=>({read:async()=>{now+=10001;return{done:true};},cancel:async()=>{},releaseLock:()=>{}})},text:async()=>{now+=10001;return JSON.stringify(input);}};
 assert.equal((await a.fn(req)).status,408);assert.deepEqual(a.calls,zero);
});
test('A13 canary: malformed or dishonest length never replaces the real byte limit',async()=>{
 for(const declared of ['-1','x','1.5']){
  const a=boot(),s=streamed([new TextEncoder().encode(JSON.stringify(input))],{headers:{'content-length':declared}});
  assert.equal((await a.fn(s.req)).status,400);assert.equal(s.reads,0);assert.deepEqual(a.calls,zero);s.close();
 }
 const a=boot(),s=streamed([new Uint8Array(513).fill(32)],{headers:{'content-length':'1'}});
 assert.equal((await a.fn(s.req)).status,413);assert.equal(s.reads,1);assert.equal(s.cancels,1);assert.deepEqual(a.calls,zero);
});
test('A13 canary: 512 one-byte fragments preserve the exact-limit valid request',async()=>{
 const a=boot({deadline:1000}),bytes=new TextEncoder().encode(JSON.stringify(input).padEnd(512,' '));
 const s=streamed(Array.from(bytes,b=>Uint8Array.of(b)));
 assert.equal((await a.fn(s.req)).status,200);assert.equal(s.reads,513);
 assert.equal(s.cancels,0);assert.deepEqual(a.calls,{routeCalls:1,limiterCalls:1,dbLoads:0});
});
test('A13 canary: already-aborted request and read rejection fail before provider work',async()=>{
 const a=boot(),abort=new AbortController();abort.abort();
 const s=streamed([],{signal:abort.signal,stall:true});
 const result=await Promise.race([a.fn(s.req),new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
 s.close();assert.ok(result,'already-aborted body reader did not terminate');
 assert.equal(result.status,499);assert.equal(s.reads,0);assert.equal(s.cancels,0);assert.deepEqual(a.calls,zero);
 const b=boot();let released=0,canceled=0;
 const req={url:'https://example.test/v1/canary-journey',method:'POST',headers:new Headers({'content-type':'application/json','x-ballina-preview-token':token}),signal:new AbortController().signal,
  body:{getReader:()=>({read:()=>Promise.reject(Error('private-stream-detail')),cancel:()=>{canceled++;return new Promise(()=>{});},releaseLock:()=>{released++;}})},text:async()=>{throw Error('private-stream-detail');}};
 const r=await b.fn(req);assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'invalid_json'});
 assert.equal(canceled,1);assert.equal(released,1);assert.deepEqual(b.calls,zero);
});
test('A13 canary: delayed EOF cleans timer and abort listener without waiting for cancel',async()=>{
 let now=Date.now(),activeTimers=0,listeners=0,released=0;
 class Clock extends Date{static now(){return now;}}
 const originalSetTimeout=setTimeout;
 // The EOF microtask completes before the timeout callback. Counting host handles
 // proves cleanup even when an underlying cancellation promise never settles.
 const localSuffix=suffix;
 let fn;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"fake-secret"}',STADIA_API_KEY:'fake-stadia',BALLINA_ROUTING_PREVIEW_TOKEN:token};
 vm.runInNewContext(localSuffix,{
  __ballinaRequire:name=>({
   './httpApi':{createSnapshotCache:f=>f,createRoutingApi:()=>()=>{throw Error('unexpected_route');}},
   './gtfsSnapshot':{loadActiveGtfsSnapshot:()=>{throw Error('unexpected_snapshot');}},
   './pedestrian':{StadiaWalkingRouter:class{}},
   './supabaseLimiter':{createSupabaseRateLimiter:()=>()=>{throw Error('unexpected_limiter');}},
  })[name],Deno:{env:{get:k=>env[k]??''},serve:f=>{fn=f;}},Date:Clock,Request,Response,URL,TextEncoder,TextDecoder,crypto:webcrypto,
  setTimeout:(f,ms)=>{activeTimers++;return originalSetTimeout(f,ms);},clearTimeout:id=>{activeTimers--;clearTimeout(id);},
  fetch:()=>{throw Error('unexpected_fetch');},console:{error:()=>{}},
 },{timeout:2000});
 const req={url:'https://example.test/v1/canary-journey',method:'POST',headers:new Headers({'content-type':'application/json','x-ballina-preview-token':token}),
  signal:{aborted:false,addEventListener:()=>{listeners++;},removeEventListener:()=>{listeners--; }},
  body:{getReader:()=>({read:async()=>{now+=10001;return{done:true};},cancel:()=>new Promise(()=>{}),releaseLock:()=>{released++;}})},text:async()=>JSON.stringify(input)};
 assert.equal((await fn(req)).status,408);assert.equal(activeTimers,0);assert.equal(listeners,0);assert.equal(released,1);
});

for(const [name,scenarioId] of [
 ['object with no primitive conversion',{toString:null,valueOf:null}],
 ['one-element array',['ballina-foxford-bus']],
 ['empty object',{}],['null',null],['number',0],['boolean',true],
]){
 test(`A13 canary schema: ${name} returns 400 before limiter/provider`,async()=>{
  const a=boot(),s=streamed([new TextEncoder().encode(JSON.stringify({...input,scenarioId}))]);
  const r=await a.fn(s.req);
  assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'invalid_canary_request'});assert.deepEqual(a.calls,zero);
 });
}
