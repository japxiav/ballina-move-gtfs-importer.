const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fromSupabaseTables,planJourneys,planDoorToDoor,journeyConnections,journeyOverlay}=require('../dist');
const day='2026-10-08',seq=Date.now();
const real=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/nta-445-to-420-real-connection-2026-10-08.json')));
const gtfs=fromSupabaseTables(real.tables);
const stop=id=>gtfs.stops.find(s=>s.id===id);
const ballycastle=stop('8490B5549601');
const station=stop('8490B5550501');
const hospital=stop('8490B151091');
const position=s=>({lat:s.lat,lon:s.lon});
const walking=(from,to,seconds=0,meters=0,provider='fixture-walk-not-live')=>({durationSeconds:seconds,distanceMeters:meters,geometry:[from,to],provider});
const today={serviceDate:day,departAfterSeconds:7*3600+50*60,maxTransfers:1,minBoardingSeconds:60,minTransferSeconds:180,maxWalkingMeters:2500};
function walkPaths(){return {origin:position(ballycastle),destination:position(hospital),access:[{...walking(position(ballycastle),position(ballycastle)),stopId:ballycastle.id}],egress:[{...walking(position(hospital),position(hospital)),stopId:hospital.id}],transfers:[]}}

test('REAL 445 -> 420: both trips, same-day calendar, no fabricated incoming bus',()=>{
 const j=planJourneys(gtfs,walkPaths(),today);
 assert.equal(j.length,1);
 assert.deepEqual(j[0].legs.filter(l=>l.type==='ride').map(l=>l.tripId),['5913_64455','5913_63105']);
 assert.deepEqual(j[0].legs.filter(l=>l.type==='ride').map(l=>[l.boardAtSeconds,l.alightAtSeconds]),[[28500,30600],[38700,41580]]);
 const [x]=journeyConnections(j[0],gtfs.stops);
 assert.equal(x.kind,'same_stop');
 assert.equal(x.alightStopId,'8490B5550501');
 assert.equal(x.boardStopId,'8490B5550501');
 assert.equal(x.waitingAfterWalkSeconds,8100); // 2h15, feasible, not necessarily optimal
 assert.equal(x.guaranteed,false);
 assert.equal(j[0].transfers,1);
 assert.equal(j[0].predictionType,'scheduled');
});
test('REAL 445/420: miss the first bus => no fictitious connection',()=>{
 assert.deepEqual(planJourneys(gtfs,walkPaths(),{...today,departAfterSeconds:7*3600+55*60}),[]); // 60-second buffer
});
test('REAL 445/420: a late arrival makes the existing trip disappear, never reverse chronology',()=>{
 const changed=structuredClone(gtfs);
 changed.stopTimes.find(x=>x.tripId==='5913_64455'&&x.stopId===station.id).arrivalSeconds=12*3600;
 assert.deepEqual(planJourneys(changed,walkPaths(),today),[]); // whole trip invalid: no phantom transfers
});
test('walk-only route requires actual pedestrian result and no GTFS trip',()=>{
 const data={...gtfs,trips:[],stopTimes:[]};
 const a={lat:54.1100,lon:-9.1600},b={lat:54.1110,lon:-9.1580};
 const direct=walking(a,b,155,340,'mock-pedestrian-road-geometry');
 const p={origin:a,destination:b,access:[],egress:[],transfers:[],direct};
 const j=planJourneys(data,p,{...today,departAfterSeconds:10*3600});
 assert.equal(j.length,1);
 assert.equal(j[0].predictionType,'walking_estimate');
 assert.deepEqual(j[0].legs.map(x=>[x.type,x.purpose]),[['walk','direct']]);
 assert.equal(j[0].boardings.length,0);
 assert.equal(journeyOverlay(j[0],[]).features.length,1);
 assert.equal(journeyConnections(j[0],[]).length,0);
});
test('no phantom walk-only itinerary if pedestrian geometry does not reach destination',()=>{
 const a={lat:54.110,lon:-9.160},b={lat:54.111,lon:-9.158},wrong={lat:54.14,lon:-9.17};
 const fake={origin:a,destination:b,access:[],egress:[],transfers:[],direct:walking(a,wrong,60,100)};
 assert.deepEqual(planJourneys(gtfs,fake,{...today,departAfterSeconds:10*3600}),[]);
});
test('door-to-door direct walk uses provider only when within explicit maximum',async()=>{
 const a={lat:54.110,lon:-9.160},b={lat:54.111,lon:-9.158};let count=0;
 const result=await planDoorToDoor(gtfs,{walk:async(from,to)=>{count++;return walking(from,to,150,270)}},
  {...today,origin:a,destination:b},{maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:0,maxRequestCount:1,maxDirectWalkMeters:1400});
 assert.equal(count,1);
 assert.equal(result.journeys.length,1);
 assert.equal(result.journeys[0].predictionType,'walking_estimate');
});
test('provider direct walk over stated maximum is never recommended',async()=>{
 const a={lat:54.110,lon:-9.160},b={lat:54.111,lon:-9.158};
 const result=await planDoorToDoor(gtfs,{walk:async(from,to)=>walking(from,to,600,1650)},
 {...today,origin:a,destination:b},{maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:0,maxRequestCount:1,maxDirectWalkMeters:1400});
 assert.deepEqual(result.journeys,[]);
});
test('mixed rail + bus itinerary is opt-in, not silently enabled to passengers',async()=>{
 const A={id:'RA',name:'Start Rail',lat:54.11,lon:-9.16};
 const B={id:'RB',name:'Interchange',lat:54.115,lon:-9.165};
 const C={id:'RC',name:'Destination Bus',lat:54.12,lon:-9.17};
 const synth={...gtfs,stops:[A,B,C],routes:[{id:'rail',name:'Rail',mode:'rail'},{id:'bus',name:'Bus',mode:'bus'}],
  trips:[{id:'t-rail',routeId:'rail',serviceId:'66'},{id:'t-bus',routeId:'bus',serviceId:'66'}],
  stopTimes:[{tripId:'t-rail',stopId:'RA',sequence:1,arrivalSeconds:28800,departureSeconds:28800},
   {tripId:'t-rail',stopId:'RB',sequence:2,arrivalSeconds:29100,departureSeconds:29100},
   {tripId:'t-bus',stopId:'RB',sequence:1,arrivalSeconds:29700,departureSeconds:29700},
   {tripId:'t-bus',stopId:'RC',sequence:2,arrivalSeconds:30600,departureSeconds:30600}]};
 const zero={origin:position(A),destination:position(C),access:[{stopId:'RA',...walking(position(A),position(A))}],egress:[{stopId:'RC',...walking(position(C),position(C))}],transfers:[]};
 const possible=planJourneys(synth,zero,{serviceDate:day,departAfterSeconds:7*3600+55*60,maxTransfers:1});
 assert.equal(possible.length,1);
 assert.deepEqual(possible[0].legs.filter(l=>l.type==='ride').map(l=>l.mode),['rail','bus']);
 let paid=0;
 const walkRouter={walk:async()=>{paid++;return null}};
 const params={serviceDate:day,departAfterSeconds:7*3600+55*60,maxTransfers:1,origin:position(A),destination:position(C)};
 const enabled=await planDoorToDoor(synth,walkRouter,params,{includeRail:true,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:0,maxDirectWalkMeters:0});
 assert.equal(enabled.journeys.length,1);
 assert.deepEqual(enabled.journeys[0].legs.filter(l=>l.type==='ride').map(l=>l.mode),['rail','bus']);
 const disabled=await planDoorToDoor(synth,walkRouter,params,{includeRail:false,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:0,maxDirectWalkMeters:0});
 assert.equal(disabled.journeys.length,0);
 assert.ok(paid<=2); // One failed walking request near the disconnected rail origin is permissible.
});
test('real 445 -> 420 with synthetic first and last walking legs has coherent end-to-end ETA',()=>{
 const origin={lat:ballycastle.lat+0.001,lon:ballycastle.lon};
 const destination={lat:hospital.lat-0.001,lon:hospital.lon};
 const paths={origin,destination,access:[{stopId:ballycastle.id,...walking(origin,position(ballycastle),240,145)}],
 egress:[{stopId:hospital.id,...walking(position(hospital),destination,180,135)}],transfers:[]};
 const j=planJourneys(gtfs,paths,{...today,departAfterSeconds:7*3600+45*60});
 assert.equal(j.length,1);
 assert.deepEqual(j[0].legs.map(l=>l.type),['walk','ride','ride','walk']);
 assert.equal(j[0].walkingMeters,280);
 assert.equal(j[0].arrivalAtSeconds,41580+180);
 assert.equal(j[0].boardings.length,2);
 assert.equal(j[0].boardings.every(b=>b.locationConfidence==='official_unverified'),true);
});
test('three transport rides require two transfers, and return all three boarding instructions',()=>{
 const rows=structuredClone(gtfs);
 const start={id:'R0',name:'Preceding stop',lat:ballycastle.lat+0.01,lon:ballycastle.lon};
 rows.stops.push(start);
 rows.trips.push({id:'EARLY_REALISTIC_FIXTURE',routeId:'2 445 c a',serviceId:'66',headsign:'Ballycastle'});
 rows.stopTimes.push({tripId:'EARLY_REALISTIC_FIXTURE',stopId:start.id,sequence:1,departureSeconds:26000,arrivalSeconds:26000},
                    {tripId:'EARLY_REALISTIC_FIXTURE',stopId:ballycastle.id,sequence:2,departureSeconds:27700,arrivalSeconds:27700});
 const ps={origin:position(start),destination:position(hospital),access:[{stopId:start.id,...walking(position(start),position(start))}],
  egress:[{stopId:hospital.id,...walking(position(hospital),position(hospital))}],transfers:[]};
 const depart=7*3600;
 assert.deepEqual(planJourneys(rows,ps,{...today,departAfterSeconds:depart,maxTransfers:1}),[]);
 const full=planJourneys(rows,ps,{...today,departAfterSeconds:depart,maxTransfers:2});
 assert.equal(full.length,1);
 assert.equal(full[0].transfers,2);
 assert.equal(full[0].boardings.length,3);
 assert.equal(journeyConnections(full[0],rows.stops).length,2);
});
