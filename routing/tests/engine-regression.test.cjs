'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Test the source-derived compiled module, NOT a detached recovered copy.
// Expose internal state pruning helpers only within an isolated local test module.
const raw = readFileSync(path.join(ROOT, 'dist', 'engine.js'), 'utf8');
const m = {exports:{}};
const localRequire = (id) => require(path.join(ROOT, 'dist', id.replace(/^\.\//, '') + '.js'));
new Function('module','exports','require',raw + '\nexports.__test={addBest,stateDominates,usedVehicles,previousVehicle};')(
  m,m.exports,localRequire);
const engine=m.exports;
const {addBest,stateDominates}=engine.__test;
function state(id, {at=41580, walk=450, trips=['420'], stopId='terminal'}={}) {
  return {id, at, walkingMeters:walk, rides:trips.length, stopId,
    legs: trips.map(tripId => ({type:'ride',tripId}))};
}
function picked(vals) { const m = new Map(); for (const v of vals) addBest(m, v); return (m.get('terminal') || []).map(x=>x.id); }
function journey(id, arrivalAtSeconds, walkingMeters, transfers) {return {id,arrivalAtSeconds,walkingMeters,transfers};}

test('regression: direct-with-more-walking survives a same-stop lower-walking transfer', () => {
  assert.deepEqual(picked([state('via440',{walk:400,trips:['440','420']}),state('direct',{walk:500,trips:['420']})]),['via440','direct']);
});
test('regression: same state comparison is independent of insertion order', () => {
  assert.deepEqual(picked([state('direct',{walk:500,trips:['420']}),state('via440',{walk:400,trips:['440','420']})]),['via440','direct']);
});
test('a state with superior metrics and a less restrictive history removes another', () => {
  assert.deepEqual(picked([state('worse',{at:42000,walk:600,trips:['440','420']}),state('better',{at:41580,walk:450,trips:['420']})]),['better']);
});
test('later arrival with less walking is a real Pareto tradeoff', () => {
  assert.deepEqual(picked([state('early',{at:41500,walk:800}),state('less_walk',{at:42000,walk:400})]),['early','less_walk']);
});
test('same last trip but different past vehicles are not interchangeable', () => {
  assert.deepEqual(picked([state('via445',{trips:['445','420']}),state('via440',{trips:['440','420']})]),['via445','via440']);
});
test('same last trip and equal metrics but fewer prior rides takes precedence', () => {
  assert.deepEqual(picked([state('two',{trips:['440','420']}),state('one',{trips:['420']})]),['one']);
});
test('exact duplicate labels are not repeated', () => {
  assert.equal(picked([state('first'),state('duplicate')]).length,1);
});
test('different last trips must not dominate each other', () => {
  assert.deepEqual(picked([state('route420',{trips:['420']}),state('route440',{trips:['440']})]),['route420','route440']);
});
test('walking-heavy candidate cannot dominate less-walking candidate', () => {
  assert.equal(stateDominates(state('walkheavy',{walk:700}),state('walklight',{walk:300})),false);
});
test('slower candidate cannot dominate faster candidate', () => {
  assert.equal(stateDominates(state('late',{at:42500}),state('early',{at:41000})),false);
});
test('higher boarding count cannot dominate lower count', () => {
  assert.equal(stateDominates(state('higher',{trips:['440','420']}),state('lower',{trips:['420']})),false);
});
test('bounded frontier never holds more than 24 labels per stop', () => {
  const paths = Array.from({length:40}, (_,i)=>state(`label${i}`,{walk:250+i*5,at:41000+(39-i)*12,trips:[`unique${i}`]}));
  assert.equal(picked(paths).length,24);
});

test('final ranking removes a strictly worse transfer', () => {
  const a=journey('direct',41580,465,0), b=journey('inferior_transfer',43000,700,1);
  assert.deepEqual(engine.nonDominatedJourneys([a,b]).map(x=>x.id),['direct']);
});
test('final ranking preserves earlier arrival with longer walk', () => {
  assert.equal(engine.nonDominatedJourneys([journey('walk',41000,800,0),journey('slow',41580,465,0)]).length,2);
});
test('final ranking preserves less walking with later arrival', () => {
  assert.equal(engine.nonDominatedJourneys([journey('direct',41580,465,0),journey('short_walk',43000,200,0)]).length,2);
});
test('final ranking removes a strictly worse transfer at equal walking and arrival', () => {
  assert.deepEqual(engine.nonDominatedJourneys([journey('direct',41580,465,0),journey('transfer',41580,465,1)]).map(x=>x.id),['direct']);
});
test('final ranking does not mutate input order', () => {
  const vals=[journey('slow',43000,700,1),journey('fast',41580,465,0)];
  engine.nonDominatedJourneys(vals);assert.deepEqual(vals.map(x=>x.id),['slow','fast']);
});

function scheduleCase({pickupType=0,serviceActive=true,walking=465,departureSeconds=10*3600+45*60}={}) {
  const origin={lat:54.107,lon:-9.16}, dest={lat:53.852,lon:-9.306};
  const a={id:'Ballina',name:'Ballina Bus Stn',lat:54.11101,lon:-9.1599},b={id:'Hospital',name:'Mayo Hospital',lat:53.85184,lon:-9.30599};
  const path=(from,to,meters,sec)=>({distanceMeters:meters,durationSeconds:sec,geometry:[from,to],provider:'simulated-Stadia'});
  const data={feedVersion:'verified-fixture',timezone:'Europe/Dublin',
    routes:[{id:'route420',name:'420',mode:'bus'}], stops:[a,b],
    trips:[{id:'trip420',routeId:'route420',serviceId:'s1',headsign:'Mayo Hospital'}],
    stopTimes:[
      {tripId:'trip420',stopId:'Ballina',sequence:1,departureSeconds,arrivalSeconds:departureSeconds,pickupType,dropOffType:0},
      {tripId:'trip420',stopId:'Hospital',sequence:2,departureSeconds:41580,arrivalSeconds:41580,pickupType:1,dropOffType:0}
    ],
    calendars:[{serviceId:'s1',startDate:'2026-10-01',endDate:'2026-11-01',weekdays:[false,false,false,false,serviceActive,false,false]}],exceptions:[]};
  const paths={origin,destination:dest,access:[{stopId:'Ballina',...path(origin,{lat:a.lat,lon:a.lon},walking,366)}],
    egress:[{stopId:'Hospital',...path({lat:b.lat,lon:b.lon},dest,100,90)}],transfers:[],direct:null};
  const request={serviceDate:'2026-10-08',departAfterSeconds:37800,maxTransfers:0,limit:3,maxWalkingMeters:2000};
  return {data,paths,request};
}

test('integration fixture: schedule-only 420 Ballina to Mayo Hospital can be planned', () => {
  const c=scheduleCase();const got=engine.planJourneys(c.data,c.paths,c.request);
  assert.equal(got.length,1);assert.equal(got[0].transfers,0);assert.equal(got[0].walkingMeters,565);
  assert.equal(got[0].legs.filter(l=>l.type==='ride')[0].tripId,'trip420');
});
test('integration fixture: a stop prohibiting boarding cannot be used', () => {
  const c=scheduleCase({pickupType:1});assert.equal(engine.planJourneys(c.data,c.paths,c.request).length,0);
});
test('integration fixture: inactive weekday service cannot be used', () => {
  const c=scheduleCase({serviceActive:false});assert.equal(engine.planJourneys(c.data,c.paths,c.request).length,0);
});
test('integration fixture: unreachable walking distance is rejected', () => {
  const c=scheduleCase({walking:2200});assert.equal(engine.planJourneys(c.data,c.paths,c.request).length,0);
});
test('integration fixture: boarding after departure is rejected', () => {
  const c=scheduleCase({departureSeconds:37900});assert.equal(engine.planJourneys(c.data,c.paths,c.request).length,0);
});
test('integration fixture: DST transition day is intentionally rejected', () => {
  const c=scheduleCase();c.request.serviceDate='2026-10-25';assert.throws(()=>engine.planJourneys(c.data,c.paths,c.request),/dst_transition/);
});
