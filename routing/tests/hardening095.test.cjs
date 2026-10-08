'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {StadiaWalkingRouter,buildPedestrianPaths,planJourneys,createRoutingApi,createMemoryRateLimiter,proximityMeters}=require('../dist');
const {readFileSync}=require('node:fs');
const A={id:'a',name:'Ballina',lat:54.11101,lon:-9.1599},B={id:'b',name:'Hospital',lat:53.85184,lon:-9.30599};
const date='2026-10-08';
function encode(points){let lastLat=0,lastLon=0;let shape='';function part(v){let x=v<0?~(v<<1):(v<<1);while(x>=32){shape+=String.fromCharCode((32|(x&31))+63);x>>=5;}shape+=String.fromCharCode(x+63);}for(const p of points){const lat=Math.round(p.lat*1e6),lon=Math.round(p.lon*1e6);part(lat-lastLat);part(lon-lastLon);lastLat=lat;lastLon=lon;}return shape;}
const shift=(p,m)=>({...p,lat:p.lat+m/111195});
function walker(shape,events){return new StadiaWalkingRouter('fake-key',async()=>Response.json({trip:{summary:{time:366,length:0.465},legs:[{shape:encode(shape)}]}}),'https://api-eu.stadiamaps.com',x=>events.push(x));}
test('house setback of ~40m accepted but stop setback of ~40m rejected; only bucketed telemetry',async()=>{
 const user={lat:54.110,lon:-9.160},stop={lat:54.11101,lon:-9.1599}; const events=[];
 const w=walker([shift(user,40),shift(stop,6)],events);
 const good=await w.walk(user,stop,{fromRole:'user',toRole:'stop'});
 assert.ok(good);assert.ok(good.endpointSnapMeters.from>=39&&good.endpointSnapMeters.from<=41);
 assert.deepEqual(events.map(x=>x.bucket),['25-50','5-12']);
 assert.equal(events[0].accepted,true);
 assert.doesNotMatch(JSON.stringify(events),/54\.11|-9\.1|lat|lon|fake-key/);
 const rejected=await w.walk(user,stop,{fromRole:'stop',toRole:'stop'});
 assert.equal(rejected,null);assert.equal(events[2].accepted,false);
});
test('router drift recorder failure never affects accepted walking leg',async()=>{
 const user={lat:54.110,lon:-9.160};const stop={lat:54.11101,lon:-9.1599};
 const w=new StadiaWalkingRouter('fake',async()=>Response.json({trip:{summary:{time:150,length:0.4},legs:[{shape:encode([user,stop])}]}}),'https://api-eu.stadiamaps.com',()=>{throw Error('logs offline')});
 assert.ok(await w.walk(user,stop,{fromRole:'user',toRole:'stop'}));
});
test('walk candidates pass explicit user/stop roles, never guessing stop tolerance at a house',async()=>{
 const from={lat:54.110,lon:-9.160};const stop={id:'s',name:'stop',lat:54.11101,lon:-9.1599};
 const roles=[];const router={walk:async(a,b,r)=>{roles.push(r);return {durationSeconds:120,distanceMeters:145,provider:'test',geometry:[a,b]};}};
 await buildPedestrianPaths(router,[stop],from,{lat:54.1106,lon:-9.1601},{maxRequestCount:2,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:0});
 assert.deepEqual(roles[0],{fromRole:'user',toRole:'stop'});
 assert.deepEqual(roles[1],{fromRole:'stop',toRole:'user'});
});
const testData={feedVersion:'f',timezone:'Europe/Dublin',stops:[A,B],routes:[{id:'r',name:'420',mode:'bus'}],trips:[{id:'t',routeId:'r',serviceId:'s'}],stopTimes:[{tripId:'t',stopId:'a',sequence:1,arrivalSeconds:10*3600,departureSeconds:10*3600},{tripId:'t',stopId:'b',sequence:2,arrivalSeconds:11*3600,departureSeconds:11*3600}],calendars:[{serviceId:'s',startDate:date,endDate:date,weekdays:[false,false,false,false,true,false,false]}],exceptions:[]};
test('planner accepts user snap 40m on access but rejects 40m at boarding stop',()=>{
 const home={lat:54.1105,lon:-9.1599};
 const base={origin:home,destination:B,access:[{stopId:'a',durationSeconds:200,distanceMeters:500,geometry:[shift(home,40),shift(A,10)],provider:'mock',endpointSnapMeters:{from:40,to:10}}],egress:[{stopId:'b',durationSeconds:0,distanceMeters:0,geometry:[B,B],provider:'mock'}],transfers:[]};
 const req={serviceDate:date,departAfterSeconds:9*3600,maxTransfers:0};
 const good=planJourneys(testData,base,req);assert.equal(good.length,1);
 assert.equal(good[0].legs.find(x=>x.type==='walk').endpointSnapMeters.from,40);
 assert.equal(planJourneys(testData,{...base,access:[{...base.access[0],geometry:[shift(home,60),shift(A,40)]}]},req).length,0);
});
test('late GTFS service-day crossing has explicit raw service seconds and calendar offsets',()=>{
 const prev='2026-10-07';const over={...testData,calendars:[{serviceId:'s',startDate:prev,endDate:prev,weekdays:[false,false,false,true,false,false,false]}],stopTimes:[{tripId:'t',stopId:'a',sequence:1,arrivalSeconds:25*3600+5*60,departureSeconds:25*3600+5*60},{tripId:'t',stopId:'b',sequence:2,arrivalSeconds:25*3600+35*60,departureSeconds:25*3600+35*60}]};
 const paths={origin:A,destination:B,access:[{stopId:'a',durationSeconds:0,distanceMeters:0,geometry:[A,A],provider:'mock'}],egress:[{stopId:'b',durationSeconds:0,distanceMeters:0,geometry:[B,B],provider:'mock'}],transfers:[]};
 const j=planJourneys(over,paths,{serviceDate:date,departAfterSeconds:30*60,maxTransfers:0,minBoardingSeconds:0})[0];
 assert.ok(j);const r=j.legs.find(x=>x.type==='ride');
 assert.equal(r.serviceDate,prev);assert.equal(r.boardAtSeconds,65*60);
 assert.equal(r.boardAtServiceSeconds,25*3600+5*60);assert.equal(r.boardDayOffset,1);assert.equal(r.alightDayOffset,1);
});
function apiFor(failed,events=[],now=new Date('2026-10-08T08:00:00Z')){
 return createRoutingApi({loadTimetable:async()=>{if(failed)throw failed;return testData;},router:{walk:async()=>null},clientIdentity:()=> 'test',consumeRateLimit:createMemoryRateLimiter(),reportError:e=>events.push(e),now:()=>now});
}
async function queryApi(api,serviceDate=date){return api(new Request('https://localhost/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceDate,departAt:'10:00',origin:{lat:A.lat,lon:A.lon},destination:{lat:B.lat,lon:B.lon}})}));}
test('snapshot mismatch and invalid count errors have distinct sanitized telemetry codes',async()=>{
 for(const code of ['snapshot_count_mismatch','invalid_snapshot_count']){
  const events=[];const r=await queryApi(apiFor(Error(code),events));assert.equal(r.status,503);assert.equal(events[0].code,code);
 }
});
test('abort timeout is categorized without exposing upstream messages',async()=>{
 const e=Error('https://fake.secret.invalid/api');e.name='TimeoutError';const events=[];
 const r=await queryApi(apiFor(e,events));assert.equal(r.status,503);assert.equal(events[0].code,'request_timeout');
 assert.doesNotMatch(JSON.stringify(events)+JSON.stringify(await r.json()),/fake.secret/);
});
test('Monday after clock change explicitly signals excluded Sunday services',async()=>{
 const r=await queryApi(apiFor(null,[],new Date('2026-10-26T06:00:00Z')),'2026-10-26');
 assert.equal(r.status,200);const body=await r.json();
 assert.ok(body.coverageWarnings.some(x=>x.code==='adjacent_dst_service_day_excluded'&&x.dates.includes('2026-10-25')));
});
test('TypeScript dependency is resolved from project modules rather than Node executable path',()=>{
 assert.ok(require('typescript').version); const testSrc=readFileSync(require.resolve('./hardening094.test.cjs'),'utf8');
 assert.match(testSrc,/require\('typescript'\)/);assert.doesNotMatch(testSrc,/realpathSync\(process\.argv\[0\]\)/);
});
test('journey response tells passenger about unverified street-snap gaps without claiming a fully walkable path',async()=>{
 const home=shift(A,-58);const captured=[];
 const fakeRouter={walk:async(a,b,roles)=>{
   captured.push(roles);
   return {durationSeconds:100,distanceMeters:140,provider:'STADIA-MOCK',
     geometry:[shift(a,roles?.fromRole==='user'?42:0),b],
     endpointSnapMeters:{from:roles?.fromRole==='user'?42:0,to:0}};
 }};
 const api=createRoutingApi({loadTimetable:async()=>testData,router:fakeRouter,clientIdentity:()=> 'pilot',consumeRateLimit:createMemoryRateLimiter(),now:()=>new Date('2026-10-08T08:00:00Z')});
 const r=await api(new Request('https://localhost/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceDate:date,departAt:'09:00',origin:{lat:home.lat,lon:home.lon},destination:{lat:B.lat,lon:B.lon},maxTransfers:0})}));
 assert.equal(r.status,200);const data=await r.json();assert.ok(data.journeys.length);
 assert.ok(data.coverageWarnings.some(x=>x.code==='street_snap_gap_unrouted'));
 assert.equal(data.journeys[0].legs.find(x=>x.type==='walk').endpointSnapMeters.from,42);
});
test('tomorrow service date retains request-relative board seconds and service-relative zero-day offset',()=>{
 const tomorrow='2026-10-09';const over={...testData,calendars:[{serviceId:'s',startDate:tomorrow,endDate:tomorrow,weekdays:[false,false,false,false,false,true,false]}],stopTimes:[
 {tripId:'t',stopId:'a',sequence:1,departureSeconds:20*60,arrivalSeconds:20*60},
 {tripId:'t',stopId:'b',sequence:2,departureSeconds:40*60,arrivalSeconds:40*60}]};
 const paths={origin:A,destination:B,access:[{stopId:'a',durationSeconds:0,distanceMeters:0,geometry:[A,A],provider:'mock'}],egress:[{stopId:'b',durationSeconds:0,distanceMeters:0,geometry:[B,B],provider:'mock'}],transfers:[]};
 const j=planJourneys(over,paths,{serviceDate:date,departAfterSeconds:23*3600+50*60,maxTransfers:0,minBoardingSeconds:0})[0];
 assert.ok(j);const r=j.legs.find(x=>x.type==='ride');
 assert.equal(r.serviceDate,tomorrow);assert.equal(r.boardAtSeconds,24*3600+20*60);assert.equal(r.boardAtServiceSeconds,20*60);assert.equal(r.boardDayOffset,0);
});
