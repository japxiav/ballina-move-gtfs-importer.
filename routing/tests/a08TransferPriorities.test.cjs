'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPedestrianPaths}=require('../dist/pedestrian.js');
const a={id:'A',name:'Ballina transfer from',lat:54.11,lon:-9.16};
const b={id:'B',name:'Ballina transfer to',lat:54.1102,lon:-9.1595};
const c={id:'C',name:'Dublin transfer from',lat:53.346,lon:-6.29};
const d={id:'D',name:'Dublin transfer to',lat:53.3462,lon:-6.2895};
const walked=[];
const router={walk:async(from,to)=>{
 walked.push([from,to]);return {distanceMeters:60,durationSeconds:50,geometry:[from,to],provider:'fixture-route'};
}};
const opts={maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:1,
 maxPedestrianDistanceMeters:2000,maxDirectWalkMeters:0,
 transferPairs:[{fromStopId:'C',toStopId:'D',priority:'cross_route'},
 {fromStopId:'A',toStopId:'B',priority:'cross_route'}]};
const query=extra=>buildPedestrianPaths(router,[a,b,c,d],a,b,{...opts,...extra});
test('A08: prioritize topology-relevant Mayo transfer over alphabetical Dublin cell at one call',async()=>{
 walked.length=0;
 const paths=await query({preferredTransferFromStopIds:['A'],preferredTransferToStopIds:['B']});
 assert.deepEqual(paths.transfers.map(p=>[p.fromStopId,p.toStopId]),[['A','B']]);
 assert.equal(paths.coverage.executed,1);
 assert.equal(paths.coverage.candidateLimitReached,true);
 assert.equal(walked.length,1);
});
test('A08: unranked transfer pairs remain a fallback and preserve the original deterministic order',async()=>{
 walked.length=0;
 const paths=await query({preferredTransferFromStopIds:['A'],preferredTransferToStopIds:['D']});
 assert.deepEqual(paths.transfers.map(p=>[p.fromStopId,p.toStopId]),[['C','D']]);
 assert.equal(paths.coverage.executed,1);
 assert.equal(paths.coverage.candidateLimitReached,true);
});
test('A08: directional hints must not accidentally prefer the reverse direction',async()=>{
 walked.length=0;
 const paths=await query({preferredTransferFromStopIds:['B'],preferredTransferToStopIds:['A']});
 assert.deepEqual(paths.transfers.map(p=>[p.fromStopId,p.toStopId]),[['C','D']]);
 assert.equal(paths.coverage.executed,1);
});
