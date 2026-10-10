'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys}=require('../dist');
const date='2026-10-08';
const O={lat:54.309,lon:-9.16};
const A={lat:54.310,lon:-9.16};
const B={lat:54.312,lon:-9.16};
const D={lat:54.313,lon:-9.16};
const walk=(from,to,seconds,meters,extra={})=>({durationSeconds:seconds,distanceMeters:meters,geometry:[from,to],provider:'fixture',...extra});
const timetable={feedVersion:'test-a02',timezone:'Europe/Dublin',stops:[{id:'a',name:'A',...A},{id:'b',name:'B',...B}],routes:[{id:'r',name:'R',mode:'bus'}],trips:[{id:'t',routeId:'r',serviceId:'d'}],stopTimes:[{tripId:'t',stopId:'a',sequence:1,arrivalSeconds:33000,departureSeconds:33000},{tripId:'t',stopId:'b',sequence:2,arrivalSeconds:35000,departureSeconds:35000}],calendars:[{serviceId:'d',startDate:date,endDate:date,weekdays:[false,false,false,false,true,false,false]}],exceptions:[]};
const short={stopId:'b',...walk(B,D,720,120)};
const fast={stopId:'b',...walk(B,D,690,900)};
const invalid={stopId:'b',...walk({lat:0,lon:0},D,10,10)};
const dominated={stopId:'b',...walk(B,D,800,130)};
const snap={stopId:'b',...walk(B,D,600,100,{requiresSnapConfirmation:true})};
const input=(egress)=>({origin:O,destination:D,access:[{stopId:'a',...walk(O,A,70,50)}],egress,transfers:[]});
const run=(egress,extra={})=>planJourneys(timetable,input(egress),{serviceDate:date,departAfterSeconds:32400,maxTransfers:0,maxWalkingMeters:500,limit:5,...extra});
const arrival=(list)=>list.map(j=>({arrival:j.arrivalAtSeconds,walk:j.walkingMeters,snap:j.requiresSnapConfirmation}));
test('A02 baseline: a faster but over-budget exit must not suppress a slower feasible exit',()=>{
 assert.equal(run([short]).length,1);
 const j=run([short,fast]);assert.equal(j.length,1);assert.equal(j[0].walkingMeters,170);assert.equal(j[0].arrivalAtSeconds,35720);
});
test('A02: order of valid exits cannot change results',()=>{
 assert.deepEqual(arrival(run([short,fast])),arrival(run([fast,short])));
});
test('A02: larger walking cap preserves the shorter alternative and admits faster one',()=>{
 const js=run([short,fast],{maxWalkingMeters:1000});
 assert.equal(js.length,2);
 assert.deepEqual(js.map(j=>j.walkingMeters),[950,170]);
 assert.deepEqual(js.map(j=>j.arrivalAtSeconds),[35690,35720]);
});
test('A02: rankBy less_walking must select the shorter non-dominated exit',()=>{
 const js=run([fast,short],{maxWalkingMeters:1000,rankBy:'less_walking',limit:1});
 assert.equal(js.length,1);assert.equal(js[0].walkingMeters,170);
});
test('A02: invalid and dominated exit paths cannot crowd out feasible path',()=>{
 assert.deepEqual(arrival(run([dominated,invalid,fast,short])),arrival(run([short])));
});
test('A02: duplicated exits cannot duplicate journeys',()=>{
 assert.equal(run([short,short,short]).length,1);
});
test('A02: an uncertain short fast exit cannot displace a verified longer slower exit',()=>{
 const js=run([snap,short],{maxWalkingMeters:500});
 assert.equal(js.length,2);
 assert.ok(js.some(j=>j.requiresSnapConfirmation));
 assert.ok(js.some(j=>!j.requiresSnapConfirmation));
});
test('A02: adding a path outside the walking cap cannot remove prior journey',()=>{
 const budget=[100,169,170,500,949,950,1200];
 for(const cap of budget){const before=arrival(run([short],{maxWalkingMeters:cap}));const after=arrival(run([short,fast],{maxWalkingMeters:cap}));for(const j of before)assert.ok(after.some(x=>x.arrival===j.arrival&&x.walk===j.walk),`cap=${cap}: lost ${JSON.stringify(j)}`);}
});
test('A02: capped options return no fabricated journey when all paths exceed budget',()=>{
 assert.deepEqual(run([fast],{maxWalkingMeters:500}),[]);
});
test('A02: two equal-cost valid exits do not duplicate itineraries',()=>{
 const cloned={...short,geometry:[B,{lat:(B.lat+D.lat)/2,lon:B.lon},D],provider:'alternative'};
 assert.equal(run([cloned,short]).length,1);
 assert.equal(run([short,cloned]).length,1);
});
