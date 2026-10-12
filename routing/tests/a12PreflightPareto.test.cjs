'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,planDoorToDoor,buildPedestrianPaths}=require('../dist');
const home={lat:54.1,lon:-9.2},destination={lat:54.1025,lon:-9.2};
const stops=[{id:'A',name:'Ballina demo A',lat:54.1005,lon:-9.2},{id:'B',name:'Ballina demo B',lat:54.101,lon:-9.2},{id:'C',name:'Foxford demo',lat:54.102,lon:-9.2}];
const data={feedVersion:'a12-synthetic-only',timezone:'Europe/Dublin',stops,routes:[{id:'R',name:'fixture',mode:'bus'}],trips:[{id:'T',routeId:'R',serviceId:'WK'}],stopTimes:stops.map((s,i)=>({tripId:'T',stopId:s.id,sequence:i+1,arrivalSeconds:32400+i*600,departureSeconds:32400+i*600})),calendars:[{serviceId:'WK',startDate:'2026-10-01',endDate:'2026-10-31',weekdays:[true,true,true,true,true,true,true]}],exceptions:[]};
const walk=(from,to,durationSeconds,distanceMeters)=>({provider:'a12-offline-fixture',geometry:[from,to],durationSeconds,distanceMeters});
const paths={origin:home,destination,access:[{stopId:'A',...walk(home,stops[0],60,120)},{stopId:'B',...walk(home,stops[1],100,120)}],egress:[{stopId:'C',...walk(stops[2],destination,60,60)}],transfers:[]};
const req={origin:home,destination,serviceDate:'2026-10-08',departAfterSeconds:30600,maxTransfers:0,minBoardingSeconds:60,maxWalkingMeters:500,limit:5};
test('A12: adding an earlier access cannot erase later origin departure on the same vehicle',()=>{
 const only=planJourneys(data,{...paths,access:[paths.access[1]]},req);
 for(const access of [paths.access,[...paths.access].reverse()]){
  const found=planJourneys({...data,stops:[...stops].reverse(),stopTimes:[...data.stopTimes].reverse()},{...paths,access},req);
  assert.equal(found.length,1);assert.equal(found[0].legs.find(l=>l.type==='ride').boardStopId,'B');
  assert.equal(found[0].latestLeaveAtSeconds,only[0].latestLeaveAtSeconds);
  assert.equal(found[0].arrivalAtSeconds,33660);assert.equal(found[0].walkingMeters,180);
 }
});
test('A12: latest origin departure survives a second vehicle and waiting at interchange',()=>{
 const end={id:'D',name:'Castlebar demo',lat:54.103,lon:-9.2};
 const connected={...data,stops:[...stops,end],trips:[...data.trips,{id:'T2',routeId:'R',serviceId:'WK'}],stopTimes:[...data.stopTimes,{tripId:'T2',stopId:'C',sequence:1,arrivalSeconds:34000,departureSeconds:34000},{tripId:'T2',stopId:'D',sequence:2,arrivalSeconds:35000,departureSeconds:35000}]};
 const found=planJourneys(connected,{...paths,egress:[{stopId:'D',...walk(end,destination,60,60)}]},{...req,maxTransfers:1});
 assert.equal(found.length,1);assert.equal(found[0].latestLeaveAtSeconds,32840);
 assert.equal(found[0].legs.filter(l=>l.type==='ride').length,2);assert.equal(found[0].walkingMeters,180);
});
for(const [name,override] of Object.entries({dst:{serviceDate:'2026-10-25'},invalidDate:{serviceDate:'2026-02-30'},invalidTime:{departAfterSeconds:90000},nanTransfers:{maxTransfers:NaN},nanLimit:{limit:NaN},infiniteWalk:{maxWalkingMeters:Infinity},invalidRanking:{rankBy:'random'}})){
 test(`A12 preflight: ${name} consumes zero provider calls`,async()=>{
  let calls=0;const router={walk:async(a,b)=>{calls++;return walk(a,b,60,120)}};
  await assert.rejects(planDoorToDoor(data,router,{...req,...override},{maxRequestCount:3,maxDirectWalkMeters:0}));
  assert.equal(calls,0);
 });
}
for(const value of [NaN,Infinity,1.1,-1]){
 test(`A12 budget rejects ${String(value)} before any walking`,async()=>{
  let calls=0;const router={walk:async(a,b)=>{calls++;return walk(a,b,60,120)}};
  const opts={maxRequestCount:value,maxDirectWalkMeters:0};
  await assert.rejects(buildPedestrianPaths(router,stops,home,destination,opts));
  await assert.rejects(planDoorToDoor(data,router,req,opts));assert.equal(calls,0);
 });
}
test('A12: concurrent provider attempts never exceed each valid integral budget',async()=>{
 for(const budget of [0,1,2,3,12]){
  let calls=0;const router={walk:async(a,b)=>{calls++;await Promise.resolve();return walk(a,b,60,120)}};
  const found=await buildPedestrianPaths(router,stops,home,destination,{maxRequestCount:budget,maxConcurrentWalkingRequests:3,maxOriginStops:3,maxDestinationStops:3,maxTransferPairs:0,maxDirectWalkMeters:0});
  assert.ok(calls<=budget);assert.equal(found.coverage.executed,calls);
 }
});
test('A12: invalid scheduler caps/deadlines fail before calls',async()=>{
 for(const opts of [{maxOriginStops:NaN},{maxDestinationStops:1.5},{maxTransferPairs:Infinity},{requestDeadlineMs:0},{maxConcurrentWalkingRequests:0},{candidateRadiusMeters:NaN},{maxDirectWalkMeters:NaN}]){
  let calls=0;const router={walk:async()=>{calls++;return null}};
  await assert.rejects(buildPedestrianPaths(router,stops,home,destination,opts));assert.equal(calls,0);
 }
});
test('A12: 37 boardable stops keep the latest leave option through the boarding cap',()=>{
 const many=Array.from({length:37},(_,i)=>({id:'S'+i,name:'synthetic access',lat:54.1001+i*0.00001,lon:-9.2}));
 const end={id:'Z',name:'synthetic destination',lat:54.102,lon:-9.2};
 const tt={...data,stops:[...many,end],stopTimes:[...many,end].map((s,i)=>({tripId:'T',stopId:s.id,sequence:i+1,arrivalSeconds:32400+i*60,departureSeconds:32400+i*60}))};
 const pp={...paths,access:many.map(s=>({stopId:s.id,...walk(home,s,100,120)})),egress:[{stopId:'Z',...walk(end,destination,60,60)}]};
 for(const reverse of [false,true]){
  const found=planJourneys({...tt,stops:reverse?[...tt.stops].reverse():tt.stops,stopTimes:reverse?[...tt.stopTimes].reverse():tt.stopTimes},{...pp,access:reverse?[...pp.access].reverse():pp.access},req);
  assert.equal(found.length,1);assert.equal(found[0].legs.find(l=>l.type==='ride').boardStopId,'S36');
  assert.equal(found[0].latestLeaveAtSeconds,34400);
 }
});
test('A12: latest-leave feeder survives the 24-label cap and a shared onward ride',()=>{
 const x={id:'X',name:'synthetic interchange',lat:54.102,lon:-9.2},end={id:'D',name:'synthetic end',lat:54.103,lon:-9.2};
 const incoming=Array.from({length:25},(_,i)=>({id:'F'+i,routeId:'R',serviceId:'WK'}));
 const feeder={id:'latest',routeId:'R',serviceId:'WK'},onward={id:'onward',routeId:'R',serviceId:'WK'};
 const row=(tripId,stopId,sequence,at)=>({tripId,stopId,sequence,arrivalSeconds:at,departureSeconds:at});
 const tt={...data,stops:[stops[0],x,end],trips:[...incoming,feeder,onward],stopTimes:[...incoming.flatMap((t,i)=>[row(t.id,'A',1,29000+i*100),row(t.id,'X',2,30000+i*100)]),row('latest','A',1,34000),row('latest','X',2,34500),row('onward','X',1,35000),row('onward','D',2,36000)]};
 const pp={...paths,access:[paths.access[0]],egress:[{stopId:'D',...walk(end,destination,60,60)}]};
 for(const reverse of [false,true]){
  const found=planJourneys({...tt,trips:reverse?[...tt.trips].reverse():tt.trips,stopTimes:reverse?[...tt.stopTimes].reverse():tt.stopTimes},pp,{...req,departAfterSeconds:28000,maxTransfers:1});
  assert.equal(found.length,1);assert.deepEqual(found[0].legs.filter(l=>l.type==='ride').map(l=>l.tripId),['latest','onward']);
  assert.equal(found[0].latestLeaveAtSeconds,33880);assert.equal(found[0].arrivalAtSeconds,36060);
 }
});
