'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planDoorToDoor}=require('../dist/index.js');
const day='2026-10-08';
const thursday={serviceId:'th',startDate:day,endDate:day,weekdays:[false,false,false,false,true,false,false]};
const point=(id,lat,lon=-9.16)=>({id,name:id,lat,lon});
const sec=(hour,minute=0)=>hour*3600+minute*60;
const st=(tripId,stopId,sequence,t)=>({tripId,stopId,sequence,arrivalSeconds:t,departureSeconds:t});
const walk=(a,b)=>{
 const meters=Math.ceil(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*65000));
 return {distanceMeters:meters,durationSeconds:Math.ceil(meters/1.2),geometry:[a,b],provider:'mock-verified-route'};
};
const o=point('O',54.1), a=point('A',54.13), b=point('B',54.1309), d=point('D',54.2);
const make=(stops,routes,trips,stopTimes,calendars=[thursday])=>({feedVersion:'test',timezone:'Europe/Dublin',stops,routes,trips,stopTimes,calendars,exceptions:[]});
const base=()=>({origin:o,destination:d,serviceDate:day,departAfterSeconds:sec(8,30),maxTransfers:1,maxWalkingMeters:1500,minBoardingSeconds:90,minTransferSeconds:180,limit:5});
const opts={maxOriginStops:2,maxDestinationStops:2,maxTransferPairs:4,maxRequestCount:12,maxDirectWalkMeters:0};
function transferFeed(routes,from=a,to=b){return make([o,from,to,d],routes,[{id:'t1',routeId:routes[0].id,serviceId:'th'},{id:'t2',routeId:routes[1].id,serviceId:'th'}],[st('t1','O',1,sec(9)),st('t1','A',2,sec(9,10)),st('t2','B',1,sec(9,15)),st('t2','D',2,sec(9,30))]);}

test('BM-098-A: distinct vehicles on SAME line may transfer via provider-verified walk',async()=>{
 const tt=transferFeed([{id:'R',name:'420',mode:'bus'},{id:'R',name:'420',mode:'bus'}]);
 let calls=0; const r=await planDoorToDoor(tt,{walk:async(a,b)=>{calls++;return walk(a,b)}},base(),opts);
 assert.equal(r.journeys.length,1);
 assert.equal(r.journeys[0].transfers,1);
 const rides=r.journeys[0].legs.filter(l=>l.type==='ride');
 assert.deepEqual(rides.map(r=>r.tripId),['t1','t2']);
 assert.ok(r.journeys[0].legs.some(l=>l.type==='walk'&&l.purpose==='transfer'&&l.distanceMeters>0));
 assert.ok(calls>=1);
});

test('BM-098-B: different stop IDs with coincident coordinates MUST NOT synthesize walk',async()=>{
 const coincident=point('B',a.lat,a.lon);
 const tt=transferFeed([{id:'R1',name:'First',mode:'bus'},{id:'R2',name:'Second',mode:'bus'}],a,coincident);
 let calls=0;const result=await planDoorToDoor(tt,{walk:async(a,b)=>{calls++;return walk(a,b)}},base(),{...opts,maxRequestCount:1});
 assert.equal(result.journeys.length,0);
 assert.equal(calls,0); // access+egress exactly at stops are free and valid
});

test('BM-098-C: timetable with zero active services spends zero transit walks',async()=>{
 const inactive=make([o,d],[{id:'R',name:'Bus',mode:'bus'}],[{id:'T',routeId:'R',serviceId:'never'}],
 [st('T','O',1,sec(9)),st('T','D',2,sec(10))],
 [{serviceId:'never',startDate:day,endDate:day,weekdays:[false,false,false,false,false,false,false]}]);
 let calls=0;const r=await planDoorToDoor(inactive,{walk:async(a,b)=>{calls++;return walk(a,b)}},
 {...base(),origin:{...o,lat:o.lat+0.0004},destination:{...d,lat:d.lat-0.0004},maxTransfers:0},opts);
 assert.equal(r.journeys.length,0);assert.equal(calls,0);
});

test('BM-098-C guard: walk-only stays available on a day without transit',async()=>{
 const dest={lat:o.lat+0.001,lon:o.lon};
 const tt=make([o],[],[],[],[]);let calls=0;
 const r=await planDoorToDoor(tt,{walk:async(a,b)=>{calls++;return walk(a,b)}},
 {...base(),destination:dest,maxTransfers:0,maxWalkingMeters:700},
 {...opts,maxDirectWalkMeters:700,maxRequestCount:1});
 assert.equal(calls,1);assert.equal(r.journeys.length,1);
 assert.equal(r.journeys[0].predictionType,'walking_estimate');
});

test('BM-098-C guard: active single-day service is NOT rejected by preflight',async()=>{
 const tt=make([o,d],[{id:'R',name:'420',mode:'bus'}],[{id:'T',routeId:'R',serviceId:'th'}],
 [st('T','O',1,sec(9)),st('T','D',2,sec(10))]);
 const r=await planDoorToDoor(tt,{walk:async(a,b)=>walk(a,b)},base(),opts);
 assert.equal(r.journeys.length,1);
});

test('BM-098-A guard: when transfers are disabled no paid transfer walks are attempted',async()=>{
 const tt=transferFeed([{id:'R',name:'420',mode:'bus'},{id:'R',name:'420',mode:'bus'}]);
 let paid=0;
 const r=await planDoorToDoor(tt,{walk:async(a,b)=>{paid++;return walk(a,b)}},{...base(),maxTransfers:0},opts);
 assert.equal(r.journeys.length,0);assert.equal(paid,0);
});

test('GTFS overnight 25:15 from yesterday still counts as service today',async()=>{
 const y='2026-10-07';
 const overnight=make([o,d],[{id:'R',name:'Night Bus',mode:'bus'}],
   [{id:'night',routeId:'R',serviceId:'wed'}],
   [st('night','O',1,sec(25,15)),st('night','D',2,sec(26))],
   [{serviceId:'wed',startDate:y,endDate:y,weekdays:[false,false,false,true,false,false,false]}]);
 let paid=0;
 const r=await planDoorToDoor(overnight,{walk:async(a,b)=>{paid++;return walk(a,b)}},
   {...base(),departAfterSeconds:sec(1),maxTransfers:0},opts);
 assert.equal(r.journeys.length,1);
 assert.equal(r.journeys[0].legs.find(l=>l.type==='ride').serviceDate,y);
 assert.equal(paid,0);
});

test('tomorrow service in the requested 18h window stays reachable',async()=>{
 const fri='2026-10-09';
 const feed=make([o,d],[{id:'R',name:'Morning Bus',mode:'bus'}],
   [{id:'friday',routeId:'R',serviceId:'fri'}],
   [st('friday','O',1,sec(9)),st('friday','D',2,sec(10))],
   [{serviceId:'fri',startDate:fri,endDate:fri,weekdays:[false,false,false,false,false,true,false]}]);
 const r=await planDoorToDoor(feed,{walk:async(a,b)=>walk(a,b)},
   {...base(),departAfterSeconds:sec(20),maxTransfers:0},opts);
 assert.equal(r.journeys.length,1);
 assert.equal(r.journeys[0].legs.find(l=>l.type==='ride').serviceDate,fri);
});

test('new same-route transfers do not crowd out legacy cross-line transfer at one-call budget',async()=>{
 const A=point('A',54.130),B=point('B',54.1309),C=point('C',54.121),E=point('E',54.1211),F=point('F',54.145);
 const tt=make([o,d,A,B,C,E,F],['R1','R2','R3'].map(id=>({id,name:id,mode:'bus'})),
 [{id:'g1',routeId:'R1',serviceId:'th'},{id:'g2',routeId:'R2',serviceId:'th'},
  {id:'d1',routeId:'R3',serviceId:'th'},{id:'d2',routeId:'R3',serviceId:'th'}],
 [st('g1','O',1,sec(9)),st('g1','A',2,sec(9,10)),st('g2','B',1,sec(9,15)),st('g2','D',2,sec(9,30)),
  st('d1','O',1,sec(9)),st('d1','C',2,sec(9,7)),st('d2','E',1,sec(9,20)),st('d2','F',2,sec(9,36))]);
 const transfers=[];
 const r=await planDoorToDoor(tt,{walk:async(x,y,roles)=>{
   if(roles.fromRole==='stop'&&roles.toRole==='stop')transfers.push([x.lat,y.lat]);
   return walk(x,y);
 }},base(),{...opts,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:1,maxRequestCount:3});
 assert.equal(r.journeys.length,1);
 assert.deepEqual(r.journeys[0].legs.filter(l=>l.type==='ride').map(l=>l.tripId),['g1','g2']);
 assert.deepEqual(transfers,[[A.lat,B.lat]]);
});
