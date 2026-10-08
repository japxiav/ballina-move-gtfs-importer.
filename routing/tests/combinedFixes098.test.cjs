'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planDoorToDoor,buildPedestrianPaths}=require('../dist/index.js');
const DATE='2026-10-08';
const origin={lat:54.1,lon:-9.16}, destination={lat:54.25,lon:-9.16};
const calendar={serviceId:'thu',startDate:DATE,endDate:DATE,weekdays:[false,false,false,false,true,false,false]};
function walk(a,b){const d=Math.ceil(Math.hypot((a.lat-b.lat)*111200,(a.lon-b.lon)*65000));return {distanceMeters:d,durationSeconds:Math.ceil(d/1.2),geometry:[a,b],provider:'test-router'};}
test('combined: direct planner honours the request walking cap even without explicit options',async()=>{
 const st={id:'far',name:'Far Stop',lat:54.1025,lon:-9.16};
 const end={id:'end',name:'end',...destination};
 const timetable={feedVersion:'test',timezone:'Europe/Dublin',stops:[st,end],routes:[{id:'r',name:'R',mode:'bus'}],trips:[{id:'t',routeId:'r',serviceId:'thu'}],stopTimes:[{tripId:'t',stopId:'far',sequence:1,arrivalSeconds:36000,departureSeconds:36000},{tripId:'t',stopId:'end',sequence:2,arrivalSeconds:39600,departureSeconds:39600}],calendars:[calendar],exceptions:[]};
 let billed=0;
 const result=await planDoorToDoor(timetable,{walk:async(a,b)=>{billed++;return walk(a,b)}},{origin,destination,serviceDate:DATE,departAfterSeconds:8*3600,maxTransfers:0,maxWalkingMeters:100},{maxRequestCount:12,maxDirectWalkMeters:0});
 assert.equal(result.journeys.length,0);assert.equal(billed,0);
});
test('combined: optional direct walk runs on spare budget, and remains visible',async()=>{
 const a={lat:54.1,lon:-9.16},b={lat:54.101,lon:-9.16};
 let calls=0;
 const p=await buildPedestrianPaths({walk:async(x,y)=>{calls++;return walk(x,y)}},[],a,b,{maxOriginStops:0,maxDestinationStops:0,maxRequestCount:1,maxDirectWalkMeters:1400});
 assert.ok(p.direct);assert.equal(calls,1);assert.equal(p.coverage.directSkippedBudget,false);
});
test('combined: transfer geodesic above entire walk budget never gets billed',async()=>{
 const a={id:'a',name:'a',lat:54.1,lon:-9.16},b={id:'b',name:'b',lat:54.105,lon:-9.16};
 let calls=0;
 const p=await buildPedestrianPaths({walk:async(x,y)=>{calls++;return walk(x,y)}},[a,b],a,b,{maxOriginStops:0,maxDestinationStops:0,transferPairs:[{fromStopId:'a',toStopId:'b'}],maxRequestCount:12,maxPedestrianDistanceMeters:100,maxDirectWalkMeters:0});
 assert.equal(calls,0);assert.equal(p.transfers.length,0);
});
test('combined: zero-budget result explicitly exposes incomplete optional routing',async()=>{
 const a={lat:54.1,lon:-9.16},b={lat:54.101,lon:-9.16};
 let calls=0;
 const p=await buildPedestrianPaths({walk:async(x,y)=>{calls++;return walk(x,y)}},[],a,b,{maxOriginStops:0,maxDestinationStops:0,maxRequestCount:0,maxDirectWalkMeters:1400});
 assert.equal(calls,0);assert.equal(p.direct,undefined);assert.equal(p.coverage.directSkippedBudget,true);
});
test('combined: candidate-limited discovery is acknowledged in aggregate coverage metadata',async()=>{
 const stops=Array.from({length:6},(_,i)=>({id:'s'+i,name:'S',lat:54.1+i*0.0001,lon:-9.16}));
 const p=await buildPedestrianPaths({walk:async(a,b)=>walk(a,b)},stops,origin,destination,{maxOriginStops:2,maxDestinationStops:0,maxRequestCount:2,maxDirectWalkMeters:0});
 assert.equal(p.coverage.candidateLimitReached,true);
});
test('combined: preserve a second lower-walking history, not only the absolute minimum',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../dist/engine.js'),'utf8');
 const a=src.indexOf('const MAX_STATES_PER_STOP ='),b=src.indexOf('function sortStopTimes(',a);
 const ctx={};vm.runInNewContext(src.slice(a,b)+'\nthis.addBest=addBest;',ctx);
 const m=new Map(), mk=(i,meter)=>({stopId:'connection',at:30000+i*100,walkingMeters:meter,rides:1,legs:[{type:'ride',tripId:'trip'+i,serviceDate:DATE}],boardings:[]});
 for(let i=0;i<24;i++)ctx.addBest(m,mk(i,i===0?50:500+i));
 ctx.addBest(m,mk(24,80));
 const saved=m.get('connection');
 assert.equal(saved.length,24);
 assert.ok(saved.some(s=>s.walkingMeters===50));
 assert.ok(saved.some(s=>s.walkingMeters===80),'second-lowest walk and distinct trip history must survive');
});
test('combined: 4 future hourly departures survive the Pareto final filter',()=>{
 const {nonDominatedJourneys}=require('../dist/index.js');
 const rows=[9,10,11,12].map(h=>({arrivalAtSeconds:(h+1)*3600,walkingMeters:500,transfers:0,
   latestLeaveAtSeconds:h*3600-360,departureAtSeconds:8*3600,legs:[]}));
 assert.equal(nonDominatedJourneys(rows).length,4);
});
