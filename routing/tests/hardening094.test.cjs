'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {loadActiveGtfsSnapshot,planJourneys,proximityMeters,createRoutingApi,createMemoryRateLimiter,offsetServiceDate}=require('../dist');
const ROOT=path.join(__dirname,'..');
const date='2026-10-08';
const A={id:'A',lat:54.11101,lon:-9.1599,name:'Ballina'};
const B={id:'B',lat:53.85184,lon:-9.30599,name:'Hospital'};
const route={id:'420',name:'420',mode:'bus'};
const fullDay=[false,false,false,false,false,false,false];
const paths={origin:{lat:A.lat,lon:A.lon},destination:{lat:B.lat,lon:B.lon},access:[{stopId:'A',distanceMeters:0,durationSeconds:0,provider:'test',geometry:[A,A]}],egress:[{stopId:'B',distanceMeters:0,durationSeconds:0,provider:'test',geometry:[B,B]}],transfers:[]};
function serviceFixture({scheduleDate,depart,arrive,serviceId='S',exception=null}={}) {
 const dow=new Date(scheduleDate+'T00:00:00Z').getUTCDay();const weekdays=[...fullDay];weekdays[dow]=true;
 return {feedVersion:'f',timezone:'Europe/Dublin',stops:[A,B],routes:[route],trips:[{id:'T',routeId:'420',serviceId}],stopTimes:[
 {tripId:'T',stopId:'A',sequence:1,arrivalSeconds:depart,departureSeconds:depart,pickupType:0},
 {tripId:'T',stopId:'B',sequence:2,arrivalSeconds:arrive,departureSeconds:arrive,dropOffType:0}
 ],calendars:[{serviceId,startDate:scheduleDate,endDate:scheduleDate,weekdays}],exceptions:exception?[exception]:[]};
}
function query(data,time){return planJourneys(data,paths,{serviceDate:date,departAfterSeconds:time,maxTransfers:0,limit:3,minBoardingSeconds:0});}

test('overnight: yesterday service with 25:05 boarding becomes 01:05 today, not hidden',()=>{
 const db=serviceFixture({scheduleDate:'2026-10-07',depart:25*3600+5*60,arrive:25*3600+25*60});
 const result=query(db,30*60);assert.equal(result.length,1);
 const ride=result[0].legs.find(l=>l.type==='ride');
 assert.equal(ride.serviceDate,'2026-10-07'); assert.equal(ride.boardAtSeconds,65*60);assert.equal(ride.alightAtSeconds,85*60);
});
test('overnight: tomorrow active 00:20 trip visible after 23:50, with correct service date',()=>{
 const db=serviceFixture({scheduleDate:'2026-10-09',depart:20*60,arrive:45*60});
 const result=query(db,23*3600+50*60);assert.equal(result.length,1);
 const ride=result[0].legs.find(l=>l.type==='ride');
 assert.equal(ride.serviceDate,'2026-10-09');assert.equal(ride.boardAtSeconds,24*3600+20*60);
});
test('ordinary morning query never fabricates tomorrow morning as current-day transport',()=>{
 const db=serviceFixture({scheduleDate:'2026-10-09',depart:9*3600,arrive:10*3600});
 assert.equal(query(db,9*3600).length,0);
});
test('removed exception on preceding day never leaks 25h GTFS trip into next day',()=>{
 const db=serviceFixture({scheduleDate:'2026-10-07',depart:25*3600+5*60,arrive:25*3600+25*60,exception:{serviceId:'S',date:'2026-10-07',type:2}});
 assert.equal(query(db,30*60).length,0);
});
test('service dates use calendar arithmetic rather than local DST offsets',()=>{
 assert.equal(offsetServiceDate('2026-10-08',-1),'2026-10-07');
 assert.equal(offsetServiceDate('2026-12-31',1),'2027-01-01');
 assert.throws(()=>offsetServiceDate('2026-02-30',1),/invalid_service_date_offset/);
});
test('endpoint matching accepts 16m for a stop but rejects >25m stop drift',()=>{
 const db=serviceFixture({scheduleDate:date,depart:10*3600,arrive:11*3600});
 const minor={...A,lat:A.lat+0.000145}; const bad={...A,lat:A.lat+0.00035};
 assert.ok(proximityMeters(A,minor)<25);assert.ok(proximityMeters(A,bad)>25);
 const small=structuredClone(paths);small.access[0].geometry=[small.origin,minor];
 const large=structuredClone(paths);large.access[0].geometry=[large.origin,bad];
 assert.equal(planJourneys(db,small,{serviceDate:date,departAfterSeconds:9*3600,maxTransfers:0}).length,1);
 assert.equal(planJourneys(db,large,{serviceDate:date,departAfterSeconds:9*3600,maxTransfers:0}).length,0);
});

// Supabase's Edge wrapper, transpiled locally, with all Deno imports stubbed:
// no network access, no actual secrets, and no paid Stadia requests.
function edgeHarness({token='T'.repeat(48)}={}) {
 const file=fs.readFileSync(path.join(ROOT,'supabase/functions/ballina-routing-preview/index.ts'),'utf8');
 const js=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const secrets={SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SECRET_KEYS:JSON.stringify({default:'admin-server-secret'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'public-key'}),STADIA_API_KEY:'stadia-server',BALLINA_ROUTING_PREVIEW_TOKEN:token};
 const context={exports:{},Deno:{env:{get:n=>secrets[n]},serve:fn=>{context.serve=fn}},serve:null,console:{error:()=>{}},Response,Request,URL,Uint8Array,TextEncoder,crypto,JSON};
 let calls=0;
 const modules={
  './src/httpApi.ts':{createRoutingApi:()=>async()=>{calls++;return Response.json({routed:true})},createSnapshotCache:f=>f},
  './src/gtfsSnapshot.ts':{loadActiveGtfsSnapshot:()=>Promise.resolve({})},
  './src/pedestrian.ts':{StadiaWalkingRouter:class{constructor(){} }},
  './src/supabaseLimiter.ts':{createSupabaseRateLimiter:()=>async()=>true},
 };
 const req=(n)=>modules[n]||{};
 const execute=new Function('require','exports','Deno','Response','Request','URL','Uint8Array','TextEncoder','crypto','console',js);
 execute(req,context.exports,context.Deno,Response,Request,URL,Uint8Array,TextEncoder,crypto,context.console);
 return {serve:context.serve,calls:()=>calls};
}
const edgeURL='https://example.test/functions/v1/ballina-routing-preview/v1/journeys';
function request(token){return new Request(edgeURL,{method:'POST',headers:{'x-ballina-preview-token':token,'Content-Type':'application/json'},body:'{}'});}
test('preview rejects publishable and administrative project keys as paid API credentials',async()=>{
 const edge=edgeHarness();
 for(const key of ['public-key','admin-server-secret','wrong-token'])assert.equal((await edge.serve(request(key))).status,401);
 assert.equal(edge.calls(),0);
});
test('preview accepts only its own long separate configured secret, not clients or browser origins',async()=>{
 const edge=edgeHarness();const r=await edge.serve(request('T'.repeat(48)));
 assert.equal(r.status,200);assert.equal((await r.json()).routed,true);assert.equal(edge.calls(),1);
});
test('preview refuses any paid routes if preview token absent or too short',async()=>{
 const edge=edgeHarness({token:'short'});const r=await edge.serve(request('short'));
 assert.equal(r.status,503);assert.equal(edge.calls(),0);
});
test('preview GET health never invokes paid planner',async()=>{
 const edge=edgeHarness();const r=await edge.serve(new Request('https://example.test/functions/v1/ballina-routing-preview/health',{headers:{apikey:'public-key'}}));
 assert.equal(r.status,200);assert.equal(edge.calls(),0);assert.equal((await r.json()).public_planning_enabled,false);
});
test('database failure emits sanitized telemetry with an ID matching the 503 response',async()=>{
 const events=[];const SECRET='token-leak-would-be-disastrous';
 const api=createRoutingApi({loadTimetable:async()=>{throw Error('DATABASE_URL='+SECRET)},router:{walk:async()=>null},clientIdentity:()=> 'pilot',consumeRateLimit:createMemoryRateLimiter(),reportError:event=>events.push(event),now:()=>new Date('2026-10-08T09:00:00Z')});
 const r=await api(new Request('https://example.test/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceDate:date,departAt:'10:30',origin:{lat:A.lat,lon:A.lon},destination:{lat:B.lat,lon:B.lon}})}));
 assert.equal(r.status,503);const body=await r.json();assert.equal(typeof body.requestId,'string');assert.equal(body.requestId,events[0].requestId);
 assert.equal(events[0].stage,'snapshot');assert.equal(events[0].code,'unexpected_error');
 assert.doesNotMatch(JSON.stringify(events)+JSON.stringify(body),/DATABASE_URL|token-leak/);
});
test('telemetry recorder failure never leaks data or breaks the sanitized response',async()=>{
 const api=createRoutingApi({loadTimetable:async()=>{throw Error('top secret')},router:{walk:async()=>null},clientIdentity:()=> 'pilot',consumeRateLimit:createMemoryRateLimiter(),reportError:()=>{throw Error('logger broken')},now:()=>new Date('2026-10-08T09:00:00Z')});
 const r=await api(new Request('https://example.test/v1/nearby-stops?lat=54.11101&lon=-9.1599'));
 assert.equal(r.status,503);assert.equal((await r.json()).error,'temporarily_unavailable');
});
// Mock PostgREST Content-Range and an artificial 1ms latency to assert bounded parallel paging.
function countedSnapshot({malformed=false}={}) {
 const version='hash';let inflight=0,max=0;const pages=[];
 const table={gtfs_stops:Array.from({length:2001},(_,i)=>({version,stop_id:i===0?'A':i===2000?'B':'S'+i,stop_name:'Stop',stop_lat:54,stop_lon:-9})),
 gtfs_routes:[{version,route_id:'R',route_type:3}],gtfs_trips:[{version,trip_id:'T',route_id:'R',service_id:'wk'}],
 gtfs_stop_times:[{version,trip_id:'T',stop_id:'A',stop_sequence:1,departure_seconds:28800,arrival_seconds:28800},{version,trip_id:'T',stop_id:'B',stop_sequence:2,arrival_seconds:32000,departure_seconds:32000}],
 gtfs_calendars:[{version,service_id:'wk',start_date:date,end_date:date,thursday:true}],gtfs_calendar_dates:[]};
 const fetcher=async url=>{
  inflight++;max=Math.max(inflight,max);await new Promise(resolve=>setTimeout(resolve,1));inflight--;
  const u=new URL(url),name=u.pathname.split('/').at(-1);
  if(name==='gtfs_feed_versions')return Response.json([{version}]);
  const arr=table[name]||[];const offset=Number(u.searchParams.get('offset')||0),size=Number(u.searchParams.get('limit')||1000);
  const rows=arr.slice(offset,offset+size);pages.push({name,offset});
  const total=malformed&&name==='gtfs_stops'?1001:arr.length;
  return Response.json(rows,{headers:{'Content-Range':rows.length?`${offset}-${offset+rows.length-1}/${total}`:`*/${total}`}});
 };
 return {go:()=>loadActiveGtfsSnapshot({supabaseUrl:'https://fake.supabase.co',privateKey:'fake-secret',pageSize:500,fetcher}),metrics:()=>({max,pages})};
}
test('snapshot uses bounded parallel paging when PostgREST supplies exact Content-Range',async()=>{
 const h=countedSnapshot();const snap=await h.go();assert.equal(snap.stops.length,2001);
 assert.ok(h.metrics().max>=2 && h.metrics().max<=6);
 assert.deepEqual(h.metrics().pages.filter(x=>x.name==='gtfs_stops').map(x=>x.offset),[0,500,1000,1500,2000]);
});
test('snapshot never accepts a stale or inconsistent counted response',async()=>{
 await assert.rejects(countedSnapshot({malformed:true}).go(),/snapshot_count_mismatch/);
});
