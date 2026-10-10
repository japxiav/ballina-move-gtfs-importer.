'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,planDoorToDoor,createRoutingApi,createMemoryRateLimiter,journeyConnections,proximityMeters}=require('../dist');
// Representative published timetable facts checked against our active GTFS on 2026-10-08:
// Ballina -> Manulla arrive 05:32, Manulla -> Dublin depart 05:35; ids are NTA IDs.
// Fixture adds only the stops necessary for a focused, offline deterministic regression.
const serviceDate='2026-10-08';
const B={id:'BallinaStation',name:'Ballina',lat:54.108,lon:-9.156};
const M={id:'ManullaJunction',name:'Manulla Junction',lat:53.904,lon:-9.10};
const D={id:'DublinHeuston',name:'Dublin Heuston',lat:53.346,lon:-6.293};
const BUS={id:'BallinaBusStop',name:'Ballina Bus Stn',lat:B.lat+0.002,lon:B.lon};
const days=[false,false,false,false,true,false,false];
const railFixture=()=>({
 feedVersion:'synthetic-based-on-verified-nta-times',timezone:'Europe/Dublin',
 stops:[B,M,D,BUS],routes:[{id:'DUB-WESTPORT-I',name:'rail',mode:'rail'},{id:'420',name:'420',mode:'bus'}],
 trips:[{id:'5963_13655',routeId:'DUB-WESTPORT-I',serviceId:'280',headsign:'Manulla Junction'},
        {id:'5963_13657',routeId:'DUB-WESTPORT-I',serviceId:'280',headsign:'Dublin Heuston'},
        {id:'BUS1',routeId:'420',serviceId:'280',headsign:'Dublin Heuston'}],
 stopTimes:[
  {tripId:'5963_13655',stopId:B.id,sequence:1,arrivalSeconds:18300,departureSeconds:18300},
  {tripId:'5963_13655',stopId:M.id,sequence:2,arrivalSeconds:19920,departureSeconds:19920},
  {tripId:'5963_13657',stopId:M.id,sequence:1,arrivalSeconds:20040,departureSeconds:20100},
  {tripId:'5963_13657',stopId:D.id,sequence:2,arrivalSeconds:30840,departureSeconds:30840},
  {tripId:'BUS1',stopId:B.id,sequence:1,arrivalSeconds:19000,departureSeconds:19000},
  {tripId:'BUS1',stopId:D.id,sequence:2,arrivalSeconds:35000,departureSeconds:35000}],
 calendars:[{serviceId:'280',startDate:serviceDate,endDate:serviceDate,weekdays:days}],exceptions:[]});
const atStation={origin:B,destination:D,access:[{stopId:B.id,durationSeconds:0,distanceMeters:0,geometry:[B,B],provider:'known-same'}],egress:[{stopId:D.id,durationSeconds:0,distanceMeters:0,geometry:[D,D],provider:'known-same'}],transfers:[]};
const request={serviceDate,departAfterSeconds:17880,maxTransfers:1,minTransferSeconds:180,minBoardingSeconds:90,maxWalkingMeters:500};
const apiBody={serviceDate,departAt:'04:58',origin:{lat:B.lat,lon:B.lon},destination:{lat:D.lat,lon:D.lon},maxTransfers:1,maxWalkingMeters:500,limit:3};
const input=r=>new Request('https://test.invalid/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});
function api(overrides={}) {
 let calls=0;
 const handler=createRoutingApi({loadTimetable:async()=>railFixture(),router:{walk:async(a,b)=>{calls++;if(proximityMeters(a,b)>300)return null;return {durationSeconds:90,distanceMeters:Math.max(1,Math.ceil(proximityMeters(a,b))),geometry:[a,b],provider:'offline-mock'}}},clientIdentity:()=> 'rail-unit-test',consumeRateLimit:createMemoryRateLimiter(()=>Date.now()),now:()=>new Date('2026-10-08T03:58:00Z'),...overrides});
 return {handler,calls:()=>calls};
}
test('same GTFS station: official 3-minute Manulla rail-to-rail interchange survives',()=>{
 const j=planJourneys(railFixture(),atStation,request);
 const railRail=j.find(x=>x.legs.filter(l=>l.type==='ride').length===2);
 assert.ok(railRail,'need Ballina -> Manulla -> Dublin scheduled itinerary');
 assert.deepEqual(railRail.legs.filter(l=>l.type==='ride').map(l=>l.mode),['rail','rail']);
 assert.deepEqual(railRail.legs.filter(l=>l.type==='ride').map(l=>l.tripId),['5963_13655','5963_13657']);
 assert.equal(railRail.transfers,1);assert.equal(railRail.arrivalAtSeconds,30840);
 const connection=journeyConnections(railRail,railFixture().stops)[0];
 assert.equal(connection.kind,'same_stop');assert.equal(connection.scheduledWindowSeconds,180);assert.equal(connection.guaranteed,false);
});
test('one second shorter than minimum transfer buffer is correctly rejected',()=>{
 const data=railFixture();data.stopTimes.find(st=>st.tripId==='5963_13657'&&st.stopId===M.id).departureSeconds=20099;
 const routes=planJourneys(data,atStation,request);
 assert.equal(routes.some(j=>j.legs.filter(l=>l.type==='ride').length===2),false);
});
test('scheduled rail is opt-in and rail-only mode does not select bus legs',async()=>{
 const normal=api();const rb=await normal.handler(input(apiBody));assert.equal(rb.status,200);
 const bs=await rb.json();assert.deepEqual(bs.modes,['bus']);
 assert.ok(bs.journeys.every(j=>j.legs.filter(l=>l.type==='ride').every(l=>l.mode==='bus')));
 const withRail=api();const rr=await withRail.handler(input({...apiBody,modes:['bus','rail']}));assert.equal(rr.status,200);
 const multi=await rr.json();assert.deepEqual(multi.modes,['bus','rail']);
 assert.ok(multi.journeys.some(j=>j.legs.filter(l=>l.type==='ride').some(l=>l.mode==='rail')));
 assert.equal(multi.realtime,false);assert.equal(multi.status,'scheduled_only');
 assert.equal(multi.coverageWarnings.some(x=>x.code==='tight_rail_connection'),true);
 const railOnly=api();const ro=await railOnly.handler(input({...apiBody,modes:['rail']}));assert.equal(ro.status,200);
 const rout=await ro.json();assert.ok(rout.journeys.length>0);
 assert.ok(rout.journeys.every(j=>j.legs.filter(l=>l.type==='ride').every(l=>l.mode==='rail')));
});
test('invalid modes rejected before any route or paid provider is called',async()=>{
 const h=api();for(const modes of [[],['rail','rail'],['air'],['rail',1],['bus','rail','bus'],'rail',null]){
  const x=await h.handler(input({...apiBody,modes}));
  assert.equal(x.status,400,JSON.stringify(modes));
 }assert.equal(h.calls(),0); // malicious modes must never reach a walking provider
});
test('rail station unknown or provider not configured fails without remote fetch',async()=>{
 const h=api();
 const missing=await h.handler(new Request('https://test.invalid/v1/rail/station-board?station=Ballina'));
 assert.equal(missing.status,503);assert.equal((await missing.json()).error,'rail_board_not_configured');
 const bad=await h.handler(new Request('https://test.invalid/v1/rail/station-board?station=Ballina&station=Dublin'));
 assert.equal(bad.status,400);assert.equal(h.calls(),0);
});
test('rail station lookup only accepts GTFS-served rail stations, never arbitrary upstream names',async()=>{
 const requested=[];const h=api({getRailStationBoard:async station=>{requested.push(station);return {station,source:'irish_rail_station_api',fetchedAt:'2026-10-08T00:00:00Z',dataQuality:'official_api_may_show_schedule_only',matchedToGtfsTrips:false,services:[]}}});
 const good=await h.handler(new Request('https://test.invalid/v1/rail/station-board?station=ballina'));assert.equal(good.status,200);
 const report=await good.json();assert.deepEqual(requested,['Ballina']);assert.equal(report.realtimeVerified,false);assert.equal(report.matchedToGtfsTrips,false);
 const notRail=await h.handler(new Request('https://test.invalid/v1/rail/station-board?station=Ballina%20Bus%20Stn'));
 assert.equal(notRail.status,404);assert.deepEqual(requested,['Ballina']);
});
test('rail station board is GET-only and shared provider limiter is enforced',async()=>{
 const keys=[];const h=api({consumeRateLimit:async key=>{keys.push(key);return key!=='rail|station-board|global';},getRailStationBoard:async()=>{throw Error('must_not_fetch')}});
 const r=await h.handler(new Request('https://test.invalid/v1/rail/station-board?station=Ballina'));
 assert.equal(r.status,429);assert.equal(keys.includes('rail|station-board|global'),true);
 const post=await h.handler(new Request('https://test.invalid/v1/rail/station-board',{method:'POST'}));assert.equal(post.status,405);
});
const MBUS={id:'ManullaBus',name:'Manulla bus stop (test only)',lat:M.lat+0.0015,lon:M.lon};
function multimodalFixture(){
 const data=railFixture();
 // Remove the irrelevant direct intercity bus so only a bus-rail connection is possible.
 data.trips=data.trips.filter(x=>x.id!=='BUS1');data.stopTimes=data.stopTimes.filter(x=>x.tripId!=='BUS1');
 data.stops.push(MBUS);
 data.trips.push({id:'BUS_TO_MANULLA',routeId:'420',serviceId:'280'});
 data.stopTimes.push({tripId:'BUS_TO_MANULLA',stopId:BUS.id,sequence:1,arrivalSeconds:18300,departureSeconds:18300},
   {tripId:'BUS_TO_MANULLA',stopId:MBUS.id,sequence:2,arrivalSeconds:19800,departureSeconds:19800});
 return data;
}
test('bus -> verified walking transfer -> train works, but NEVER invents a railway connection',async()=>{
 const data=multimodalFixture();
 const req={serviceDate,departAfterSeconds:18120,maxTransfers:1,minTransferSeconds:180,minBoardingSeconds:90,maxWalkingMeters:1000,origin:BUS,destination:D};
 const options={modes:['bus','rail'],maxOriginStops:2,maxDestinationStops:2,maxTransferPairs:8,maxRequestCount:12};
 const route=async (allowTransfer)=>{
  const walking={walk:async (a,b)=>{
    if(proximityMeters(a,b)>1000 || (a.lat===MBUS.lat&&b.lat===M.lat&&!allowTransfer))return null;
    return {durationSeconds:90,distanceMeters:Math.ceil(proximityMeters(a,b)),geometry:[a,b],provider:'verified-mock-street'};
  }};
  return planDoorToDoor(data,walking,req,options);
 };
 const result=await route(true);
 const busRail=result.journeys.find(j=>j.legs.filter(l=>l.type==='ride').map(l=>l.mode).join(',')==='bus,rail');
 assert.ok(busRail,'must discover real walking connection between different station/stop IDs');
 assert.equal(busRail.legs.filter(l=>l.type==='walk'&&l.purpose==='transfer').length,1);
 assert.equal(journeyConnections(busRail,data.stops)[0].guaranteed,false);
 const unwalkable=await route(false);
 assert.equal(unwalkable.journeys.some(j=>j.legs.filter(l=>l.type==='ride').map(l=>l.mode).join(',')==='bus,rail'),false);
});

test('identical coordinates with DIFFERENT GTFS station IDs never prove walkable rail transfer',async()=>{
 const data=multimodalFixture();data.stops.find(s=>s.id===MBUS.id).lat=M.lat;
 const opts={modes:['bus','rail'],maxRequestCount:12,maxTransferPairs:10};
 let walks=0;
 const routes=await planDoorToDoor(data,{walk:async(a,b)=>{walks++;return {durationSeconds:90,distanceMeters:50,geometry:[a,b],provider:'mock'}}},{serviceDate,departAfterSeconds:18120,maxTransfers:1,minTransferSeconds:180,minBoardingSeconds:90,origin:BUS,destination:D},opts);
 assert.equal(routes.journeys.some(j=>j.legs.filter(l=>l.type==='ride').map(l=>l.mode).join(',')==='bus,rail'),false);
 assert.ok(walks>=0);
});

test('rail station directory is GTFS-sourced and excludes bus-only stops',async()=>{
 const h=api();const r=await h.handler(new Request('https://test.invalid/v1/rail/stations'));
 assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.mode,'rail');assert.equal(data.realtime,false);
 assert.deepEqual(data.stations.map(s=>s.name),['Ballina','Dublin Heuston','Manulla Junction']);
 assert.ok(data.stations.every(s=>s.platformVerified===false));
 assert.equal(h.calls(),0);
});
test('rail stations reject arbitrary query strings and do not call provider',async()=>{
 const h=api();
 const r=await h.handler(new Request('https://test.invalid/v1/rail/stations?debug=1'));
 assert.equal(r.status,400);assert.equal(h.calls(),0);
});
