const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {fromSupabaseTables,planDoorToDoor,displayServiceTime}=require('../dist/index.js');
const fixture=JSON.parse(readFileSync(new URL('../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json',`file://${__filename}`)));
const timetable=fromSupabaseTables(fixture.tables);
const station=timetable.stops.find(s=>s.name==='Ballina Bus Stn');
const hospital=timetable.stops.find(s=>s.name==='Mayo Hospital');
const origin={lat:54.1118,lon:-9.1613};
const destination={lat:hospital.lat,lon:hospital.lon};
// Exact walking summary obtained from one Stadia EU API invocation on 2026-10-08:
// 465 metres, 366 seconds to the official GTFS Ballina Bus Station coordinate.
// This test uses these recorded metrics, but NOT the provider's real polyline;
// its two-point geometry is a TEST FIXTURE ONLY, never published as footway navigation.
const walking={
  walk:async(from,to)=>{
    if(from.lat===origin.lat&&from.lon===origin.lon&&to.lat===station.lat&&to.lon===station.lon)
      return {provider:'recorded_stadia_metrics_test_only',distanceMeters:465,durationSeconds:366,geometry:[from,to]};
    if(from.lat===destination.lat&&from.lon===destination.lon&&to.lat===destination.lat&&to.lon===destination.lon)
      return {provider:'test-only-zero-egress',distanceMeters:0,durationSeconds:0,geometry:[from,to]};
    return null;
  }
};
const options={maxRequestCount:6,maxOriginStops:3,maxDestinationStops:3,maxTransferPairs:0};
function search(departAfterSeconds){return planDoorToDoor(timetable,walking,{origin,destination,serviceDate:'2026-10-08',departAfterSeconds,maxTransfers:0,maxWalkingMeters:2000,limit:2,minBoardingSeconds:90},options)}
test('recorded 366s real walking time + 90s boarding buffer connects 07:50 origin to 08:00 bus 420',async()=>{
  const plan=await search(7*3600+50*60);
  assert.equal(plan.journeys.length,1);
  const j=plan.journeys[0];
  assert.equal(displayServiceTime(j.arrivalAtSeconds),'08:52');
  assert.equal(j.legs.find(x=>x.type==='ride').boardAtSeconds,28800);
  const walk=j.legs.find(x=>x.type==='walk'&&x.purpose==='access');
  assert.equal(walk.distanceMeters,465);
  assert.equal(walk.durationSeconds,366);
  assert.equal(j.boardings[0].sideOfStreet,null);
  assert.equal(j.predictionType,'scheduled');
});
test('recorded 366s walking cannot catch 08:00 bus if departure is 07:53',async()=>{
  const plan=await search(7*3600+53*60);
  assert.equal(plan.journeys.length,0);
});
