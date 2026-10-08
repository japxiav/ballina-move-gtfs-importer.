const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {fromSupabaseTables,planJourneys,activeService,boardingInstruction,displayServiceTime}=require('../dist/index.js');
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json',`file://${__filename}`)));
const timetable=fromSupabaseTables(fixture.tables);
const ballina=timetable.stops.find(s=>s.name==='Ballina Bus Stn');
const castlebar=timetable.stops.find(s=>s.name==='Castlebar');
const hospital=timetable.stops.find(s=>s.name==='Mayo Hospital');
// Walking is deliberately mocked as zero-walk between identical station coordinates.
// This verifies REAL GTFS schedules only, not real pedestrian navigation.
const zero=(a,b)=>({durationSeconds:0,distanceMeters:0,geometry:[{lat:a.lat,lon:a.lon},{lat:b.lat,lon:b.lon}],provider:'test-only-virtual-zero-walk'});
const paths=(from,to)=>({origin:{lat:from.lat,lon:from.lon},destination:{lat:to.lat,lon:to.lon},access:[{stopId:from.id,...zero(from,from)}],egress:[{stopId:to.id,...zero(to,to)}],transfers:[]});
const query=(a,b,date='2026-10-08')=>planJourneys(timetable,paths(a,b),{serviceDate:date,departAfterSeconds:7*3600+55*60,maxTransfers:0,minBoardingSeconds:60});
test('GTFS from production: bus 420 Ballina Bus Stn 08:00 -> Mayo Hospital 08:52 on Thursday 2026-10-08',()=>{
 const journeys=query(ballina,hospital);
 assert.equal(journeys.length,1);
 const j=journeys[0];
 assert.equal(j.legs.filter(l=>l.type==='ride').length,1);
 assert.equal(j.legs.find(l=>l.type==='ride').tripId,'5913_63092');
 assert.equal(j.legs.find(l=>l.type==='ride').headsign,'Mayo Hospital');
 assert.equal(displayServiceTime(j.legs.find(l=>l.type==='ride').boardAtSeconds),'08:00');
 assert.equal(displayServiceTime(j.arrivalAtSeconds),'08:52');
 assert.equal(j.boardings[0].stopCode,'555051');
 assert.equal(j.boardings[0].locationConfidence,'official_unverified');
 assert.equal(j.boardings[0].sideOfStreet,null);
 assert.equal(j.predictionType,'scheduled');
});
test('GTFS from production: bus 420 passes Castlebar at scheduled 08:48',()=>{
 const journeys=query(ballina,castlebar);
 assert.equal(journeys.length,1);assert.equal(displayServiceTime(journeys[0].arrivalAtSeconds),'08:48');
});
test('GTFS pickup/dropoff: terminal Mayo Hospital is not a pickup stop',()=>{
 const fromHospital=query(hospital,ballina);
 assert.equal(fromHospital.length,0);
 assert.equal(timetable.stopTimes.at(-1).pickupType,1);
 assert.equal(timetable.stopTimes[0].dropOffType,1);
});
test('GTFS calendar: historical Thu fixture must not be projected onto Fri',()=>{
 assert.equal(activeService('66','2026-10-08',timetable.calendars,timetable.exceptions),true);
 assert.equal(activeService('66','2026-10-09',timetable.calendars,timetable.exceptions),false);
 assert.equal(query(ballina,hospital,'2026-10-09').length,0);
});
test('GTFS stops: displays official coordinate but never invented side/platform',()=>{
 for(const stop of [ballina,hospital]){
  const b=boardingInstruction(stop);
  assert.equal(b.sideOfStreet,null);assert.equal(b.platform,null);
  assert.equal(b.locationConfidence,'official_unverified');
  assert.equal(b.coordinate.lat,stop.lat);
 }
});
