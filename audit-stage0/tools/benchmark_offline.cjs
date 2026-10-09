'use strict';
// Microbenchmark for candidate planning only. NO NETWORK, no Stadia, no Deno, no DB.
const {performance}=require('node:perf_hooks');
const {planJourneys,planDoorToDoor}=require('../candidate/routing/dist/index.js');
const W={serviceId:'all',startDate:'2026-10-01',endDate:'2026-10-31',weekdays:[true,true,true,true,true,true,true]};
const pos=(lat)=>({lat,lon:-9.2});
const O=pos(54.099),A=pos(54.1),B=pos(54.105),C=pos(54.109),D=pos(54.113),Z=pos(54.114);
const path=(a,b,m,s)=>({distanceMeters:m,durationSeconds:s,geometry:[a,b],provider:'offline-benchmark'});
const db={feedVersion:'synthetic',timezone:'Europe/Dublin',stops:[['A',A],['B',B],['C',C],['D',D]].map(([id,p])=>({id,name:id,...p})),routes:[{id:'bus',name:'bus',mode:'bus'},{id:'rail',name:'rail',mode:'rail'}],trips:[{id:'t1',routeId:'bus',serviceId:'all'},{id:'t2',routeId:'rail',serviceId:'all'}],stopTimes:[{tripId:'t1',stopId:'A',sequence:1,arrivalSeconds:33000,departureSeconds:33000},{tripId:'t1',stopId:'B',sequence:2,arrivalSeconds:34200,departureSeconds:34200},{tripId:'t2',stopId:'C',sequence:1,arrivalSeconds:35600,departureSeconds:35600},{tripId:'t2',stopId:'D',sequence:2,arrivalSeconds:37500,departureSeconds:37500}],calendars:[W],exceptions:[]};
const request={serviceDate:'2026-10-08',departAfterSeconds:32400,origin:O,destination:Z,maxTransfers:1,maxWalkingMeters:2000,minTransferSeconds:120};
const paths={origin:O,destination:Z,access:[{stopId:'A',...path(O,A,100,90)}],egress:[{stopId:'D',...path(D,Z,100,90)}],transfers:[{fromStopId:'B',toStopId:'C',...path(B,C,490,400)}]};
const key=p=>p.lat.toFixed(6)+','+p.lon.toFixed(6);
let providerCalls=0;
const router={walk:async(a,b)=>{providerCalls++;if(key(a)===key(O)&&key(b)===key(A))return path(a,b,100,90);if(key(a)===key(D)&&key(b)===key(Z))return path(a,b,100,90);if(key(a)===key(B)&&key(b)===key(C))return path(a,b,490,400);return null;}};
const opts={modes:['bus','rail'],maxRequestCount:24,maxTransferPairs:10,maxOriginStops:4,maxDestinationStops:4,maxDirectWalkMeters:0};
const pct=(values,f)=>values[Math.min(values.length-1,Math.max(0,Math.ceil(values.length*f)-1))];
const summary=arr=>{const a=[...arr].sort((x,y)=>x-y);return {samples:a.length,p50_ms:+pct(a,.5).toFixed(4),p95_ms:+pct(a,.95).toFixed(4),p99_ms:+pct(a,.99).toFixed(4),min_ms:+a[0].toFixed(4),max_ms:+a.at(-1).toFixed(4)}};
(async()=>{
  const warmup=25,samples=250;
  for(let i=0;i<warmup;i++){planJourneys(db,paths,request);await planDoorToDoor(db,router,request,opts)}
  let foundCore=0,foundDoor=0;
  const tCore=[],tDoor=[];
  providerCalls=0;
  for(let i=0;i<samples;i++){
    let begin=performance.now();const a=planJourneys(db,paths,request);tCore.push(performance.now()-begin);foundCore+=a.length;
    begin=performance.now();const b=await planDoorToDoor(db,router,request,opts);tDoor.push(performance.now()-begin);foundDoor+=b.journeys.length;
  }
  console.log(JSON.stringify({metric_kind:'offline_synthetic_250_iterations',runtime:process.version,fixture:'2 trips; 4 stops; bus -> walk -> rail; mocked pedestrian provider',network_calls:0,synthetic_router_calls:providerCalls,
    core:summary(tCore),door_to_door:summary(tDoor),total_core_journeys:foundCore,total_door_journeys:foundDoor,heap_used_bytes:process.memoryUsage().heapUsed,rss_bytes:process.memoryUsage().rss,warning:'Not Supabase Edge CPU, cold start, real-provider latency or representative production traffic'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
