const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const {searchSchedules, searchScheduledJourneys} = require('/tmp/ballina-ts-compiled/ballina_journeys.js');
const fixture = JSON.parse(fs.readFileSync('routing/fixtures/nta-mayo-hospital-15108-15109-2026-10-13.json'));
const snapshot = () => structuredClone(fixture.snapshot);
const q = {from:'8490B5550501', to:'8490B151081', date:'2026-10-13', time:'02:59', modes:'bus,rail', changes:'1'};
test('Mayo Hospital 15108 and 15109 remain different destinations with operationally distinct transfer stops', () => {
 const a=searchSchedules(snapshot(),q), b=searchSchedules(snapshot(),{...q,to:'8490B151091'});
 const early=a.journeys.filter(j=>j.arrivalAt===33840);
 assert.equal(early.length,2);
 assert.deepEqual(new Set(early.map(j=>j.rides[0].to.id)),new Set(['8490B5557201','8490B151091']));
 for(const j of a.journeys) assert.equal(j.rides.at(-1).to.id,q.to);
 assert.equal(b.journeys[0].arrivalAt,31920);assert.equal(b.journeys[0].changes,0);
 assert.equal(a.walkingIncluded,false);assert.equal(b.walkingIncluded,false);
});
test('completed Pareto selection removes dominated early detours before the six-result cap and retains later direct departures', () => {
 const r=searchSchedules(snapshot(),{...q,to:'8490B151091'});
 assert(r.journeys.every(j=>j.changes===0),'indirect early departures must not displace later direct trips');
 assert(r.journeys.some(j=>j.departureAt===60300),'16:45 departure hidden behind dominated options');
});
test('repeated stop visits preserve separate boarding/alighting sequences and later departures', () => {
 const s=snapshot(), trip=s.tables.trips[0], route=s.tables.routes.find(r=>r.route_id===trip.route_id);
 const A=s.tables.stops.find(r=>r.stop_id===q.from),B=s.tables.stops.find(r=>r.stop_id==='8490B151091');
 s.tables.trips=[trip];s.tables.routes=[route];s.tables.stops=[A,B];
 s.tables.times=[['A',28800],['B',29400],['A',32400],['B',33000]].map(([id,at],i)=>({version:s.version,trip_id:trip.trip_id,stop_id:id==='A'?A.stop_id:B.stop_id,stop_sequence:i+1,arrival_seconds:at,departure_seconds:at,pickup_type:0,drop_off_type:0}));
 const r=searchSchedules(s,{...q,to:B.stop_id,changes:'0'});
 assert.deepEqual(r.journeys.map(j=>[j.departureAt,j.arrivalAt]),[[28800,29400],[32400,33000]]);
 assert.deepEqual(r.journeys.map(j=>[j.rides[0].boardSequence,j.rides[0].alightSequence]),[[1,2],[3,4]]);
});
test('published itinerary IDs are native SHA256 identities, stable across row order, result insertion and text changes', async () => {
 assert.equal(typeof searchScheduledJourneys,'function');
 const a=await searchScheduledJourneys(snapshot(),q), s=snapshot();
 for(const rows of Object.values(s.tables)) rows.reverse();
 s.tables.stops.forEach(r=>r.stop_name+=' corrected spelling');
 const b=await searchScheduledJourneys(s,q);
 assert.deepEqual(a.journeys.map(j=>j.id),b.journeys.map(j=>j.id));
 assert(a.journeys.every(j=>/^j-[a-f0-9]{64}$/.test(j.id)));
 const restricted=await searchScheduledJourneys(snapshot(),{...q,time:'07:55'});
 for(const j of restricted.journeys) assert(a.journeys.some(k=>k.id===j.id));
 const changed=snapshot();changed.version='different-official-feed';
 const c=await searchScheduledJourneys(changed,q);assert.notEqual(a.journeys[0].id,c.journeys[0].id);
});
test('source operational IDs outside public protocol bounds fail instead of aliasing distinct trips', () => {
 const s=snapshot(), id=s.tables.trips[0].trip_id;
 s.tables.trips[0].trip_id='t'.repeat(120)+'A';
 s.tables.times.filter(r=>r.trip_id===id).forEach(r=>r.trip_id=s.tables.trips[0].trip_id);
 assert.throws(()=>searchSchedules(s,q),/unsupported_schedule_identifier/);
 for(const [table,key] of [['routes','route_id'],['stops','stop_id']]) {
  const bad=snapshot(), old=bad.tables[table][0][key];bad.tables[table][0][key]='s'.repeat(121);
  const refs=table==='routes'?bad.tables.trips:bad.tables.times;
  refs.filter(r=>r[key]===old).forEach(r=>r[key]=bad.tables[table][0][key]);
  assert.throws(()=>searchSchedules(bad,q),/unsupported_schedule_identifier/);
 }
});
