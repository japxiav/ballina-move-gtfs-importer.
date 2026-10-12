'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planJourneys}=require('../dist/engine');

for(const flag of [true,1,'yes'])test(`A12 deferred states preserve snap alternatives for ${JSON.stringify(flag)}`,()=>{
 const stops=[['A',54.1],['X',54.1005],['Y',54.10051],['Z',54.101]].map(([id,lat])=>({id,name:id,lat,lon:-9.2}));
 const origin=stops[0],destination=stops[3];
 const data={feedVersion:'offline',timezone:'Europe/Dublin',stops,routes:[{id:'R',name:'R',mode:'bus'}],trips:['T1','T2'].map(id=>({id,routeId:'R',serviceId:'S'})),
  stopTimes:[['T1','A',1,32400],['T1','X',2,32700],['T2','Y',1,33000],['T2','Z',2,33600]].map(([tripId,stopId,sequence,at])=>({tripId,stopId,sequence,arrivalSeconds:at,departureSeconds:at})),
  calendars:[{serviceId:'S',startDate:'2026-10-08',endDate:'2026-10-08',weekdays:[true,true,true,true,true,true,true]}],exceptions:[]};
 const walk=(a,b,n)=>({geometry:[a,b],durationSeconds:n,distanceMeters:n,provider:'offline-synthetic'});
 const paths={origin,destination,access:[{stopId:'A',...walk(origin,origin,0)}],egress:[{stopId:'Z',...walk(destination,destination,0)}],
  transfers:[{fromStopId:'X',toStopId:'Y',...walk(stops[1],stops[2],10),requiresSnapConfirmation:flag},{fromStopId:'X',toStopId:'Y',...walk(stops[1],stops[2],50)}]};
 const journeys=planJourneys(data,paths,{serviceDate:'2026-10-08',departAfterSeconds:32000,maxTransfers:1,minBoardingSeconds:0,minTransferSeconds:0,maxWalkingMeters:500,limit:5});
 assert.deepEqual(journeys.map(j=>[j.walkingMeters,j.requiresSnapConfirmation]),[[10,true],[50,false]]);
 for(const journey of journeys){
  assert.deepEqual(journey.boardings.map(b=>b.stopId),['A','Y']);
  assert.deepEqual(journey.legs.filter(l=>l.type==='ride').map(l=>l.tripId),['T1','T2']);
 }
});

function continuationCase(){
 const stops=['A','X','Y','Z'].map((id,i)=>({id,name:id,lat:54.1+i*.0005,lon:-9.2}));
 const origin=stops[0],destination=stops[3];
 const data={feedVersion:'offline',timezone:'Europe/Dublin',stops,routes:[{id:'R',name:'R',mode:'bus'}],trips:['T1','T2'].map(id=>({id,routeId:'R',serviceId:'S'})),
  stopTimes:[['T1','A',1,32400],['T1','X',2,33000],['T1','Y',3,33600],['T2','X',1,33300],['T2','Y',2,33900],['T2','Z',3,34200]].map(([tripId,stopId,sequence,at])=>({tripId,stopId,sequence,arrivalSeconds:at,departureSeconds:at})),
  calendars:[{serviceId:'S',startDate:'2026-10-08',endDate:'2026-10-08',weekdays:[true,true,true,true,true,true,true]}],exceptions:[]};
 const walk=(from,to,durationSeconds=0,distanceMeters=0)=>({geometry:[from,to],durationSeconds,distanceMeters,provider:'offline-synthetic'});
 const paths={origin,destination,access:[{stopId:'A',...walk(origin,origin)}],egress:[{stopId:'Z',...walk(destination,destination)}],transfers:[]};
 const request={serviceDate:'2026-10-08',departAfterSeconds:32000,maxTransfers:1,minBoardingSeconds:0,minTransferSeconds:0,maxWalkingMeters:500,limit:5};
 return {data,paths,request,walk};
}
test('A12 consecutive equivalent continuations keep the first boarding instruction',()=>{
 const c=continuationCase(),journeys=planJourneys(c.data,c.paths,c.request);
 assert.equal(journeys.length,1);
 assert.deepEqual(journeys[0].legs.filter(l=>l.type==='ride').map(l=>[l.tripId,l.boardStopId,l.alightStopId]),[['T1','A','X'],['T2','X','Z']]);
 assert.deepEqual(journeys[0].boardings.map(b=>b.stopId),['A','X']);
});
test('A12 first boardings retain the distinct latest feasible leave time',()=>{
 const c=continuationCase();c.data.trips=c.data.trips.filter(t=>t.id==='T2');c.data.stopTimes=c.data.stopTimes.filter(t=>t.tripId==='T2');
 c.paths.access=['X','Y'].map(id=>({stopId:id,...c.walk(c.paths.origin,c.data.stops.find(s=>s.id===id))}));
 const journeys=planJourneys(c.data,c.paths,{...c.request,maxTransfers:0});
 assert.equal(journeys.length,1);
 assert.equal(journeys[0].latestLeaveAtSeconds,33900);
 assert.equal(journeys[0].boardings[0].stopId,'Y');
});
test('A12 consecutive continuations preserve a safe snap alternative',()=>{
 const c=continuationCase();c.data.stopTimes=c.data.stopTimes.filter(r=>!(r.tripId==='T1'&&r.stopId==='Y')&&!(r.tripId==='T2'&&r.stopId==='X'));
 const from=c.data.stops[1],to=c.data.stops[2];
 c.paths.transfers=[{fromStopId:'X',toStopId:'Y',...c.walk(from,to,10,30),requiresSnapConfirmation:true},{fromStopId:'X',toStopId:'Y',...c.walk(from,to,50,30)}];
 const journeys=planJourneys(c.data,c.paths,c.request);
 assert.equal(journeys.length,1);
 assert.equal(journeys[0].walkingMeters,30);
 assert.equal(journeys[0].requiresSnapConfirmation,false);
});
