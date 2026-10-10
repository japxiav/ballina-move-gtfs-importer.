'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,hasExtremeGeographicDetour,removeLowValueFastestAlternatives}=require('../dist/engine.js');
const DATE='2026-10-10';
const stop=(id,name,lat,lon)=>({id,name,lat,lon});
const B=stop('B','Ballina Bus Stn',54.11101,-9.1599);
const R=stop('R','Ballina Rail',54.109063,-9.160596);
const M=stop('M','Manulla Junction',53.827975,-9.192956);
const C=stop('C','Castlebar Rail',53.847519,-9.288282);
const H=stop('H','Heuston Bus',53.34617,-6.29275);
const D=stop('D','Dublin Heuston',53.346404,-6.293487);
const origin={lat:54.11065,lon:-9.1595},destination={lat:53.848,lon:-9.289};
const path=(a,b,meters,seconds)=>({distanceMeters:meters,durationSeconds:seconds,geometry:[a,b],provider:'synthetic_fixture'});
const a=(id,p,meters,seconds)=>({stopId:id,...path(origin,p,meters,seconds)});
const e=(id,p,meters,seconds)=>({stopId:id,...path(p,destination,meters,seconds)});
const transfers=[{fromStopId:'H',toStopId:'D',...path(H,D,75,63)}];
const tbl={feedVersion:'a07-regression',timezone:'Europe/Dublin',stops:[B,R,M,C,H,D],routes:[
  {id:'22',name:'22',mode:'bus'},{id:'rail',name:'rail',mode:'rail'}],
  trips:[{id:'bus-to-dublin',routeId:'22',serviceId:'sat'},
    {id:'rail-from-dublin',routeId:'rail',serviceId:'sat'},
    {id:'rail-ballina',routeId:'rail',serviceId:'sat'},
    {id:'rail-manulla',routeId:'rail',serviceId:'sat'}],
  stopTimes:[
    ['bus-to-dublin','B',1,34200],['bus-to-dublin','H',2,46800],
    ['rail-from-dublin','D',1,53100],['rail-from-dublin','C',2,63780],
    ['rail-ballina','R',1,34500],['rail-ballina','M',2,36120],
    ['rail-manulla','M',1,38160],['rail-manulla','C',2,38520]
  ].map(([tripId,stopId,sequence,t])=>({tripId,stopId,sequence,arrivalSeconds:t,departureSeconds:t})),
  calendars:[{serviceId:'sat',startDate:DATE,endDate:DATE,weekdays:[false,false,false,false,false,false,true]}],exceptions:[]};
const paths={origin,destination,access:[a('B',B,65,55),a('R',R,258,215)],egress:[e('C',C,97,81)],transfers};
const query=(maxWalkingMeters,rankBy='fastest')=>planJourneys(tbl,paths,{serviceDate:DATE,departAfterSeconds:32400,
 maxTransfers:1,maxWalkingMeters,limit:5,minBoardingSeconds:90,minTransferSeconds:180,rankBy});

test('A07: under 300m, never recommend Ballina -> Dublin -> Castlebar return loop',()=>{
 const result=query(300);
 assert.equal(result.length,0);
});
test('A07: 400m restores the sensible Ballina -> Manulla -> Castlebar rail connection',()=>{
 const result=query(400);
 assert.ok(result.length>0);
 assert.equal(result[0].walkingMeters,355);
 assert.deepEqual(result[0].legs.filter(l=>l.type==='ride').map(l=>l.tripId),['rail-ballina','rail-manulla']);
 assert.equal(result[0].arrivalAtSeconds,38601);
 assert.ok(!result.some(j=>j.legs.some(l=>l.type==='ride'&&l.tripId==='bus-to-dublin')));
});
test('A07: multi-leg Dublin detour is identified by conservative geometry bound',()=>{
 const stopMap=new Map(tbl.stops.map(s=>[s.id,s]));
 const trip=(boardStopId,alightStopId)=>({type:'ride',tripId:'x',serviceDate:DATE,boardStopId,alightStopId});
 const extreme={legs:[trip('B','H'),trip('D','C')]};
 const valid={legs:[trip('R','M'),trip('M','C')]};
 assert.equal(hasExtremeGeographicDetour(extreme,origin,destination,stopMap),true);
 assert.equal(hasExtremeGeographicDetour(valid,origin,destination,stopMap),false);
 assert.equal(hasExtremeGeographicDetour({legs:[trip('B','H')]},origin,destination,stopMap),false,'single ride is not guessed from endpoint positions');
 assert.equal(hasExtremeGeographicDetour({legs:[trip('B','unknown'),trip('M','C')]},origin,destination,stopMap),false,'missing coordinates fail open');
});
test('A07: fastest removes a 40-minute penalty and extra transfer for just 4m less walking',()=>{
 const first={type:'ride',serviceDate:DATE,tripId:'420',boardStopId:'B'};
 const fast={legs:[first],arrivalAtSeconds:42604,latestLeaveAtSeconds:38555,departureAtSeconds:32400,transfers:0,walkingMeters:1653};
 const bad={legs:[first,{...first,tripId:'440'}],arrivalAtSeconds:45030,latestLeaveAtSeconds:38555,departureAtSeconds:32400,transfers:1,walkingMeters:1649};
 assert.deepEqual(removeLowValueFastestAlternatives([bad,fast]),[fast]);
 assert.deepEqual(removeLowValueFastestAlternatives([fast,{...bad,latestLeaveAtSeconds:38800}]),[fast,{...bad,latestLeaveAtSeconds:38800}],
  'do not silently discard a later starting alternative');
 assert.deepEqual(removeLowValueFastestAlternatives([fast,{...bad,walkingMeters:1600}]),[fast,{...bad,walkingMeters:1600}],
  'a meaningful walking saving must remain');
});
