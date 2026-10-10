'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPedestrianPaths}=require('../dist/pedestrian.js');
const coord=(id,n)=>({id,name:id,lat:54.11+n*0.0002,lon:-9.16});
const stops=[coord('A',0),coord('B',1),coord('C',2),coord('D',3)];
const router={walk:async(from,to)=>({distanceMeters:25,durationSeconds:20,geometry:[from,to],provider:'a09-fixture'})};
const base={maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:1,maxRequestCount:3,
 maxPedestrianDistanceMeters:1000,candidateRadiusMeters:1000,maxDirectWalkMeters:0,
 preferredTransferFromStopIds:['A'],preferredTransferToStopIds:['B'],
 transferPairs:[{fromStopId:'C',toStopId:'D',priority:'cross_route'},
 {fromStopId:'A',toStopId:'B',priority:'cross_route'}]};
const query=extra=>buildPedestrianPaths(router,stops,stops[0],stops[3],{...base,...extra});

test('A09: audit splits stop caps from transfer cap and records topology hints',async()=>{
 const r=await query({});
 const a=r.coverage.candidateAudit;
 assert.deepEqual(a.origins,{nearbyGeodesic:4,selectionLimit:1,selected:1,omittedByStopCap:3});
 assert.deepEqual(a.destinations,{nearbyGeodesic:4,selectionLimit:1,selected:1,omittedByStopCap:3});
 assert.deepEqual(a.transfers,{possibleGtfsPairs:2,pairSelectionLimit:1,selected:1,omittedBySelectionLimit:1,
  topologyHinted:1,selectedTopologyHinted:1});
 assert.deepEqual(a.limitedBy,['origin_stop_cap','destination_stop_cap','transfer_pair_cap']);
 assert.equal(r.coverage.candidateLimitReached,true);
 assert.deepEqual(r.transfers.map(t=>[t.fromStopId,t.toStopId]),[['A','B']]);
 assert.equal(a.requestLimit,3);
});

test('A09: all candidates checked is not falsely marked limited',async()=>{
 const r=await query({maxOriginStops:4,maxDestinationStops:4,maxTransferPairs:2,maxRequestCount:12});
 const a=r.coverage.candidateAudit;
 assert.deepEqual(a.limitedBy,[]);
 assert.equal(a.origins.omittedByStopCap,0);
 assert.equal(a.destinations.omittedByStopCap,0);
 assert.equal(a.transfers.omittedBySelectionLimit,0);
 assert.equal(r.coverage.candidateLimitReached,false);
 assert.ok(r.coverage.executed<=12);
});

test('A09: zero request budget is distinguished from transfer pair cap',async()=>{
 const r=await query({maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:2,maxRequestCount:0});
 const a=r.coverage.candidateAudit;
 assert.equal(r.coverage.executed,0);
 assert.equal(a.transfers.possibleGtfsPairs,2);
 assert.equal(a.transfers.selected,0);
 assert.equal(a.transfers.omittedBySelectionLimit,2);
 assert.deepEqual(a.limitedBy,['origin_stop_cap','destination_stop_cap','transfer_preselection_budget']);
 assert.equal(r.coverage.candidateLimitReached,true);
});

test('A09: missing user endpoint candidates do not invent viable walks',async()=>{
 const distant={lat:53.1,lon:-8.1};
 const r=await buildPedestrianPaths(router,stops,distant,distant,{
  ...base,transferPairs:[],maxOriginStops:4,maxDestinationStops:4,maxTransferPairs:0});
 assert.equal(r.coverage.planned,0);
 assert.equal(r.coverage.executed,0);
 assert.deepEqual(r.coverage.candidateAudit.limitedBy,[]);
 assert.deepEqual(r.coverage.candidateAudit.origins,{nearbyGeodesic:0,selectionLimit:4,selected:0,omittedByStopCap:0});
});

test('A09: audit discloses aggregate counts without stop names or coordinates',async()=>{
 const a=(await query({})).coverage.candidateAudit;
 assert.ok(!JSON.stringify(a).includes('54.11'));
 assert.ok(!JSON.stringify(a).includes('Ballina'));
 assert.ok(!JSON.stringify(a).includes('stopId'));
});
