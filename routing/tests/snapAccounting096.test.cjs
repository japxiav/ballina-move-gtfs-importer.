'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {StadiaWalkingRouter,buildPedestrianPaths,planJourneys,createRoutingApi,createMemoryRateLimiter}=require('../dist');
const home={lat:54.1102,lon:-9.1599};
const stop={id:'b',name:'Ballina Bus Stn',lat:54.11101,lon:-9.1599};
const hospital={id:'h',name:'Mayo Hospital',lat:53.85184,lon:-9.30599};
const shift=(p,meters)=>({...p,lat:p.lat+meters/111195});
function encode(points){let lat=0,lon=0,out='';const push=v=>{let x=v<0?~(v<<1):(v<<1);while(x>=32){out+=String.fromCharCode((32|(x&31))+63);x>>=5;}out+=String.fromCharCode(x+63)};for(const p of points){const a=Math.round(p.lat*1e6),b=Math.round(p.lon*1e6);push(a-lat);push(b-lon);lat=a;lon=b;}return out;}
function mockWalk(shape,seconds=120,meters=140,events=[]){
  return new StadiaWalkingRouter('fake-provider-key',async()=>Response.json({trip:{summary:{time:seconds,length:meters/1000},legs:[{shape:encode(shape)}]}}),'https://api-eu.stadiamaps.com',e=>events.push(e));
}
function table(){return {feedVersion:'gtfs-valid',timezone:'Europe/Dublin',stops:[stop,hospital],routes:[{id:'420',name:'420',mode:'bus'}],trips:[{id:'420test',routeId:'420',serviceId:'weekday'}],stopTimes:[{tripId:'420test',stopId:'b',sequence:1,arrivalSeconds:10*3600,departureSeconds:10*3600},{tripId:'420test',stopId:'h',sequence:2,arrivalSeconds:11*3600,departureSeconds:11*3600}],calendars:[{serviceId:'weekday',startDate:'2026-10-08',endDate:'2026-10-08',weekdays:[false,false,false,false,true,false,false]}],exceptions:[]};}
const req={serviceDate:'2026-10-08',departAfterSeconds:9*3600,maxTransfers:0,minBoardingSeconds:60};
function paths(access){return {origin:home,destination:hospital,access:[{...access,stopId:'b'}],egress:[{stopId:'h',durationSeconds:0,distanceMeters:0,geometry:[hospital,hospital],provider:'test'}],transfers:[]};}

test('a snapped 40m house entrance consumes extra walking budget and ETA, with no fictional line',async()=>{
 const shifted=shift(home,40),events=[];const r=mockWalk([shifted,stop],120,140,events);
 const leg=await r.walk(home,stop,{fromRole:'user',toRole:'stop'});
 assert.ok(leg);assert.equal(leg.unverifiedConnector.estimateOnly,true);
 assert.ok(leg.unverifiedConnector.meters>=39&&leg.unverifiedConnector.meters<=41);
 assert.ok(leg.unverifiedConnector.estimatedSeconds>=33);
 assert.ok(leg.durationSeconds>=153);assert.ok(leg.distanceMeters>=179);
 assert.ok(Math.abs(leg.geometry[0].lat-shifted.lat)<0.000001); // unverified gap was NOT drawn
 assert.ok(leg.snappedUserEndpoints.from);assert.equal(leg.requiresSnapConfirmation,true);
 const j=planJourneys(table(),paths(leg),req)[0];assert.ok(j);
 assert.equal(j.walkingMeters,leg.distanceMeters);assert.equal(j.unverifiedConnectorMeters,leg.unverifiedConnector.meters);
 assert.equal(j.unverifiedConnectorSeconds,leg.unverifiedConnector.estimatedSeconds);
 assert.equal(j.requiresSnapConfirmation,true);
 assert.equal(j.latestLeaveAtSeconds,10*3600-leg.durationSeconds-60);
 assert.ok(events.every(e=>!JSON.stringify(e).includes('54.'))); // only coarse drift bucket
});

test('walking threshold refuses a route whose conservative connector pushes it over 175m',async()=>{
 const r=mockWalk([shift(home,40),stop],120,140);
 const access=await r.walk(home,stop,{fromRole:'user',toRole:'stop'});
 assert.ok(access.distanceMeters>175);
 assert.equal(planJourneys(table(),paths(access),{...req,maxWalkingMeters:175}).length,0);
 const built=await buildPedestrianPaths(r,[stop],home,hospital,{maxRequestCount:1,maxOriginStops:1,maxDestinationStops:0,maxTransferPairs:0,maxPedestrianDistanceMeters:175});
 assert.equal(built.access.length,0);
});

test('50m provisional cap fails closed for 60m house snap, while drift is still reported without coordinates',async()=>{
 const events=[];const r=mockWalk([shift(home,60),stop],120,140,events);
 assert.equal(await r.walk(home,stop,{fromRole:'user',toRole:'stop'}),null);
 assert.equal(events.length,2);assert.equal(events[0].bucket,'50-80');assert.equal(events[0].accepted,false);
 assert.doesNotMatch(JSON.stringify(events),/lat|lon|apiKey|fake-provider-key/);
});

test('only >25m user snap needs explicit confirmation, stop-only gap has no user confirmation',async()=>{
 const r=mockWalk([shift(home,20),shift(stop,10)]);
 const allowed=await r.walk(home,stop,{fromRole:'user',toRole:'stop'});
 assert.ok(allowed);assert.ok(allowed.unverifiedConnector.meters>=29);
 assert.equal(allowed.requiresSnapConfirmation,undefined);assert.equal(allowed.snappedUserEndpoints,undefined);
 const snapOnly=await r.walk(home,stop,{fromRole:'stop',toRole:'stop'});
 assert.ok(snapOnly);assert.equal(snapOnly.requiresSnapConfirmation,undefined); // stop-only 20m and 10m gaps stay within the strict stop threshold
});

test('HTTP response carries snapped point and confirmation warning, never treats gap as routable geometry',async()=>{
 const walking=await mockWalk([shift(home,40),stop],120,140).walk(home,stop,{fromRole:'user',toRole:'stop'});
 const router={walk:async(a,b,roles)=>{
   if(roles?.fromRole==='user'&&roles?.toRole==='stop')return walking;
   if(roles?.fromRole==='stop'&&roles?.toRole==='user')return {durationSeconds:0,distanceMeters:0,geometry:[b,b],provider:'fake'};
   return null;
 }};
 const api=createRoutingApi({loadTimetable:async()=>table(),router,clientIdentity:()=> 'test',consumeRateLimit:createMemoryRateLimiter(),now:()=>new Date('2026-10-08T08:00:00Z')});
 const res=await api(new Request('https://localhost/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serviceDate:'2026-10-08',departAt:'09:00',origin:home,destination:{lat:hospital.lat,lon:hospital.lon},maxTransfers:0,maxWalkingMeters:1000})}));
 assert.equal(res.status,200,await res.clone().text());const body=await res.json();assert.ok(body.journeys.length);
 assert.equal(body.journeys[0].requiresSnapConfirmation,true);
 const firstWalk=body.journeys[0].legs.find(l=>l.type==='walk');assert.ok(firstWalk.snappedUserEndpoints.from);
 assert.ok(body.coverageWarnings.some(w=>w.code==='snap_confirmation_required'));
 assert.ok(body.coverageWarnings.some(w=>w.code==='street_snap_gap_unrouted'&&w.note.includes('UNVERIFIED')));
});
