const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,planDoorToDoor,journeyConnections,journeyBoardingDetails,buildPedestrianPaths,proximityMeters}=require('../dist');
const day='2026-10-08';
const S=(id,lat,lon=-9.16)=>({id,name:id,code:id+'-CODE',lat,lon});
const A=S('A',54.1100),HUB=S('Ballina Bus Station',54.112),HUB2=S('Opposite Terminal Stop',54.11215,-9.1605),D=S('Destination Stop',54.1300);
const home={lat:54.1095,lon:-9.16},dest={lat:54.1303,lon:-9.16};
const path=(a,b,secs,meters)=>({durationSeconds:secs,distanceMeters:meters,geometry:[a,b],provider:'fixture-not-stadia'});
function timetable(interstop=false){
 const inBus={id:'IN',routeId:'445',serviceId:'TODAY',headsign:'Ballina Bus Stn'};
 const outBus={id:'OUT',routeId:'420',serviceId:'TODAY',headsign:'Mayo Hospital'};
 return {feedVersion:'test-fixture-only',timezone:'Europe/Dublin',stops:[A,HUB,HUB2,D],routes:[{id:'445',name:'445',mode:'bus'},{id:'420',name:'420',mode:'bus'}],trips:[inBus,outBus],stopTimes:[
   {tripId:'IN',stopId:'A',sequence:1,arrivalSeconds:9*3600,departureSeconds:9*3600+600},
   {tripId:'IN',stopId:HUB.id,sequence:2,arrivalSeconds:9*3600+1800,departureSeconds:9*3600+1830},
   {tripId:'OUT',stopId:interstop?HUB2.id:HUB.id,sequence:1,arrivalSeconds:9*3600+2400,departureSeconds:9*3600+2400},
   {tripId:'OUT',stopId:D.id,sequence:2,arrivalSeconds:10*3600+600,departureSeconds:10*3600+600},
  ],calendars:[{serviceId:'TODAY',startDate:day,endDate:day,weekdays:[false,false,false,false,true,false,false]}],exceptions:[]};
}
const req={serviceDate:day,departAfterSeconds:9*3600,maxTransfers:1,minBoardingSeconds:60,minTransferSeconds:180};
test('bus -> same bus station -> second bus -> walk: gives precise second boarding stop',()=>{
 const data=timetable(),paths={origin:A,destination:dest,access:[{stopId:A.id,...path(A,A,0,0)}],egress:[{stopId:D.id,...path(D,dest,180,220)}],transfers:[]};
 const journeys=planJourneys(data,paths,req);
 assert.equal(journeys.length,1);
 const j=journeys[0];
 assert.deepEqual(j.legs.map(x=>x.type),['walk','ride','ride','walk']);
 assert.deepEqual(j.legs.filter(x=>x.type==='ride').map(x=>x.routeName),['445','420']);
 assert.equal(j.transfers,1);
 const connection=journeyConnections(j,data.stops)[0];
 assert.equal(connection.kind,'same_stop');
 assert.equal(connection.alightStopId,HUB.id);
 assert.equal(connection.boardStopId,HUB.id);
 assert.equal(connection.scheduledWindowSeconds,600);
 assert.equal(connection.waitingAfterWalkSeconds,600);
 assert.equal(connection.boarding.stopCode,HUB.code);
 assert.equal(connection.boarding.sideOfStreet,null);
 assert.equal(connection.guaranteed,false);
});
test('bus -> station -> REAL pedestrian transfer leg -> second bus -> walk: show both stops',()=>{
 const data=timetable(true),paths={origin:A,destination:dest,access:[{stopId:A.id,...path(A,A,0,0)}],egress:[{stopId:D.id,...path(D,dest,180,220)}],transfers:[
   {fromStopId:HUB.id,toStopId:HUB2.id,...path(HUB,HUB2,120,180)}
 ]};
 const journeys=planJourneys(data,paths,req);
 assert.equal(journeys.length,1);
 const j=journeys[0];
 assert.deepEqual(j.legs.map(x=>x.type),['walk','ride','walk','ride','walk']);
 const connection=journeyConnections(j,data.stops)[0];
 assert.equal(connection.kind,'walk_between_stops');
 assert.equal(connection.alightStopId,HUB.id);
 assert.equal(connection.boardStopId,HUB2.id);
 assert.equal(connection.transferWalkMeters,180);
 assert.equal(connection.waitingAfterWalkSeconds,480);
 assert.equal(connection.boarding.stopCode,HUB2.code);
});
test('does not invent a walk between nearby but disconnected boarding stops',()=>{
 const data=timetable(true),paths={origin:A,destination:dest,access:[{stopId:A.id,...path(A,A,0,0)}],egress:[{stopId:D.id,...path(D,dest,180,220)}],transfers:[]};
 assert.deepEqual(planJourneys(data,paths,req),[]);
});
test('rejects a second bus departing before the actual transfer walk and buffer',()=>{
 const data=timetable(true);
 data.stopTimes.find(x=>x.tripId==='OUT').departureSeconds=9*3600+1800+120+179;
 data.stopTimes.find(x=>x.tripId==='OUT').arrivalSeconds=data.stopTimes.find(x=>x.tripId==='OUT').departureSeconds;
 const paths={origin:A,destination:dest,access:[{stopId:A.id,...path(A,A,0,0)}],egress:[{stopId:D.id,...path(D,dest,180,220)}],transfers:[
 {fromStopId:HUB.id,toStopId:HUB2.id,...path(HUB,HUB2,120,180)}]};
 assert.deepEqual(planJourneys(data,paths,req),[]);
});
test('walk -> bus -> walk remains available without any transfers',()=>{
 const data=timetable();const paths={origin:home,destination:dest,
  access:[{stopId:A.id,...path(home,A,90,135)}],egress:[{stopId:HUB.id,...path(HUB,dest,1200,1400)},{stopId:D.id,...path(D,dest,90,140)}],transfers:[]};
 const j=planJourneys(data,paths,{...req,maxTransfers:0});
 assert.ok(j.length>=1);
 assert.deepEqual(j[0].legs.map(l=>l.type),['walk','ride','walk']);
 assert.equal(journeyConnections(j[0],data.stops).length,0);
});
test('walking budget must not discard later transit path with much shorter walk',()=>{
 const data=timetable();const A2=S('A2',54.1096);
 data.stops.push(A2);
 data.trips.push({id:'FAST_BUT_WALK_HEAVY',routeId:'445',serviceId:'TODAY'},
                 {id:'SLOW_BUT_LIGHT',routeId:'445',serviceId:'TODAY'});
 data.trips=data.trips.filter(t=>t.id!=='IN');
 data.stopTimes=data.stopTimes.filter(s=>s.tripId!=='IN');
 data.stopTimes.push(
  {tripId:'FAST_BUT_WALK_HEAVY',stopId:A.id,sequence:1,arrivalSeconds:9*3600,departureSeconds:9*3600+600},
  {tripId:'FAST_BUT_WALK_HEAVY',stopId:HUB.id,sequence:2,arrivalSeconds:9*3600+1400,departureSeconds:9*3600+1400},
  {tripId:'SLOW_BUT_LIGHT',stopId:A2.id,sequence:1,arrivalSeconds:9*3600,departureSeconds:9*3600+800},
  {tripId:'SLOW_BUT_LIGHT',stopId:HUB.id,sequence:2,arrivalSeconds:9*3600+1600,departureSeconds:9*3600+1600},
 );
 const paths={origin:home,destination:dest,access:[
   {stopId:A.id,...path(home,A,30,2350)},{stopId:A2.id,...path(home,A2,30,100)}
 ],egress:[{stopId:D.id,...path(D,dest,90,200)}],transfers:[]};
 const journeys=planJourneys(data,paths,{...req,maxWalkingMeters:2500});
 assert.equal(journeys.length,1);
 assert.deepEqual(journeys[0].legs.filter(l=>l.type==='ride').map(l=>l.tripId),['SLOW_BUT_LIGHT','OUT']);
 assert.equal(journeys[0].walkingMeters,300);
});
test('identical origin at terminal generates a zero-length access without paid walking calls',async()=>{
 const data=timetable();let billed=0;
 const router={walk:async(a,b)=>{billed++;return proximityMeters(a,b)>300?null:path(a,b,90,120)}};
 const route=await planDoorToDoor(data,router,{...req,origin:A,destination:dest},{maxRequestCount:2,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:0});
 assert.ok(route.journeys.length>0);
 assert.equal(route.journeys[0].legs[0].durationSeconds,0);
 assert.equal(route.journeys[0].legs[0].distanceMeters,0);
 assert.equal(billed,1); // only the final egress is paid
});
test('connections detail rejects walked geometry ending at a different platform stop',()=>{
 const data=timetable(true);
 const fabricated={legs:[
  {type:'ride',routeName:'445',alightStopId:HUB.id,alightAtSeconds:34200},
  {type:'walk',purpose:'transfer',from:HUB,to:D,durationSeconds:120,distanceMeters:130},
  {type:'ride',routeName:'420',boardStopId:HUB2.id,boardAtSeconds:34800},
 ]};
 assert.throws(()=>journeyConnections(fabricated,data.stops),/connection_unexpected_walk/);
});

test('real 420 GTFS stop and schedule accepts synthetic incoming station connection',()=>{
 const fs=require('node:fs');
 const {fromSupabaseTables}=require('../dist');
 const original=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json')));
 const actual=fromSupabaseTables(original.tables);
 const station=actual.stops.find(s=>s.name==='Ballina Bus Stn');
 const hospital=actual.stops.find(s=>s.name==='Mayo Hospital');
 const origin={id:'SYNTHETIC_ORIGIN',name:'Test-only origin',code:'TEST-ONLY',lat:54.125,lon:-9.14};
 const tripId='SYNTHETIC_INCOMING_NOT_NTA';
 const d={...actual,stops:[...actual.stops,origin],routes:[...actual.routes,{id:'SYNTHETIC_445',name:'SYNTHETIC INBOUND',mode:'bus'}],
  trips:[...actual.trips,{id:tripId,routeId:'SYNTHETIC_445',serviceId:'66',headsign:station.name}],
  stopTimes:[...actual.stopTimes,
   {tripId,stopId:origin.id,sequence:1,arrivalSeconds:6*3600+40*60,departureSeconds:6*3600+50*60},
   {tripId,stopId:station.id,sequence:2,arrivalSeconds:7*3600+45*60,departureSeconds:7*3600+45*60}]
 };
 const paths={origin,destination:hospital,access:[{stopId:origin.id,...path(origin,origin,0,0)}],
  egress:[{stopId:hospital.id,...path(hospital,hospital,0,0)}],transfers:[]};
 const journeys=planJourneys(d,paths,{serviceDate:day,departAfterSeconds:6*3600+45*60,maxTransfers:1,minTransferSeconds:180});
 assert.equal(journeys.length,1);
 assert.deepEqual(journeys[0].legs.filter(x=>x.type==='ride').map(x=>x.tripId),[tripId,'5913_63092']);
 const change=journeyConnections(journeys[0],d.stops)[0];
 assert.equal(change.kind,'same_stop');
 assert.equal(change.boardStopCode,'555051');
 assert.equal(change.scheduledWindowSeconds,900);
 assert.equal(journeys[0].arrivalAtSeconds,31920);
});
test('private HTTP API includes second-stop transfer instructions and never claims guarantee',async()=>{
 const {createRoutingApi}=require('../dist');
 const data=timetable(true);
 // Walking directly from A to the second boarding stop takes a longer street route.
 // This creates a genuine trade-off: the connecting journey walks less and is
 // therefore NOT dominated by the direct 420 journey.
 const router={walk:async(a,b)=>proximityMeters(a,b)>300?null:
   (a.lat===A.lat&&a.lon===A.lon&&b.lat===HUB2.lat&&b.lon===HUB2.lon)
   ?path(a,b,90,400):path(a,b,90,150)};
 const api=createRoutingApi({loadTimetable:async()=>data,router,clientIdentity:()=> 'private-test',consumeRateLimit:async()=>true,now:()=>new Date('2026-10-08T09:00:00Z')});
 const http=new Request('https://private.example/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceDate:day,departAt:'09:00',origin:{lat:A.lat,lon:A.lon},destination:dest,maxTransfers:1,limit:3})});
 const response=await api(http);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.realtime,false);
 const connected=body.journeys.find(j=>j.transfers===1);
 assert.ok(connected,'two buses and their connecting walk must be represented');
 assert.equal(connected.connections.length,1);
 assert.equal(connected.connections[0].kind,'walk_between_stops');
 assert.equal(connected.connections[0].boardStopId,HUB2.id);
 assert.equal(connected.connections[0].guaranteed,false);
 assert.equal(connected.boardingDetails.length,2);
 assert.equal(connected.boardingDetails[1].locationConfidence,'official_unverified');
});
