const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fromSupabaseTables,createRoutingApi,nearbyStops,rankItineraries,createMemoryRateLimiter}=require('../dist');
const file=new URL('../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json',`file://${__filename}`);
const data=fromSupabaseTables(JSON.parse(fs.readFileSync(file)).tables);
const coord={lat:54.11101,lon:-9.15990};
const base='https://preview.example';
function api(override={}){
 let providerCalls=0,snapshotCalls=0;
 const handler=createRoutingApi({
  loadTimetable:async()=>{snapshotCalls++;return data},
  router:{walk:async()=>{providerCalls++;throw Error('no pedestrian billing in this lookup')}},
  clientIdentity:()=> 'approved-tester',consumeRateLimit:createMemoryRateLimiter(),
  now:()=>new Date('2026-10-08T09:12:00Z'),...override,
 });
 return {handler,stats:()=>({providerCalls,snapshotCalls})};
}
function url(search='') {return base+'/v1/nearby-stops'+search;}
test('pilot nearby: Ballina Bus Station is found, but distance is never described as walking',async()=>{
 const t=api();const response=await t.handler(new Request(url('?lat=54.11101&lon=-9.1599')));
 assert.equal(response.status,200);
 const b=await response.json();
 assert.equal(b.realtime,false);
 assert.equal(b.distanceType,'straight_line_approximation_not_walking_route');
 assert.equal(b.stops[0].stopCode,'555051');
 assert.equal(b.stops[0].distanceStraightLineMeters,0);
 assert.equal(b.stops[0].locationConfidence,'official_unverified');
 assert.equal(b.stops[0].sideOfStreet,null);
 assert.ok(b.stops[0].routeNames.includes('420'));
 assert.equal(t.stats().providerCalls,0);
});
test('pilot nearby: arrival-only stop cannot be presented as a place to board',()=>{
 const hospital=data.stops.find(s=>s.name==='Mayo Hospital');
 assert.ok(hospital);
 const nearby=nearbyStops(data,hospital,100,5);
 assert.equal(nearby.some(s=>s.stopId===hospital.id),false);
});
test('pilot nearby: routes must have regular pickup, not request-only or dropoff-only',()=>{
 const stop=data.stops.find(s=>s.name==='Ballina Bus Stn');
 const changed=structuredClone(data);
 for(const st of changed.stopTimes){if(st.stopId===stop.id)st.pickupType=2;}
 assert.equal(nearbyStops(changed,stop,100,5).some(s=>s.stopId===stop.id),false);
});
test('pilot nearby: radius filter and stable max limit',async()=>{
 const t=api();const r=await t.handler(new Request(url('?lat=54.11101&lon=-9.1599&radiusMeters=100&limit=1')));
 assert.equal(r.status,200);const b=await r.json();assert.equal(b.stops.length,1);assert.equal(b.stops[0].stopCode,'555051');
});
test('pilot nearby: rejects spoofing, duplicate parameters, huge radius, bad coordinates and unknown params',async()=>{
 const t=api();const bad=[
 '?lat=91&lon=-9.15','?lat=54.111&lon=-9.15&radiusMeters=2501',
 '?lat=54.111&lon=-9.15&limit=16','?lat=54.11&lon=-9.15&lat=54.13',
 '?lat=54.11&lon=-9.15&apikey=whatever','?lat=Infinity&lon=-9.15',
 '?lat=54.11000001&lon=-9.15','?lat=54.11&lon=0'
 ];
 for(const search of bad){const res=await t.handler(new Request(url(search)));assert.equal(res.status,400,search)}
 assert.deepEqual(t.stats(),{providerCalls:0,snapshotCalls:0});
});
test('pilot nearby: rejects POST, never invokes routing provider',async()=>{
 const t=api();const r=await t.handler(new Request(url('?lat=54.111&lon=-9.159'),{method:'POST'}));
 assert.equal(r.status,405);assert.equal(t.stats().providerCalls,0);
});
test('pilot nearby: fail closed if the shared limiter rejects',async()=>{
 const t=api({consumeRateLimit:async()=>false});const r=await t.handler(new Request(url('?lat=54.111&lon=-9.159')));
 assert.equal(r.status,429);assert.deepEqual(t.stats(),{providerCalls:0,snapshotCalls:0});
});
test('pilot nearby: database exceptions stay private',async()=>{
 const t=api({loadTimetable:async()=>{throw Error('private credential here')}});
 const r=await t.handler(new Request(url('?lat=54.111&lon=-9.159')));
 assert.equal(r.status,503);assert.equal((await r.text()).includes('credential'),false);
});
test('pilot nearby: does not show unserved stops or rail-only stops as nearby buses',()=>{
 const d=structuredClone(data);
 d.stops.push({id:'UNSERVED',name:'Not served',lat:coord.lat,lon:coord.lon},
 {id:'RAIL',name:'Rail only',lat:coord.lat,lon:coord.lon});
 d.routes.push({id:'rail-route',name:'Rail',mode:'rail'});
 d.trips.push({id:'train-trip',routeId:'rail-route',serviceId:'66'});
 d.stopTimes.push({tripId:'train-trip',stopId:'RAIL',sequence:1,departureSeconds:28800,arrivalSeconds:28800});
 const nearby=nearbyStops(d,coord);
 assert.equal(nearby.some(s=>s.stopId==='UNSERVED'||s.stopId==='RAIL'),false);
});
test('pilot preferences sort confirmed journey candidates but never fabricate new services',()=>{
 const baseJourney={legs:[],arrivalAtSeconds:500,transfers:2,walkingMeters:500};
 const candidates=[baseJourney,{...baseJourney,arrivalAtSeconds:650,transfers:0,walkingMeters:100},{...baseJourney,arrivalAtSeconds:550,transfers:1,walkingMeters:50}];
 assert.equal(rankItineraries(candidates,'fastest',1)[0].arrivalAtSeconds,500);
 assert.equal(rankItineraries(candidates,'less_walking',1)[0].walkingMeters,50);
 assert.equal(rankItineraries(candidates,'fewest_transfers',1)[0].transfers,0);
 assert.equal(candidates[0].arrivalAtSeconds,500);
});
test('pilot POST accepts preference, responds with preference and legacy contract preserved',async()=>{
 let calls=0;
 const t=api({router:{walk:async(a,b)=>{calls++;if(calls>12)throw new Error('provider excessive');const same=a.lat===b.lat&&a.lon===b.lon;return same?null:{durationSeconds:120,distanceMeters:150,geometry:[a,b],provider:'mock-not-real'}}}});
 const req={serviceDate:'2026-10-08',departAt:'07:50',origin:{lat:54.1107,lon:-9.16003},destination:{lat:53.8519,lon:-9.30593},maxTransfers:0,prioritize:'less_walking'};
 const r=await t.handler(new Request(base+'/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)}));
 assert.equal(r.status,200);const b=await r.json();assert.equal(b.prioritize,'less_walking');assert.equal(b.realtime,false);
 const invalid=await t.handler(new Request(base+'/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...req,prioritize:'guaranteed'})}));
 assert.equal(invalid.status,400);
});
test('edge request forwarding keeps method and body for POST and GET',async()=>{
 const url=new URL(base+'/functions/v1/preview/v1/journeys');url.pathname='/v1/journeys';
 const original=new Request(base+'/some/path',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hi:true})});
 const forwarded=new Request(url,original);
 assert.equal(forwarded.method,'POST');assert.deepEqual(await forwarded.json(),{hi:true});
 const get=new Request(base+'/other?lat=54.1');url.pathname='/v1/nearby-stops';url.search='?lat=54.1';
 const cloned=new Request(url,get);assert.equal(cloned.method,'GET');assert.equal(new URL(cloned.url).searchParams.get('lat'),'54.1');
});

test('pilot hourly paid budget blocks the thirteenth itinerary, never touches map provider',async()=>{
 let paid=0,minute=0;
 const t=api({consumeRateLimit:async(key,limit,seconds)=>{
   if(seconds===3600){paid++;return paid<=12;}
   minute++;return true;
 }});
 const req={serviceDate:'2026-10-08',departAt:'07:50',origin:{lat:54.1107,lon:-9.16003},destination:{lat:53.8519,lon:-9.30593},maxTransfers:0};
 for(let i=0;i<12;i++){
   const res=await t.handler(new Request(base+'/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)}));
   assert.equal(res.status,503,'mock walking fails closed, but budget is consumed');
 }
 const blocked=await t.handler(new Request(base+'/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)}));
 assert.equal(blocked.status,429);assert.equal((await blocked.json()).error,'pilot_hourly_budget_exhausted');
 assert.equal(paid,13);
});

test('engine prioritizes less walking before trimming results (not just sorting fastest shortlist)',()=>{
 const {planJourneys}=require('../dist');
 const origin={lat:54.11101,lon:-9.16};
 const far={id:'F',name:'Far access',lat:54.1115,lon:-9.16};
 const near={id:'N',name:'Near access',lat:54.1111,lon:-9.16};
 const dest={id:'D',name:'Destination',lat:54.14,lon:-9.17};
 const t={feedVersion:'fixture',timezone:'Europe/Dublin',stops:[far,near,dest],routes:[{id:'R',name:'420',mode:'bus'}],trips:[
  {id:'FAST',routeId:'R',serviceId:'66'}, {id:'SLOW',routeId:'R',serviceId:'66'}
 ],stopTimes:[
  {tripId:'FAST',stopId:'F',sequence:1,arrivalSeconds:28800,departureSeconds:28800,pickupType:0},
  {tripId:'FAST',stopId:'D',sequence:2,arrivalSeconds:30000,departureSeconds:30000,dropOffType:0},
  {tripId:'SLOW',stopId:'N',sequence:1,arrivalSeconds:29100,departureSeconds:29100,pickupType:0},
  {tripId:'SLOW',stopId:'D',sequence:2,arrivalSeconds:31000,departureSeconds:31000,dropOffType:0},
 ],calendars:[{serviceId:'66',startDate:'2026-10-08',endDate:'2026-10-08',weekdays:[false,false,false,false,true,false,false]}],exceptions:[]};
 const paths={origin,destination:dest,access:[
  {stopId:'F',durationSeconds:120,distanceMeters:200,provider:'walk fixture',geometry:[origin,far]},
  {stopId:'N',durationSeconds:50,distanceMeters:55,provider:'walk fixture',geometry:[origin,near]},
 ],egress:[{stopId:'D',durationSeconds:0,distanceMeters:0,provider:'walk fixture',geometry:[dest,dest]}],transfers:[]};
 const params={serviceDate:'2026-10-08',departAfterSeconds:27800,maxTransfers:0,limit:1};
 const fastest=planJourneys(t,paths,{...params,rankBy:'fastest'});
 const lessWalking=planJourneys(t,paths,{...params,rankBy:'less_walking'});
 assert.equal(fastest[0].legs.find(x=>x.type==='ride').tripId,'FAST');
 assert.equal(lessWalking[0].legs.find(x=>x.type==='ride').tripId,'SLOW');
});
