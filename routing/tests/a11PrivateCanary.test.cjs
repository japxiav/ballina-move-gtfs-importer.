'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {makeCandidate}=require('../scripts/build_a11_realwalking_canary.cjs');
const root=path.resolve(__dirname,'..');
const suffix=fs.readFileSync(path.join(root,'staging/a11_realwalking_canary_suffix.ts'),'utf8');
const token='test-preview-token-with-at-least-32-characters';
const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const field=k=>parts.find(p=>p.type===k).value;
const today=`${field('year')}-${field('month')}-${field('day')}`;
function request(p,method='GET',body,headers={}){
 const h={'x-ballina-preview-token':token,...headers};
 if(body!==undefined)h['content-type']='application/json';
 return new Request('https://example.test/functions/v1/ballina-a11-realwalking-canary'+p,{method,headers:h,
   ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
function boot({configured=true,limitAllowed=true,result,provider='stadia-valhalla-pedestrian'}={}){
 let fn,routeCalls=0,dbLoads=0,limiterCalls=0;const payloads=[];
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"secret_fake"}',
   STADIA_API_KEY:configured?'stadia_fake':'',BALLINA_ROUTING_PREVIEW_TOKEN:token};
 const modules={
  './httpApi':{createSnapshotCache:loader=>loader,createRoutingApi:()=>async req=>{
    routeCalls++;payloads.push(await req.json());
    return Response.json(result??{journeys:[{legs:[{type:'walk',provider}],transfers:0}],walkingCoverage:{executed:2},status:'scheduled_only'});
  }},
  './gtfsSnapshot':{loadActiveGtfsSnapshot:async()=>{dbLoads++;return{feedVersion:'feed-sample',stops:[{}],routes:[{}],trips:[{}],stopTimes:[{}]};}},
  './pedestrian':{StadiaWalkingRouter:class{constructor(key){assert.equal(key,'stadia_fake');}}},
  './supabaseLimiter':{createSupabaseRateLimiter:()=>async()=>{limiterCalls++;if(limitAllowed==='error')throw new Error('rate_down');return limitAllowed;}}
 };
 const context={__ballinaRequire:name=>{assert.ok(modules[name],name);return modules[name];},
  Deno:{env:{get:key=>env[key]??''},serve:handler=>{fn=handler;}},
  crypto:webcrypto,TextEncoder,Request,Response,URL,Date,Number,Object,JSON,console:{error:()=>{}},fetch:async()=>{throw Error('unexpected_external_request')},
 };
 vm.runInNewContext(suffix,context,{timeout:2000});
 return {fn,get routeCalls(){return routeCalls;},get dbLoads(){return dbLoads;},get limiterCalls(){return limiterCalls;},payloads};
}
function validInput(){return {scenarioId:'ballina-foxford-bus',serviceDate:today,departAt:'09:15',confirmPaidCalls:'YES_UP_TO_12_WALKS'};}
test('A11 P3 official bundle prefix reused unchanged; standalone candidate is deterministic',()=>{
 const source=fs.readFileSync(path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
 const generated=makeCandidate(source,suffix);
 assert.equal(generated,fs.readFileSync(path.join(root,'artifacts/ballina-a11-realwalking-private-canary.ts'),'utf8'));
 assert.equal(generated.slice(0,source.indexOf("const {createRoutingApi,createSnapshotCache}=__ballinaRequire('./httpApi');")),
   source.slice(0,source.indexOf("const {createRoutingApi,createSnapshotCache}=__ballinaRequire('./httpApi');")));
 assert.doesNotMatch(suffix,/synthetic_private_staging_only|mockRouter|Deno\.env\.set|allowedOrigins:\s*\[[^\]]+\]/);
});
test('A11 P3 rejects missing token, wrong token, browser origin, with no calls',async()=>{
 const a=boot();
 assert.equal((await a.fn(new Request('https://example.test/health'))).status,401);
 assert.equal((await a.fn(request('/health','GET',undefined,{'x-ballina-preview-token':'wrong'}))).status,401);
 assert.equal((await a.fn(request('/health','GET',undefined,{origin:'https://attacker.example'}))).status,403);
 assert.equal(a.routeCalls,0);assert.equal(a.limiterCalls,0);assert.equal(a.dbLoads,0);
});
test('A11 P3 fails closed without Stadia key, including paid route requests',async()=>{
 const a=boot({configured:false});
 const h=await (await a.fn(request('/health'))).json();assert.equal(h.ready,false);
 assert.equal((await a.fn(request('/v1/canary-journey','POST',validInput()))).status,503);
 assert.equal(a.routeCalls,0);assert.equal(a.limiterCalls,0);
});
test('A11 P3 GTFS-only summary performs no paid walking calls',async()=>{
 const a=boot();const r=await a.fn(request('/v1/gtfs-summary'));const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.feedVersion,'feed-sample');assert.equal(j.counts.stops,1);
 assert.equal(j.paidWalkingCalls,0);assert.equal(a.routeCalls,0);assert.equal(a.limiterCalls,0);assert.equal(a.dbLoads,1);
});
test('A11 P3 refuses unknown scenarios and missing explicit paid consent',async()=>{
 const a=boot();
 for(const v of [{...validInput(),scenarioId:'random'}, {...validInput(),confirmPaidCalls:'YES'},
   {...validInput(),origin:{lat:54,lon:-9}},{...validInput(),serviceDate:'2024-01-01'},
   {...validInput(),departAt:'25:45'}]){
   const r=await a.fn(request('/v1/canary-journey','POST',v));assert.equal(r.status,400);
 }
 assert.equal(a.limiterCalls,0);assert.equal(a.routeCalls,0);
});
test('A11 P3 rejects overlong bodies, malformed JSON, missing content type and unknown paths',async()=>{
 const a=boot();
 assert.equal((await a.fn(request('/v1/canary-journey','POST',JSON.stringify({x:'a'.repeat(600)})))).status,413);
 assert.equal((await a.fn(request('/v1/canary-journey','POST','{oops'))).status,400);
 assert.equal((await a.fn(request('/v1/canary-journey','POST',undefined))).status,415);
 assert.equal((await a.fn(request('/v1/journeys','POST',validInput()))).status,404);
 assert.equal(a.limiterCalls,0);assert.equal(a.routeCalls,0);
});
test('A11 P3 shared DB hourly limiter is applied before constructing a paid journey',async()=>{
 const a=boot({limitAllowed:false});const r=await a.fn(request('/v1/canary-journey','POST',validInput()));
 assert.equal(r.status,429);assert.equal(a.limiterCalls,1);assert.equal(a.routeCalls,0);
 const b=boot({limitAllowed:'error'});assert.equal((await b.fn(request('/v1/canary-journey','POST',validInput()))).status,503);
 assert.equal(b.routeCalls,0);
});
test('A11 P3 valid fixed sample routes to real engine with bounded API arguments',async()=>{
 const a=boot();const r=await a.fn(request('/v1/canary-journey','POST',validInput()));const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.canary.private,true);assert.equal(j.canary.notForPassengers,true);
 assert.equal(j.canary.syntheticWalking,false);assert.equal(j.canary.verifiedProviderWalkLegs,1);
 assert.equal(a.routeCalls,1);assert.equal(a.limiterCalls,1);
 assert.equal(a.payloads[0].origin.lat,54.1118);assert.equal(a.payloads[0].destination.lon,-9.1114);
 assert.deepEqual(a.payloads[0].modes,['bus']);assert.equal(a.payloads[0].maxTransfers,1);
 assert.equal(a.payloads[0].maxWalkingMeters,1800);
});
test('A11 P3 refuses synthetic or unexpected walking providers even if upstream accidentally returns them',async()=>{
 const a=boot({provider:'synthetic_private_staging_only'});
 const r=await a.fn(request('/v1/canary-journey','POST',validInput()));
 assert.equal(r.status,503);assert.equal((await r.json()).error,'unverified_walking_provider');
});
test('A11 P3 never claims no service on a zero-journey response',async()=>{
 const a=boot({result:{journeys:[],status:'scheduled_only'}});
 const r=await a.fn(request('/v1/canary-journey','POST',validInput()));const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.canary.emptyResultDoesNotProveNoService,true);
 assert.equal(j.canary.verifiedProviderWalkLegs,0);
});
function polyline6(points){
 let previousLat=0,previousLon=0,encoded='';
 function write(delta){let n=delta<0?~(delta<<1):(delta<<1);while(n>=32){encoded+=String.fromCharCode(((n&31)|32)+63);n>>=5;}encoded+=String.fromCharCode(n+63);}
 for(const p of points){const lat=Math.round(p.lat*1e6),lon=Math.round(p.lon*1e6);write(lat-previousLat);write(lon-previousLon);previousLat=lat;previousLon=lon;}
 return encoded;
}
function metres(a,b){const dlat=(b.lat-a.lat)*Math.PI/180,dlon=(b.lon-a.lon)*Math.PI/180,R=6371000;
 const t=Math.sin(dlat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dlon/2)**2;
 return 2*R*Math.asin(Math.sqrt(t));}
test('A11 P3 complete original 16-module bundle uses GTFS snapshot and mocked Stadia HTTP, never a synthetic router',async()=>{
 const generated=fs.readFileSync(path.join(root,'artifacts/ballina-a11-realwalking-private-canary.ts'),'utf8');
 let handler,stadiaCalls=0,dbCalls=0,limitCalls=0;
 const feed='official-mocked-test-version';
 const stops=[
  {version:feed,stop_id:'BALLINA',stop_name:'Ballina Bus Stn',stop_lat:54.11101,stop_lon:-9.1599,stop_code:'BALLINA',stop_desc:null},
  {version:feed,stop_id:'FOXFORD',stop_name:'Foxford',stop_lat:53.981153,stop_lon:-9.110725,stop_code:'FOXFORD',stop_desc:null},
 ];
 const rows={
  gtfs_stops:stops,
  gtfs_routes:[{version:feed,route_id:'R1',route_short_name:'B1',route_long_name:'Ballina Foxford',route_type:3}],
  gtfs_trips:[{version:feed,trip_id:'T1',route_id:'R1',service_id:'S1',trip_headsign:'Foxford'}],
  gtfs_stop_times:[
   {version:feed,trip_id:'T1',stop_id:'BALLINA',stop_sequence:1,arrival_seconds:34800,departure_seconds:34800,pickup_type:0,drop_off_type:0},
   {version:feed,trip_id:'T1',stop_id:'FOXFORD',stop_sequence:2,arrival_seconds:37800,departure_seconds:37800,pickup_type:0,drop_off_type:0}
  ],
  gtfs_calendars:[{version:feed,service_id:'S1',start_date:'2026-01-01',end_date:'2027-12-31',
    sunday:true,monday:true,tuesday:true,wednesday:true,thursday:true,friday:true,saturday:true}],
  gtfs_calendar_dates:[],
 };
 const fakeFetch=async(input,init={})=>{
  const url=new URL(input);
  if(url.hostname==='api-eu.stadiamaps.com'){
   stadiaCalls++;
   assert.equal(init.method,'POST');assert.match(init.headers.Authorization,/^Stadia-Auth /);
   const p=JSON.parse(init.body);assert.equal(p.costing,'pedestrian');
   const a=p.locations[0],b=p.locations[1],dist=metres(a,b);
   return Response.json({trip:{summary:{time:Math.ceil(dist/1.2*1.05),length:dist*1.05/1000},legs:[{shape:polyline6([a,b])}]}});
  }
  if(url.hostname!=='example.supabase.co')throw Error('unexpected_network_host');
  if(url.pathname.endsWith('/rpc/consume_transport_api_rate_limit')){
    limitCalls++;return Response.json([{allowed:true}]);
  }
  dbCalls++;
  if(url.pathname.endsWith('/gtfs_feed_versions'))return Response.json([{version:feed}]);
  const table=url.pathname.split('/').at(-1);
  assert.ok(Object.hasOwn(rows,table),'unexpected DB table: '+table);
  const data=rows[table];const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
  return Response.json(data.slice(offset,offset+limit),{headers:{'content-range':data.length?`0-${data.length-1}/${data.length}`:'*/0'}});
 };
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"secret_fake"}',
   STADIA_API_KEY:'mock-secret-stadia',BALLINA_ROUTING_PREVIEW_TOKEN:token};
 const context={Deno:{env:{get:name=>env[name]??''},serve:fn=>{handler=fn;}},
  Request,Response,URL,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,fetch:fakeFetch,console:{error:()=>{}}};
 vm.runInNewContext(generated.replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\s*/,''),context,{timeout:5000});
 assert.equal(typeof handler,'function');
 const input=validInput();
 const response=await handler(request('/v1/canary-journey','POST',input));
 const json=await response.json();
 assert.equal(response.status,200,JSON.stringify(json).slice(0,400));
 assert.equal(json.feedVersion,feed);
 assert.ok(stadiaCalls>=1,'expected at least one actual walking-provider adapter call');
 assert.ok(stadiaCalls<=12,'canary must retain hard provider-call ceiling');
 assert.ok(dbCalls>=8,'active version plus six GTFS tables must be loaded');
 assert.ok(limitCalls>=2,'independent canary limiter plus API limiter');
 assert.equal(json.canary.syntheticWalking,false);
 assert.ok(Array.isArray(json.journeys));
 assert.ok(json.journeys.length>=1,'bus trip from mocked complete GTFS should be feasible');
 assert.ok(json.canary.verifiedProviderWalkLegs>=1);
});
