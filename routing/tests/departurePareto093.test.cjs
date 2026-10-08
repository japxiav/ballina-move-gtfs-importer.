'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,rankItineraries,nonDominatedJourneys}=require('../dist');
const date='2026-10-08';
const A={id:'A',name:'Ballina Bus Stn',lat:54.11101,lon:-9.15990};
const B={id:'B',name:'Mayo Hospital',lat:53.85184,lon:-9.30599};
const home={lat:54.108,lon:-9.165};
const dest={lat:53.85180,lon:-9.30601};
const walk=(from,to,sec,meters)=>({provider:'Stadia mock (no paid requests)',geometry:[from,to],durationSeconds:sec,distanceMeters:meters});
const paths={origin:home,destination:dest,access:[{stopId:'A',...walk(home,{lat:A.lat,lon:A.lon},366,465)}],egress:[{stopId:'B',...walk({lat:B.lat,lon:B.lon},dest,100,90)}],transfers:[]};
function timetable(hours=[9,10,11,12]){
  const data={feedVersion:'static-hourly-test',timezone:'Europe/Dublin',stops:[A,B],routes:[{id:'420',name:'420',mode:'bus'}],trips:[],stopTimes:[],calendars:[{serviceId:'WK',startDate:'2026-10-01',endDate:'2026-10-31',weekdays:[true,true,true,true,true,true,true]}],exceptions:[]};
  for(const h of hours){
    const id=`t${h}`;const dep=h*3600;const arrival=dep+1800;
    data.trips.push({id,routeId:'420',serviceId:'WK'});
    data.stopTimes.push({tripId:id,stopId:'A',sequence:1,arrivalSeconds:dep,departureSeconds:dep,pickupType:0},{tripId:id,stopId:'B',sequence:2,arrivalSeconds:arrival,departureSeconds:arrival,dropOffType:0});
  }
  return data;
}
const req={serviceDate:date,departAfterSeconds:8*3600+30*60,limit:3,maxTransfers:0,minBoardingSeconds:90,maxWalkingMeters:2000};
const ids=journeys=>journeys.map(j=>j.legs.find(l=>l.type==='ride')?.tripId);

test('BUG REGRESSION: 4 hourly 420 services expose NEXT 3 departures, not only first',()=>{
  const found=planJourneys(timetable(),paths,req);
  assert.deepEqual(ids(found),['t9','t10','t11']);
  assert.deepEqual(found.map(j=>j.latestLeaveAtSeconds),[9*3600,10*3600,11*3600].map(t=>t-366-90));
});

test('HTTP post-ranking Pareto does not erase remaining scheduled departures',()=>{
  const found=planJourneys(timetable(),paths,{...req,limit:5});
  assert.deepEqual(ids(found),['t9','t10','t11','t12']);
  assert.deepEqual(ids(rankItineraries(found,'fastest',3)),['t9','t10','t11']);
});

test('a first departure missed due to walk+boarding buffer is excluded; next departures still shown',()=>{
  const found=planJourneys(timetable(),paths,{...req,departAfterSeconds:9*3600-400,limit:3});
  assert.deepEqual(ids(found),['t10','t11','t12']);
});

test('Pareto still rejects strictly inferior 440 transfer with no later leave time',()=>{
  const common={serviceDate:date,feedVersion:'test',departureAtSeconds:37800,boardings:[],predictionType:'scheduled'};
  const direct={...common,latestLeaveAtSeconds:38000,arrivalAtSeconds:41580,walkingMeters:465,transfers:0,legs:[]};
  const detour={...common,latestLeaveAtSeconds:37900,arrivalAtSeconds:43000,walkingMeters:700,transfers:1,legs:[]};
  assert.deepEqual(nonDominatedJourneys([detour,direct]),[direct]);
  assert.deepEqual(rankItineraries([detour,direct],'fastest',3),[direct]);
});

test('later departure is a real tradeoff and does not dominate earlier arrival',()=>{
  const common={departureAtSeconds:8*3600+1800,walkingMeters:465,transfers:0};
  const first={...common,latestLeaveAtSeconds:32000,arrivalAtSeconds:34000};
  const second={...common,latestLeaveAtSeconds:35600,arrivalAtSeconds:37600};
  assert.deepEqual(nonDominatedJourneys([first,second]),[first,second]);
});

test('walking-only alternative has an honest leave time without invented boarding buffer',()=>{
  const same={origin:home,destination:dest,access:[],egress:[],transfers:[],direct:walk(home,dest,900,1000)};
  const found=planJourneys(timetable([]),same,{...req,limit:3});
  assert.equal(found.length,1);
  assert.equal(found[0].latestLeaveAtSeconds,req.departAfterSeconds);
  assert.equal(found[0].predictionType,'walking_estimate');
});
