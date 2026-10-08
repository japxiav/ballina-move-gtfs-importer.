'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {planDoorToDoor,buildPedestrianPaths,planJourneys}=require('../dist/index.js');
const DATE='2026-10-08';
const origin={lat:54.10,lon:-9.16};
const farStop={id:'far',name:'Bus stop reachable in 2 km',lat:54.117,lon:-9.16};
const destination={lat:54.23,lon:-9.16};
const endStop={id:'hospital',name:'Hospital',...destination};
const dist=(a,b)=>Math.round(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*65000));
const walk=(a,b)=>({distanceMeters:dist(a,b),durationSeconds:Math.ceil(dist(a,b)/1.2),geometry:[a,b],provider:'adversarial-stub'});
const calendar={serviceId:'thursday',startDate:DATE,endDate:DATE,weekdays:[false,false,false,false,true,false,false]};
const timetable={feedVersion:'test',timezone:'Europe/Dublin',stops:[farStop,endStop],routes:[{id:'420',name:'420',mode:'bus'}],trips:[{id:'420-am',routeId:'420',serviceId:'thursday'}],stopTimes:[{tripId:'420-am',stopId:'far',sequence:1,arrivalSeconds:10*3600,departureSeconds:10*3600},{tripId:'420-am',stopId:'hospital',sequence:2,arrivalSeconds:11*3600,departureSeconds:11*3600}],calendars:[calendar],exceptions:[]};
const req={origin,destination,serviceDate:DATE,departAfterSeconds:8*3600,maxTransfers:0,maxWalkingMeters:2500,minBoardingSeconds:60,limit:3};
async function routes(options={}){return planDoorToDoor(timetable,{walk:async(a,b)=>walk(a,b)},req,{maxOriginStops:4,maxDestinationStops:4,maxRequestCount:12,maxDirectWalkMeters:0,...options});}
test('REGRESSION: 2.5km walking allowance should include a stop 1.89km away',async()=>{
 const normal=await routes();
 const widened=await routes({candidateRadiusMeters:2500});
 console.log('FINDING radius_default_journeys',normal.journeys.length,'widened_journeys',widened.journeys.length,'walk_meters',widened.journeys[0]?.walkingMeters);
 assert.equal(normal.journeys.length,1);
 assert.equal(widened.journeys.length,1);
});
// Extract exactly the deployed engine implementation, not an imitation.
const engine=fs.readFileSync(path.join(__dirname,'../dist/engine.js'),'utf8');
const first=engine.indexOf('const MAX_STATES_PER_STOP =');
const last=engine.indexOf('function sortStopTimes(',first);
const context={};vm.runInNewContext(engine.slice(first,last)+'\nthis.addBest=addBest;',context);
const addBest=context.addBest;
const state=(i,at,walking)=>({stopId:'transfer',at,walkingMeters:walking,rides:1,legs:[{type:'ride',tripId:'t'+i,serviceDate:DATE}],boardings:[]});
test('REGRESSION: 24 label cap prunes later label even when it has the least walking',()=>{
 const m=new Map();
 for(let i=0;i<24;i++)addBest(m,state(i,30000+i*100,1000-i*25));
 addBest(m,state(24,32500,50));
 const kept=m.get('transfer');
 console.log('FINDING state_25_retained',kept.some(x=>x.walkingMeters===50),'labels',kept.length,'min_walk',Math.min(...kept.map(x=>x.walkingMeters)));
 assert.equal(kept.length,24);
 assert.equal(kept.some(x=>x.walkingMeters===50),true);
});
test('REGRESSION: stop preference counts early bus that passenger cannot physically reach',async()=>{
 const start={lat:54.1,lon:-9.16}, finish={lat:54.25,lon:-9.16};
 const departureStops=Array.from({length:5},(_,i)=>({id:'origin'+i,name:'stop '+i,lat:54.1+(i+1)*0.0004,lon:-9.16}));
 const dest={id:'dest',name:'destination',...finish};
 const routes=departureStops.map((s,i)=>({id:'r'+i,name:'route'+i,mode:'bus'}));
 const trips=departureStops.map((s,i)=>({id:'t'+i,routeId:'r'+i,serviceId:'thursday'}));
 const stopTimes=trips.flatMap((t,i)=>[{tripId:t.id,stopId:departureStops[i].id,sequence:1,arrivalSeconds:i===4?9*3600:8*3600+31*60,departureSeconds:i===4?9*3600:8*3600+31*60},{tripId:t.id,stopId:'dest',sequence:2,arrivalSeconds:i===4?10*3600:9*3600,departureSeconds:i===4?10*3600:9*3600}]);
 const data={feedVersion:'f',timezone:'Europe/Dublin',stops:[...departureStops,dest],routes,trips,stopTimes,calendars:[calendar],exceptions:[]};
 const requested={origin:start,destination:finish,serviceDate:DATE,departAfterSeconds:8*3600+30*60,maxTransfers:0,maxWalkingMeters:2000,minBoardingSeconds:90,limit:3};
 const options={maxOriginStops:4,maxDestinationStops:1,maxRequestCount:12,maxDirectWalkMeters:0,maxTransferPairs:0};
 const res=await planDoorToDoor(data,{walk:async(a,b)=>walk(a,b)},requested,options);
 const widened=await planDoorToDoor(data,{walk:async(a,b)=>walk(a,b)},requested,{...options,maxOriginStops:5});
 console.log('FINDING early_departure_overprioritized',res.journeys.length,'all_5_journeys',widened.journeys.length,'valid_trip',widened.journeys[0]?.legs.find(l=>l.type==='ride')?.tripId);
 assert.equal(res.journeys.length,1);
 assert.equal(widened.journeys.length,1);
});
test('REGRESSION: optional direct walk consumes paid call that silently drops final transfer',async()=>{
 const start={lat:54.1,lon:-9.16},finish={lat:54.105,lon:-9.16};
 const ori=Array.from({length:4},(_,i)=>({id:'o'+i,name:'o'+i,lat:54.1002+i*0.0002,lon:-9.16}));
 const dest=Array.from({length:4},(_,i)=>({id:'d'+i,name:'d'+i,lat:54.1048-i*0.0002,lon:-9.16}));
 const pairs=ori.map((s,i)=>({fromStopId:s.id,toStopId:dest[i].id}));
 const opts={maxOriginStops:4,maxDestinationStops:4,maxTransferPairs:4,maxRequestCount:12,candidateRadiusMeters:1500,transferPairs:pairs,maxConcurrentWalkingRequests:1};
 const withDirect=await buildPedestrianPaths({walk:async(a,b)=>walk(a,b)},[...ori,...dest],start,finish,{...opts,maxDirectWalkMeters:1400});
 const withoutDirect=await buildPedestrianPaths({walk:async(a,b)=>walk(a,b)},[...ori,...dest],start,finish,{...opts,maxDirectWalkMeters:0});
 console.log('FINDING direct_budget_starvation transfer_count_with_direct',withDirect.transfers.length,'without',withoutDirect.transfers.length,'direct',Boolean(withDirect.direct));
 assert.equal(withDirect.transfers.length,4);
 assert.equal(withDirect.transfers.length,withoutDirect.transfers.length);
 assert.equal(withDirect.direct,undefined);
 assert.equal(withDirect.coverage.directSkippedBudget,true);
 assert.equal(withDirect.coverage.executed,12);
});
test('REGRESSION: paid walking calls are made for stops farther than the entire walking allowance',async()=>{
 const stops=Array.from({length:4},(_,i)=>({id:'stop'+i,name:'Stop',lat:origin.lat+.0025+i*.0005,lon:origin.lon}));
 let calls=0;
 const paths=await buildPedestrianPaths({walk:async(a,b)=>{calls++;return walk(a,b)}},stops,origin,destination,{maxOriginStops:4,maxDestinationStops:0,maxTransferPairs:0,maxRequestCount:12,maxPedestrianDistanceMeters:100,maxDirectWalkMeters:0});
 console.log('FINDING avoidable_metered_walk_calls',calls,'valid_access_paths',paths.access.length,'straight_distance_to_closest',dist(origin,stops[0]));
 assert.equal(calls,0);
 assert.equal(paths.access.length,0);
 assert.ok(dist(origin,stops[0])>100);
});
test('REGRESSION: 24-label truncation can erase the only feasible door-to-door connection',()=>{
 const {planJourneys}=require('../dist/index.js');
 const start={lat:54.09,lon:-9.16};
 const interchange={id:'interchange',name:'Interchange',lat:54.11,lon:-9.16};
 const walkDest={id:'transfer',name:'Transfer boarding',lat:54.1143165,lon:-9.16};
 const final={id:'hospital',name:'Hospital',lat:54.14,lon:-9.16};
 const stops=Array.from({length:25},(_,i)=>{
   const m=i===24?10:490-i*20;
   return {id:'first'+i,name:'Start stop',lat:start.lat+m/111200,lon:start.lon};
 });
 const routes=[{id:'first',name:'Feeder',mode:'bus'},{id:'second',name:'Connection',mode:'bus'}];
 const trips=Array.from({length:25},(_,i)=>({id:'feeder'+i,routeId:'first',serviceId:'thursday'}));
 trips.push({id:'connection',routeId:'second',serviceId:'thursday'});
 const stopTimes=trips.flatMap((t,i)=>i<25?[
   {tripId:t.id,stopId:stops[i].id,sequence:1,arrivalSeconds:36000+i*15,departureSeconds:36000+i*15},
   {tripId:t.id,stopId:interchange.id,sequence:2,arrivalSeconds:39600+i*30,departureSeconds:39600+i*30},
 ]:[
   {tripId:t.id,stopId:walkDest.id,sequence:1,arrivalSeconds:40800,departureSeconds:40800},
   {tripId:t.id,stopId:final.id,sequence:2,arrivalSeconds:43000,departureSeconds:43000}
 ]);
 const table={feedVersion:'f',timezone:'Europe/Dublin',stops:[...stops,interchange,walkDest,final],routes,trips,stopTimes,calendars:[calendar],exceptions:[]};
 const access=stops.map((s,i)=>{const m=i===24?10:490-i*20;return {stopId:s.id,distanceMeters:m,durationSeconds:Math.ceil(m/1.2),geometry:[start,{lat:s.lat,lon:s.lon}],provider:'mock'}});
 const paths={origin:start,destination:{lat:final.lat,lon:final.lon},access,egress:[{stopId:final.id,distanceMeters:0,durationSeconds:0,geometry:[final,final],provider:'zero'}],transfers:[{fromStopId:interchange.id,toStopId:walkDest.id,distanceMeters:480,durationSeconds:360,geometry:[interchange,walkDest],provider:'mock'}]};
 const opts={serviceDate:DATE,departAfterSeconds:9*3600,maxTransfers:1,maxWalkingMeters:500,minTransferSeconds:120,limit:3};
 const withAll=planJourneys(table,paths,opts);
 const withOnlyFeeder25=planJourneys({...table,trips:trips.slice(24),stopTimes:stopTimes.filter(st=>st.tripId==='feeder24'||st.tripId==='connection')},{...paths,access:access.slice(24)},opts);
 console.log('FINDING twenty_five_feeders',withAll.length,'only_25th_feeder',withOnlyFeeder25.length,'route',withOnlyFeeder25[0]?.legs.filter(l=>l.type==='ride').map(l=>l.tripId).join(','));
 assert.equal(withAll.length,1);
 assert.equal(withOnlyFeeder25.length,1);
});
