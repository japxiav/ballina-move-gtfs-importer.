'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys}=require('../dist');
const stops=Array.from({length:5},(_,i)=>({id:'S'+i,name:'Stop '+i,lat:54.11+i*.0002,lon:-9.16}));
const home={lat:54.11,lon:-9.16},dest={lat:54.1108,lon:-9.16};
const point=i=>({lat:stops[i].lat,lon:stops[i].lon});
const walk=(a,b)=>({provider:'offline-regression-fixture',distanceMeters:100,durationSeconds:60,geometry:[a,b]});
const paths={origin:home,destination:dest,access:[{stopId:'S0',...walk(home,point(0))}],egress:[{stopId:'S4',...walk(point(4),dest)}],transfers:[{fromStopId:'S1',toStopId:'S2',...walk(point(1),point(2))}]};
const row=(tripId,seq,stopId,time)=>({tripId,sequence:seq,stopId,arrivalSeconds:time,departureSeconds:time,pickupType:0,dropOffType:0});
const base={feedVersion:'terminal-round-fixture',timezone:'Europe/Dublin',stops,routes:[{id:'R',name:'R',mode:'bus'}],trips:[],stopTimes:[],calendars:[{serviceId:'W',startDate:'2026-10-01',endDate:'2026-10-31',weekdays:[true,true,true,true,true,true,true]}],exceptions:[]};
const req={serviceDate:'2026-10-12',departAfterSeconds:8*3600+56*60,maxWalkingMeters:1000,minBoardingSeconds:60,minTransferSeconds:60,limit:5};
const make=ids=>({...base,trips:ids.map(id=>({id,routeId:'R',serviceId:'W'}))});
test('A12 terminal round: direct trip still reaches egress past irrelevant intermediate stops',()=>{
 const tt={...make(['D']),stopTimes:[row('D',1,'S0',9*3600),row('D',2,'S1',9*3600+480),row('D',3,'S2',9*3600+960),row('D',4,'S3',9*3600+1440),row('D',5,'S4',9*3600+1920)]};
 const journeys=planJourneys(tt,paths,{...req,maxTransfers:0});
 assert.ok(journeys.length>0);
 const direct=journeys.find(j=>j.legs.filter(l=>l.type==='ride').length===1);
 assert.ok(direct);
 assert.equal(direct.legs.find(l=>l.type==='ride').alightStopId,'S4');
 assert.equal(direct.legs.filter(l=>l.type==='walk').at(-1).purpose,'egress');
});
test('A12 terminal round: legitimate double transfer remains discoverable only with allowance',()=>{
 const tt={...make(['T1','T2','T3']),stopTimes:[
   row('T1',1,'S0',32400),row('T1',2,'S1',32880),
   row('T2',1,'S2',33480),row('T2',2,'S3',34080),
   row('T3',1,'S3',34680),row('T3',2,'S4',35280),
 ]};
 assert.deepEqual(planJourneys(tt,paths,{...req,maxTransfers:1}),[]);
 const journeys=planJourneys(tt,paths,{...req,maxTransfers:2});
 assert.ok(journeys.some(j=>j.transfers===2&&j.legs.filter(l=>l.type==='ride').length===3));
});
