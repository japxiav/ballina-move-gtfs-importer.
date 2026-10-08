'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,planDoorToDoor,nonDominatedJourneys,buildPedestrianPaths}=require('../dist/index.js');
const DATE='2026-10-08',home={lat:54.11,lon:-9.16},hospital={lat:53.85184,lon:-9.30599};
const p=s=>({lat:s.lat,lon:s.lon});
const calendar={serviceId:'thursday',startDate:DATE,endDate:DATE,weekdays:[false,false,false,false,true,false,false]};
const mockRouter=(a,b)=>({durationSeconds:Math.ceil(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*65000)/1.2),distanceMeters:Math.ceil(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*65000)),geometry:[a,b],provider:'mock-pedestrian'});
function timetable(nearCount){
 const near=Array.from({length:nearCount},(_,i)=>({id:'origin'+(i+1),name:'Origin',lat:home.lat+(i+1)*0.00035,lon:home.lon}));
 const destination={id:'hospital',name:'Mayo',...hospital};
 const nothing=Array.from({length:nearCount-1},(_,i)=>({id:'nowhere'+(i+1),name:'Elsewhere',lat:54.35+(i+1)*.001,lon:-9.6}));
 const stops=[...near,destination,...nothing];
 const routes=near.map((_,i)=>({id:'r'+i,name:'R'+i,mode:'bus'}));
 const trips=near.map((_,i)=>({id:'t'+i,routeId:'r'+i,serviceId:'thursday'}));
 const stopTimes=trips.flatMap((t,i)=>[
  {tripId:t.id,stopId:near[i].id,sequence:1,arrivalSeconds:36000,departureSeconds:36000},
  {tripId:t.id,stopId:i===nearCount-1?'hospital':nothing[i].id,sequence:2,arrivalSeconds:39600,departureSeconds:39600}
 ]);
 return {feedVersion:'adversarial',timezone:'Europe/Dublin',stops,routes,trips,stopTimes,calendars:[calendar],exceptions:[]};
}
const baseReq={origin:home,destination:hospital,serviceDate:DATE,departAfterSeconds:9*3600,maxTransfers:0,maxWalkingMeters:1800,minBoardingSeconds:60,minTransferSeconds:120,limit:3};
for(const count of [5,6,7])test(`topology selection keeps useful stop number ${count} with only 4 pedestrian candidates`,async()=>{
 const r=await planDoorToDoor(timetable(count),{walk:async(a,b)=>mockRouter(a,b)},baseReq,{maxOriginStops:4,maxDestinationStops:2,maxTransferPairs:0,maxRequestCount:12,maxDirectWalkMeters:0});
 assert.equal(r.journeys.length,1);assert.equal(r.journeys[0].legs.find(x=>x.type==='ride').tripId,'t'+(count-1));
});
test('does not prune the less-uncertain itinerary despite later arrival',()=>{
 const safe={arrivalAtSeconds:43000,walkingMeters:550,transfers:0,latestLeaveAtSeconds:35900,requiresSnapConfirmation:false};
 const snap={arrivalAtSeconds:42000,walkingMeters:500,transfers:0,latestLeaveAtSeconds:36000,requiresSnapConfirmation:true};
 assert.equal(nonDominatedJourneys([safe,snap]).length,2);
 assert.equal(nonDominatedJourneys([snap,safe]).length,2);
});
test('risk inferred from walk legs before the journey summary is calculated',()=>{
 const a={arrivalAtSeconds:43000,walkingMeters:550,transfers:0,latestLeaveAtSeconds:35900,legs:[{type:'walk',purpose:'access'}]};
 const b={arrivalAtSeconds:42000,walkingMeters:500,transfers:0,latestLeaveAtSeconds:36000,legs:[{type:'walk',purpose:'access',requiresSnapConfirmation:true}]};
 assert.equal(nonDominatedJourneys([a,b]).length,2);
});
test('first boarding cannot exceed 18-hour horizon even when earlier stops on same trip fit',()=>{
 const a={id:'a',name:'A',lat:54.1,lon:-9.1},b={id:'b',name:'B',lat:54.11,lon:-9.11},c={id:'c',name:'C',lat:54.12,lon:-9.12};
 const data={feedVersion:'test',timezone:'Europe/Dublin',stops:[a,b,c],routes:[{id:'r',name:'r',mode:'bus'}],trips:[{id:'trip',routeId:'r',serviceId:'thursday'}],stopTimes:[{tripId:'trip',stopId:'a',sequence:1,arrivalSeconds:9*3600,departureSeconds:9*3600},{tripId:'trip',stopId:'b',sequence:2,arrivalSeconds:27*3600+1800,departureSeconds:27*3600+1800},{tripId:'trip',stopId:'c',sequence:3,arrivalSeconds:28*3600,departureSeconds:28*3600}],calendars:[calendar],exceptions:[]};
 const route={origin:p(b),destination:p(c),access:[{stopId:'b',durationSeconds:0,distanceMeters:0,geometry:[p(b),p(b)],provider:'mock'}],egress:[{stopId:'c',durationSeconds:0,distanceMeters:0,geometry:[p(c),p(c)],provider:'mock'}],transfers:[]};
 assert.equal(planJourneys(data,route,{serviceDate:DATE,departAfterSeconds:8*3600,maxTransfers:0}).length,0);
});
test('walking calls are concurrent but never exceed a worker pool of 2',async()=>{
 const origin=home,destination=hospital;
 const stops=[...Array.from({length:6},(_,i)=>({id:'o'+i,name:'o',lat:origin.lat+.0007*(i+1),lon:origin.lon})),...Array.from({length:6},(_,i)=>({id:'d'+i,name:'d',lat:destination.lat+.0007*(i+1),lon:destination.lon}))];
 let current=0,peak=0,count=0;
 const router={walk:async(a,b)=>{count++;current++;peak=Math.max(peak,current);await new Promise(r=>setTimeout(r,12));current--;return {durationSeconds:30,distanceMeters:100,geometry:[a,b],provider:'mock'};}};
 await buildPedestrianPaths(router,stops,origin,destination,{maxRequestCount:12,maxOriginStops:6,maxDestinationStops:6,maxDirectWalkMeters:0,maxTransferPairs:0,maxConcurrentWalkingRequests:2});
 assert.equal(count,12);assert.equal(peak,2);
});
test('request-level deadline prevents serial provider delay accumulation',async()=>{
 const router={walk:async()=>new Promise(resolve=>setTimeout(()=>resolve(null),1000))};
 const stops=Array.from({length:6},(_,i)=>({id:'s'+i,name:'s',lat:home.lat+(i+1)*0.0002,lon:home.lon}));
 const start=performance.now();
 await assert.rejects(buildPedestrianPaths(router,stops,home,hospital,{maxOriginStops:6,maxDestinationStops:0,maxTransferPairs:0,maxDirectWalkMeters:0,requestDeadlineMs:110,maxConcurrentWalkingRequests:2}),/request_timeout/);
 assert.ok(performance.now()-start<800);
});
test('provider budget remains strict with concurrent workers',async()=>{
 const stops=Array.from({length:12},(_,i)=>({id:'s'+i,name:'s',lat:home.lat+(i+1)*.0005,lon:home.lon}));
 let calls=0;
 await buildPedestrianPaths({walk:async(a,b)=>{calls++;return mockRouter(a,b)}},stops,home,hospital,{maxOriginStops:12,maxDestinationStops:0,maxTransferPairs:0,maxDirectWalkMeters:0,maxRequestCount:5,maxConcurrentWalkingRequests:3});
 assert.equal(calls,5);
});
test('time-impossible transfers do not hide a fifth, genuinely direct route',async()=>{
 const near=Array.from({length:5},(_,i)=>({id:'n'+i,name:'stop',lat:home.lat+(i+1)*0.00035,lon:home.lon}));
 const interchange={id:'interchange',name:'Interchange',lat:54.05,lon:-9.20};
 const dst={id:'hospital',name:'Hospital',...hospital};
 const routes=Array.from({length:5},(_,i)=>({id:'r'+i,name:'R'+i,mode:'bus'}));
 routes.push({id:'connecting',name:'Connecting',mode:'bus'});
 const trips=routes.map((r,i)=>({id:'t'+i,routeId:r.id,serviceId:'thursday'}));
 const stopTimes=trips.flatMap((t,i)=>i<4?[
  {tripId:t.id,stopId:near[i].id,sequence:1,arrivalSeconds:36000,departureSeconds:36000},
  {tripId:t.id,stopId:'interchange',sequence:2,arrivalSeconds:39600,departureSeconds:39600}
 ]:i===4?[
  {tripId:t.id,stopId:near[4].id,sequence:1,arrivalSeconds:36000,departureSeconds:36000},
  {tripId:t.id,stopId:'hospital',sequence:2,arrivalSeconds:41400,departureSeconds:41400}
 ]:[
  {tripId:t.id,stopId:'interchange',sequence:1,arrivalSeconds:37800,departureSeconds:37800},
  {tripId:t.id,stopId:'hospital',sequence:2,arrivalSeconds:43000,departureSeconds:43000}
 ]);
 const data={feedVersion:'f',timezone:'Europe/Dublin',stops:[...near,interchange,dst],routes,trips,stopTimes,calendars:[calendar],exceptions:[]};
 const res=await planDoorToDoor(data,{walk:async(a,b)=>mockRouter(a,b)}, {...baseReq,maxTransfers:1},{maxOriginStops:4,maxDestinationStops:1,maxRequestCount:12,maxTransferPairs:0,maxDirectWalkMeters:0});
 assert.equal(res.journeys.length,1);
 assert.equal(res.journeys[0].legs.find(x=>x.type==='ride').tripId,'t4');
});
test('concurrent walking completion order does not change candidate ordering',async()=>{
 const origin=home,destination=hospital,stops=Array.from({length:4},(_,i)=>({id:'s'+i,name:'s',lat:home.lat+(i+1)*0.0006,lon:home.lon}));
 const result=await buildPedestrianPaths({walk:async(a,b)=>{
   const index=Math.round((b.lat-home.lat)/0.0006);
   await new Promise(resolve=>setTimeout(resolve,(5-index)*5));
   return mockRouter(a,b);
 }},stops,origin,destination,{maxOriginStops:4,maxDestinationStops:0,maxTransferPairs:0,maxDirectWalkMeters:0,maxConcurrentWalkingRequests:3});
 assert.deepEqual(result.access.map(a=>a.stopId),['s0','s1','s2','s3']);
});
test('the 24-label cap reserves a less-uncertain alternative even after 25 earlier arrivals',()=>{
 const risky={id:'risky',name:'Risky',lat:54.11,lon:-9.16};
 const safer={id:'safer',name:'Safer',lat:54.1106,lon:-9.16};
 const dest={id:'destination',name:'Destination',lat:54.115,lon:-9.16};
 const trips=Array.from({length:26},(_,i)=>({id:'route'+i,routeId:'r',serviceId:'thursday'}));
 const stopTimes=trips.flatMap((t,i)=>[{tripId:t.id,stopId:i===25?'safer':'risky',sequence:1,arrivalSeconds:9*3600+1800+i*50,departureSeconds:9*3600+1800+i*50},{tripId:t.id,stopId:'destination',sequence:2,arrivalSeconds:10*3600+i*60,departureSeconds:10*3600+i*60}]);
 // The last trip has a later arrival, but much less walking and no snap warning.
 stopTimes.at(-2).arrivalSeconds=10*3600+1800;stopTimes.at(-2).departureSeconds=10*3600+1800;
 stopTimes.at(-1).arrivalSeconds=11*3600+1800;stopTimes.at(-1).departureSeconds=11*3600+1800;
 const data={feedVersion:'f',timezone:'Europe/Dublin',stops:[risky,safer,dest],routes:[{id:'r',name:'r',mode:'bus'}],trips,stopTimes,calendars:[calendar],exceptions:[]};
 const walk=(a,b,d,uncertain)=>({stopId:b.id,durationSeconds:60,distanceMeters:d,geometry:[p(a),p(b)],provider:'mock',...(uncertain?{requiresSnapConfirmation:true}:{})});
 const paths={origin:home,destination:p(dest),access:[walk(home,risky,200,true),walk(home,safer,20,false)],egress:[{stopId:dest.id,durationSeconds:0,distanceMeters:0,geometry:[p(dest),p(dest)],provider:'mock'}],transfers:[]};
 const journeys=planJourneys(data,paths,{serviceDate:DATE,departAfterSeconds:9*3600,maxTransfers:0,rankBy:'less_walking',limit:5});
 assert.ok(journeys.some(j=>j.legs.some(l=>l.type==='ride'&&l.tripId==='route25')));
 assert.equal(journeys[0].walkingMeters,20);
});
test('a contradictory summary cannot mask a snap warning present in a walk leg',()=>{
 const safe={arrivalAtSeconds:44000,walkingMeters:500,transfers:0,latestLeaveAtSeconds:34000,requiresSnapConfirmation:false,legs:[{type:'walk',purpose:'access'}]};
 const bad={arrivalAtSeconds:43000,walkingMeters:400,transfers:0,latestLeaveAtSeconds:35000,requiresSnapConfirmation:false,legs:[{type:'walk',purpose:'access',requiresSnapConfirmation:true}]};
 assert.equal(nonDominatedJourneys([bad,safe]).length,2);
});
