const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {
  planDoorToDoor,applyBoardingEvidence,journeyBoardingDetails,boardingInstruction,
  fromSupabaseTables,routableStopCoordinate,buildPedestrianPaths,journeyOverlay,proximityMeters,
}=require('../dist');
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json',`file://${__filename}`)));
const data=fromSupabaseTables(fixture.tables);
const bus=data.stops.find(s=>s.name==='Ballina Bus Stn');
const hospital=data.stops.find(s=>s.name==='Mayo Hospital');
const home={lat:54.11070,lon:-9.16003};
const destination={lat:53.85190,lon:-9.30593};
const fakeRouter={walk:async(a,b)=> proximityMeters(a,b)>220 ? null : ({durationSeconds:120,distanceMeters:125,geometry:[a,b],provider:'SYNTHETIC-TEST-ONLY'})};
const request={serviceDate:'2026-10-08',departAfterSeconds:7*3600+50*60,origin:home,destination,maxTransfers:0};

test('real NTA line 420 via orchestration: access, 08:00 ride, 08:52 alight, egress',async()=>{
  const result=await planDoorToDoor(data,fakeRouter,request,{maxOriginStops:2,maxDestinationStops:2,maxRequestCount:10});
  assert.equal(result.journeys.length,1);
  const j=result.journeys[0];
  assert.equal(j.legs.filter(l=>l.type==='ride').length,1);
  assert.deepEqual(j.legs.map(l=>l.type),['walk','ride','walk']);
  const busLeg=j.legs.find(l=>l.type==='ride');
  assert.equal(busLeg.boardStopId,bus.id);
  assert.equal(busLeg.alightStopId,hospital.id);
  assert.equal(busLeg.boardAtSeconds,28800);
  assert.equal(busLeg.alightAtSeconds,31920);
  assert.equal(j.predictionType,'scheduled');
  const boarding=journeyBoardingDetails(j,data.stops)[0];
  assert.equal(boarding.stopCode,'555051');
  assert.equal(boarding.sideOfStreet,null);
  assert.equal(boarding.locationConfidence,'official_unverified');
  assert.equal(boarding.walkingDurationSeconds,120);
  assert.equal(boarding.walkingDistanceMeters,125);
});

test('no validated walking paths means no journey, even when GTFS has a bus',async()=>{
  const fails={walk:async()=>null};
  const result=await planDoorToDoor(data,fails,request,{maxOriginStops:2,maxDestinationStops:2,maxRequestCount:10});
  assert.equal(result.journeys.length,0);
});

test('provider failures propagate instead of falling back to invented straight line',async()=>{
  await assert.rejects(
    planDoorToDoor(data,{walk:async()=>{throw new Error('walking_api_failed_429')}},request),
    /walking_api_failed_429/
  );
});

test('stop side is unverified without dated, attributable evidence',()=>{
  const modified={...bus,boarding:{confidence:'verified',sideOfStreet:'south',platform:'Z'}};
  const result=boardingInstruction(modified);
  assert.equal(result.locationConfidence,'official_unverified');
  assert.equal(result.sideOfStreet,null);
  assert.equal(result.platform,null);
});

test('bad sources, unknown stops and far-away coordinates are rejected',()=>{
  const good={stopId:bus.id,feedVersion:data.feedVersion,verifiedAt:'2026-10-08',sourceUrl:'https://example.org/stop-evidence',reviewer:'test person'};
  assert.throws(()=>applyBoardingEvidence(data,[{...good,sourceUrl:'http://example.org'}]),/boarding_invalid_source/);
  assert.throws(()=>applyBoardingEvidence(data,[{...good,stopId:'NOT_A_STOP'}]),/boarding_unknown_stop/);
  assert.throws(()=>applyBoardingEvidence(data,[{...good,boardingPoint:{lat:53.8,lon:-9.16}}]),/boarding_override_too_far/);
  assert.throws(()=>applyBoardingEvidence(data,[good,good]),/boarding_duplicate_evidence/);
  assert.throws(()=>applyBoardingEvidence(data,[{...good,verifiedAt:'2026-02-30'}]),/boarding_invalid_evidence/);
  assert.equal(applyBoardingEvidence(data,[{...good,feedVersion:'OBSOLETE'}]).stops.find(s=>s.id===bus.id).boarding.confidence,'official_unverified');
});

test('verified physical boarding point is routed to rather than official coordinate; official remains intact',async()=>{
  const actualPoint={lat:bus.lat+0.00028,lon:bus.lon+0.00024};
  const e={stopId:bus.id,feedVersion:data.feedVersion,verifiedAt:'2026-10-08',sourceUrl:'https://example.org/reviewed-stop',reviewer:'test reviewer',sideOfStreet:'east',platform:'Bay 2',boardingPoint:actualPoint};
  const annotated=applyBoardingEvidence(data,[e]);
  const stop=annotated.stops.find(s=>s.id===bus.id);
  assert.equal(stop.lat,bus.lat);
  assert.deepEqual(routableStopCoordinate(stop),actualPoint);
  let visited=[];
  const router={walk:async(a,b)=>{visited.push({a,b});return proximityMeters(a,b)>220? null :{durationSeconds:120,distanceMeters:140,geometry:[a,b],provider:'SYNTHETIC-TEST-ONLY'}}};
  const result=await planDoorToDoor(annotated,router,request,{maxOriginStops:2,maxDestinationStops:2,maxRequestCount:10});
  assert.equal(result.journeys.length,1);
  assert.ok(visited.some(p=>p.b.lat===actualPoint.lat && p.b.lon===actualPoint.lon));
  const j=result.journeys[0];
  const boarding=journeyBoardingDetails(j,annotated.stops)[0];
  assert.equal(boarding.locationConfidence,'verified');
  assert.equal(boarding.sideOfStreet,'east');
  assert.equal(boarding.platform,'Bay 2');
  assert.equal(boarding.boardingPointSource,'verified_override');
  assert.equal(boarding.evidenceSourceUrl,'https://example.org/reviewed-stop');
  assert.deepEqual(boarding.boardingPoint,actualPoint);
  const overlay=journeyOverlay(j,annotated.stops);
  const marker=overlay.features.find(f=>f.properties.kind==='board');
  assert.deepEqual(marker.geometry.coordinates,[actualPoint.lon,actualPoint.lat]);
});

test('regional transfer pairs do not depend on unordered stops input',async()=>{
  const S=(id,lat)=>({id,name:id,lat,lon:-9.16});
  const stops=[S('north1',54.11),S('north2',54.1104),S('south1',53.85),S('south2',53.8504)];
  const origins={lat:54.11,lon:-9.16},dest={lat:53.85,lon:-9.16};
  const r={walk:async(a,b)=>({durationSeconds:90,distanceMeters:120,geometry:[a,b],provider:'mock-only'})};
  const opts={maxOriginStops:1,maxDestinationStops:1,maxRequestCount:9,maxTransferPairs:2,candidateRadiusMeters:150};
  const a=await buildPedestrianPaths(r,stops,origins,dest,opts);
  const b=await buildPedestrianPaths(r,[...stops].reverse(),origins,dest,opts);
  const pairs=x=>new Set(x.transfers.map(t=>t.fromStopId+':'+t.toStopId));
  assert.deepEqual(pairs(a),pairs(b));
  assert.ok([...pairs(a)].some(p=>p.startsWith('north')));
  assert.ok([...pairs(a)].some(p=>p.startsWith('south')));
});

test('disallow train unless explicitly enabled in door-to-door planner',async()=>{
  const onlyRail={...data,routes:data.routes.map(r=>({...r,mode:'rail'}))};
  const none=await planDoorToDoor(onlyRail,fakeRouter,request);
  assert.equal(none.journeys.length,0);
  const some=await planDoorToDoor(onlyRail,fakeRouter,request,{includeRail:true,maxOriginStops:2,maxDestinationStops:2,maxRequestCount:10});
  assert.equal(some.journeys.length,1);
});
