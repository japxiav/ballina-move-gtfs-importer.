'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planDoorToDoor,buildPedestrianPaths}=require('../dist/index.js');
const {proximityMeters}=require('../dist/boarding.js');
const DATE='2026-10-08';
const cal={serviceId:'th',startDate:DATE,endDate:DATE,weekdays:[false,false,false,false,true,false,false]};
const mk=(id,lat,lon=-9.16)=>({id,name:id,lat,lon});
const A=mk('A',54.10),X=mk('X',54.18),Y=mk('Y',54.1875),Z=mk('Z',54.24);
const foot=(a,b)=>{
 const d=Math.ceil(proximityMeters(a,b));
 return {distanceMeters:d,durationSeconds:Math.ceil(d/1.2),geometry:[a,b],provider:'a01-adversarial-street-stub'};
};
const table={feedVersion:'A01',timezone:'Europe/Dublin',stops:[A,X,Y,Z],routes:[{id:'r1',name:'r1',mode:'bus'},{id:'r2',name:'r2',mode:'bus'}],trips:[{id:'first',routeId:'r1',serviceId:'th'},{id:'second',routeId:'r2',serviceId:'th'}],stopTimes:[
 {tripId:'first',stopId:'A',sequence:1,arrivalSeconds:36000,departureSeconds:36000},
 {tripId:'first',stopId:'X',sequence:2,arrivalSeconds:36900,departureSeconds:36900},
 {tripId:'second',stopId:'Y',sequence:1,arrivalSeconds:38100,departureSeconds:38100},
 {tripId:'second',stopId:'Z',sequence:2,arrivalSeconds:39900,departureSeconds:39900},
 ],calendars:[cal],exceptions:[]};
const req={origin:{lat:A.lat,lon:A.lon},destination:{lat:Z.lat,lon:Z.lon},serviceDate:DATE,departAfterSeconds:35000,maxTransfers:1,maxWalkingMeters:2000,limit:3,minBoardingSeconds:60,minTransferSeconds:120};
const opts={maxOriginStops:1,maxDestinationStops:1,maxRequestCount:5,maxTransferPairs:2,maxDirectWalkMeters:0,maxConcurrentWalkingRequests:1};
const query=(input=req,options=opts,router={walk:async(a,b)=>foot(a,b)})=>planDoorToDoor(table,router,input,options);

test('A01 reproduces: a provider-confirmed ~834m inter-stop walk connects two services with 2km total walking',async()=>{
 const j=await query();
 assert.equal(j.journeys.length,1,'a valid itinerary must not disappear at the 650m candidate cutoff');
 assert.equal(j.journeys[0].legs.filter(l=>l.type==='ride').length,2);
 const w=j.journeys[0].legs.find(l=>l.type==='walk'&&l.purpose==='transfer');
 assert.ok(w,'the connecting street walk must be present');
 assert.ok(w.distanceMeters>650&&w.distanceMeters<950);
 assert.ok(j.journeys[0].walkingMeters<=2000);
});

test('A01 explicitly supplied 834m transfer pair reaches the pedestrian provider',async()=>{
 let transferCalls=0;
 const p=await buildPedestrianPaths({walk:async(a,b,roles)=>{if(roles.fromRole==='stop'&&roles.toRole==='stop')transferCalls++;return foot(a,b);}},[X,Y],X,Y,
 {maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:1,maxPedestrianDistanceMeters:2000,transferPairs:[{fromStopId:'X',toStopId:'Y'}],maxDirectWalkMeters:0});
 assert.equal(transferCalls,1);
 assert.equal(p.transfers.length,1);
});

test('A01 maxWalkingMeters is still a hard limit, not permission to over-walk',async()=>{
 const result=await query({...req,maxWalkingMeters:650});
 assert.equal(result.journeys.length,0);
});

test('A01 too-long transfer never consumes a paid request',async()=>{
 let calls=0;
 const paths=await buildPedestrianPaths({walk:async(a,b)=>{calls++;return foot(a,b);}},[X,Y],X,Y,
 {maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:2,maxPedestrianDistanceMeters:650,transferPairs:[{fromStopId:'X',toStopId:'Y'}],maxDirectWalkMeters:0});
 assert.equal(calls,0);
 assert.equal(paths.transfers.length,0);
});

test('A01 transfers remain directional; reverse route cannot be invented',async()=>{
 const paths=await buildPedestrianPaths({walk:async(a,b)=>foot(a,b)},[X,Y],X,Y,
 {maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:2,maxRequestCount:2,maxPedestrianDistanceMeters:2000,transferPairs:[{fromStopId:'X',toStopId:'Y'}],maxDirectWalkMeters:0});
 assert.deepEqual(paths.transfers.map(p=>[p.fromStopId,p.toStopId]),[['X','Y']]);
});

test('A01 no transfers permitted means no transfer provider queries',async()=>{
 let transfers=0;
 const router={walk:async(a,b,roles)=>{if(roles?.fromRole==='stop'&&roles?.toRole==='stop')transfers++;return foot(a,b);}};
 const r=await query({...req,maxTransfers:0},opts,router);
 assert.equal(transfers,0);
 assert.equal(r.journeys.length,0);
});

test('A01 budget is still respected when there is a long transfer candidate',async()=>{
 let calls=0;
 const r=await query(req,{...opts,maxRequestCount:2}, {walk:async(a,b)=>{calls++;return foot(a,b);}});
 assert.ok(calls<=2);
 assert.equal(r.journeys.length,1,'zero-length access/egress are free; two paid calls suffice');
 assert.equal(r.coverage?.executed,calls);
});

test('A01 accepts a valid walk strictly between 650 and the total walking cap',async()=>{
 const lo=mk('lo',54.10),hi=mk('hi',54.106);
 const r=await buildPedestrianPaths({walk:async(a,b)=>foot(a,b)},[lo,hi],lo,hi,
 {maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:1,maxPedestrianDistanceMeters:750,transferPairs:[{fromStopId:'lo',toStopId:'hi'}],maxDirectWalkMeters:0});
 assert.equal(r.transfers.length,1);
 assert.ok(r.transfers[0].distanceMeters>650);
});

test('A01 zero-call allowance blocks paid transfers even if access/egress are free',async()=>{
 let calls=0;
 const r=await query(req,{...opts,maxRequestCount:0},{walk:async(a,b)=>{calls++;return foot(a,b);}});
 assert.equal(calls,0);
 assert.equal(r.journeys.length,0);
 assert.equal(r.coverage?.candidateLimitReached,true);
});

test('A01 router detour longer than walking cap is rejected even when straight-line distance is shorter',async()=>{
 let transferCalls=0;
 const result=await query(req,opts,{walk:async(a,b,roles)=>{
  const w=foot(a,b);
  if(roles?.fromRole==='stop'&&roles?.toRole==='stop'){transferCalls++;return {...w,distanceMeters:2400};}
  return w;
 }});
 assert.ok(transferCalls>=1);
 assert.equal(result.journeys.length,0);
});

test('A01 per-request pedestrian cap below 834m still rejects without paid transfer call',async()=>{
 let paidTransfers=0;
 const result=await query(req,{...opts,maxPedestrianDistanceMeters:700},{walk:async(a,b,roles)=>{
   if(roles?.fromRole==='stop'&&roles?.toRole==='stop')paidTransfers++;
   return foot(a,b);
 }});
 assert.equal(paidTransfers,0);
 assert.equal(result.journeys.length,0);
});
