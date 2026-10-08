const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {
 createRoutingApi,createMemoryRateLimiter,createSnapshotCache,fromSupabaseTables,proximityMeters,
}=require('../dist');
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json',`file://${__filename}`)));
const timetable=fromSupabaseTables(fixture.tables);
const today=new Date('2026-10-08T07:00:00Z');
const boarding={lat:54.11070,lon:-9.16003},hospital={lat:53.85190,lon:-9.30593};
const basic={serviceDate:'2026-10-08',departAt:'07:50',origin:boarding,destination:hospital,maxTransfers:0};
const endpoint='https://app.example.test/v1/journeys';
const request=(body=basic,extra={})=>new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)});
function harness(options={}) {
 let walked=0,loaded=0;
 const api=createRoutingApi({
  loadTimetable: async()=>{loaded++;if(options.failLoad)throw Error('DATABASE_PRIVATE_PASSWORD=secret');return timetable},
  router:{walk:async(a,b)=>{walked++;if(options.failWalking)throw Error('STADIA_SUPER_SECRET=not-for-browser');return proximityMeters(a,b)>220?null:{durationSeconds:120,distanceMeters:125,geometry:[a,b],provider:'MOCK_NOT_REAL'}}},
  clientIdentity:()=>options.identity??'internal-trusted-ip',
  consumeRateLimit:options.limiter??createMemoryRateLimiter(()=>Date.parse(today.toISOString())),
  now:options.now??(()=>today),
  allowedOrigins:options.allowedOrigins??['https://ballinamove.example'],
 });
 return {api,counters:()=>({walked,loaded})};
}

test('real GTFS fixture served through API has 08:00/08:52 420 route, unverified boarding',async()=>{
 const h=harness();const response=await h.api(request());assert.equal(response.status,200);
 const output=await response.json();
 assert.equal(output.feedVersion,timetable.feedVersion);assert.equal(output.status,'scheduled_only');
 assert.equal(output.realtime,false);assert.equal(output.journeys.length,1);
 const j=output.journeys[0];assert.equal(j.legs.filter(x=>x.type==='ride').length,1);
 assert.equal(j.legs.find(x=>x.type==='ride').boardAtSeconds,28800);
 assert.equal(j.legs.find(x=>x.type==='ride').alightAtSeconds,31920);
 assert.equal(j.boardingDetails[0].stopCode,'555051');
 assert.equal(j.boardingDetails[0].locationConfidence,'official_unverified');
 assert.equal(j.boardingDetails[0].sideOfStreet,null);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.ok(h.counters().walked<=12);
});

test('no private credentials exposed, even when provider fails',async()=>{
 const h=harness({failWalking:true});const response=await h.api(request());assert.equal(response.status,503);
 const text=await response.text();assert.equal(text.includes('SECRET'),false);assert.equal(text.includes('STADIA'),false);
});
test('database errors are sanitized',async()=>{
 const h=harness({failLoad:true});const response=await h.api(request());assert.equal(response.status,503);
 assert.equal((await response.text()).includes('PRIVATE_PASSWORD'),false);
});
test('blocks browser origin absent from allowlist before any provider calls',async()=>{
 const h=harness();const response=await h.api(request(basic,{Origin:'https://malicious.example'}));
 assert.equal(response.status,403);assert.deepEqual(h.counters(),{walked:0,loaded:0});
});
test('allowed origin receives specific CORS response; preflight cannot reach provider',async()=>{
 const h=harness();const r=await h.api(request(basic,{Origin:'https://ballinamove.example'}));
 assert.equal(r.headers.get('access-control-allow-origin'),'https://ballinamove.example');
 const p=await h.api(new Request(endpoint,{method:'OPTIONS',headers:{Origin:'https://ballinamove.example','Access-Control-Request-Method':'POST'}}));
 assert.equal(p.status,204);
});
test('rejects oversized bodies without invoking providers',async()=>{
 const h=harness();const response=await h.api(request('x'.repeat(5000)));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'payload_too_large');
 assert.deepEqual(h.counters(),{walked:0,loaded:0});
});
test('rejects malformed JSON and unsupported type',async()=>{
 const h=harness();const x=await h.api(request('{"oops":'));
 assert.equal(x.status,400);
 const y=await h.api(new Request(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:'hello'}));
 assert.equal(y.status,415);
});
test('invalid route coordinates, unknown keys, and budgets are rejected before walking',async()=>{
 const invalid=[
 {...basic,origin:{lat:0,lon:0}},
 {...basic,origin:{lat:'54.111',lon:-9.16}},
 {...basic,origin:{lat:54.11,lon:-9.16,role:'please-break'}},
 {...basic,serviceDate:'2026-10-07'},
 {...basic,serviceDate:'2026-11-18'},
 {...basic,departAt:'26:00'},
 {...basic,maxTransfers:3},
 {...basic,maxWalkingMeters:2501},
 {...basic,limit:999},
 {...basic,adminKey:'inject'},
 ];
 const h=harness();for(const payload of invalid){const x=await h.api(request(payload));assert.equal(x.status,400,JSON.stringify(payload));}
 assert.deepEqual(h.counters(),{walked:0,loaded:0});
});
test('rejects DST transition day before charging walking provider',async()=>{
 const h=harness({now:()=>new Date('2027-03-27T12:00:00Z')});
 const r=await h.api(request({...basic,serviceDate:'2027-03-28'}));
 assert.equal(r.status,422);assert.equal(h.counters().walked,0);
});
test('client and global limits enforced independently; no extra walks at limit',async()=>{
 const h=harness();for(let i=0;i<10;i++){const res=await h.api(request());assert.equal(res.status,200)}
 const r=await h.api(request());assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
 const cost=h.counters().walked;const r2=await h.api(request());assert.equal(r2.status,429);
 assert.equal(cost,h.counters().walked);
 const globalH=harness({limiter:async(key)=>key!=='routing|global'});
 assert.equal((await globalH.api(request())).status,429);
});
test('shared limiter failures fail closed',async()=>{
 const h=harness({limiter:async()=>{throw Error('redis secret')}});
 const r=await h.api(request());assert.equal(r.status,503);assert.deepEqual(h.counters(),{walked:0,loaded:0});
});
test('route endpoint is POST-only, health explicitly does not guarantee realtime',async()=>{
 const h=harness();
 const wrong=await h.api(new Request(endpoint,{method:'GET'}));assert.equal(wrong.status,405);
 const hlt=await h.api(new Request('https://app.example.test/health'));
 assert.equal(hlt.status,200);assert.equal((await hlt.json()).realtime,false);
 const notfound=await h.api(new Request('https://app.example.test/other'));assert.equal(notfound.status,404);
});
test('snapshot cache coalesces concurrent loads, respects TTL, rejects failures',async()=>{
 let time=0,calls=0;
 const cache=createSnapshotCache(async()=>{calls++;await Promise.resolve();return timetable},1000,()=>time);
 const arr=await Promise.all([cache(),cache(),cache()]);assert.equal(calls,1);
 assert.equal(arr[0],arr[2]);time=999;await cache();assert.equal(calls,1);
 time=1001;await cache();assert.equal(calls,2);
 let fails=0;const bad=createSnapshotCache(async()=>{fails++;throw Error('temporarily down')},1000,()=>time);
 await assert.rejects(bad());await assert.rejects(bad());assert.equal(fails,2);
});
