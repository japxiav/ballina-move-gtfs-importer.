'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planDoorToDoor}=require('../dist/planner.js');
const {buildPedestrianPaths}=require('../dist/pedestrian.js');
const DATE='2026-10-10';
const stops=[
 {id:'O',name:'Origin',lat:54.100,lon:-9.100},
 {id:'A',name:'Real arrival',lat:54.109,lon:-9.100},
 {id:'B',name:'Real boarding',lat:54.10918,lon:-9.100},
 {id:'C',name:'Decoy arrival',lat:54.110,lon:-9.070},
 {id:'X',name:'Decoy boarding',lat:54.11018,lon:-9.070},
 {id:'D',name:'Destination',lat:54.130,lon:-9.100},
];
const point=id=>stops.find(s=>s.id===id);
const schedule=(tripId,from,to,depart,arrive)=>[
 {tripId,stopId:from,sequence:1,arrivalSeconds:depart,departureSeconds:depart},
 {tripId,stopId:to,sequence:2,arrivalSeconds:arrive,departureSeconds:arrive}];
const calendar=(serviceId,date=DATE)=>({serviceId,startDate:date,endDate:date,
 weekdays:[true,true,true,true,true,true,true]});
const data={feedVersion:'a10-fixture',timezone:'Europe/Dublin',stops,
 routes:[{id:'IN',name:'Inbound',mode:'bus'},{id:'OUT',name:'Outbound',mode:'bus'},
 {id:'XIN',name:'Decoy in',mode:'bus'},{id:'XOUT',name:'Decoy out',mode:'bus'}],
 trips:[{id:'in',routeId:'IN',serviceId:'sat'},{id:'out',routeId:'OUT',serviceId:'sat'},
 {id:'decoy-in',routeId:'XIN',serviceId:'sat'},{id:'decoy-out',routeId:'XOUT',serviceId:'sat'}],
 stopTimes:[
 ...schedule('in','O','A',9*3600+5*60,9*3600+20*60),
 ...schedule('out','B','D',9*3600+28*60,9*3600+40*60),
 ...schedule('decoy-in','O','C',9*3600+5*60,9*3600+31*60),
 ...schedule('decoy-out','X','D',9*3600+15*60,9*3600+30*60),
 ],calendars:[calendar('sat')],exceptions:[]};
const req={origin:point('O'),destination:point('D'),serviceDate:DATE,departAfterSeconds:9*3600,
 maxTransfers:1,maxWalkingMeters:2000,minTransferSeconds:180,minBoardingSeconds:90,limit:4};
const opts={maxRequestCount:3,maxOriginStops:1,maxDestinationStops:1,maxTransferPairs:1,
 maxDirectWalkMeters:0,candidateRadiusMeters:2000,maxPedestrianDistanceMeters:2000};
function fixtureRouter(){const calls=[];return {calls,walk:async(from,to)=>{
 calls.push([from,to]);return {distanceMeters:35,durationSeconds:30,geometry:[from,to],provider:'fixture-provider'};
}};}
const pairNames=paths=>paths.filter(l=>l.type==='ride').map(l=>l.tripId);

test('A10: one transfer call prioritizes actual scheduled connection over spatial decoys',async()=>{
 const router=fixtureRouter();const response=await planDoorToDoor(data,router,req,opts);
 const match=response.journeys.find(j=>pairNames(j.legs).join(',')==='in,out');
 assert.ok(match,'fast feasible 09:20 → 09:28 connection should survive one paid transfer');
 assert.equal(match.arrivalAtSeconds,9*3600+40*60);
 assert.equal(response.walkingRequestsBudget,3);
 assert.equal(response.coverage.executed,1,'zero-distance access/egress must not consume calls');
 assert.equal(router.calls.length,1);
 const audit=response.coverage.candidateAudit.transfers;
 assert.ok(audit.possibleGtfsPairs>1,'decoy transfers must exist');
 assert.ok(audit.timetableHinted>=1);
 assert.equal(audit.selectedTimetableHinted,1);
 assert.equal(response.coverage.candidateLimitReached,true);
});

test('A10: GTFS import order cannot change timed transfer selection',async()=>{
 const reversed={...data,stops:[...data.stops].reverse(),trips:[...data.trips].reverse(),
 stopTimes:[...data.stopTimes].reverse()};
 const a=await planDoorToDoor(data,fixtureRouter(),req,opts);
 const b=await planDoorToDoor(reversed,fixtureRouter(),req,opts);
 assert.deepEqual(a.journeys.map(j=>pairNames(j.legs)),b.journeys.map(j=>pairNames(j.legs)));
 assert.deepEqual(a.coverage.candidateAudit.transfers,b.coverage.candidateAudit.transfers);
});

test('A10: hints cannot turn an impossible late feeder into a valid journey',async()=>{
 const impossible={...data,stopTimes:data.stopTimes.map(row=>row.tripId==='in'&&row.stopId==='A'
  ?{...row,arrivalSeconds:9*3600+35*60,departureSeconds:9*3600+35*60}:row)};
 const response=await planDoorToDoor(impossible,fixtureRouter(),req,opts);
 assert.ok(!response.journeys.some(j=>pairNames(j.legs).join(',')==='in,out'));
 assert.equal(response.coverage.candidateAudit.transfers.timetableHinted,0);
 assert.ok(response.coverage.candidateAudit.transfers.possibleGtfsPairs>0,'fallback still exists');
});

test('A10: ranking preserves same-route transfers when timetable proves them reachable',async()=>{
 const sameRoute={...data,routes:[{id:'shared',name:'shared',mode:'bus'},...data.routes.filter(r=>!['IN','OUT'].includes(r.id))],
 trips:data.trips.map(t=>['in','out'].includes(t.id)?{...t,routeId:'shared'}:t)};
 const res=await planDoorToDoor(sameRoute,fixtureRouter(),req,opts);
 assert.ok(res.journeys.some(j=>pairNames(j.legs).join(',')==='in,out'));
 assert.equal(res.coverage.candidateAudit.transfers.selectedTimetableHinted,1);
});

test('A10: no GTFS evidence must preserve A08 geographic fallback and paid-call limit',async()=>{
 const router=fixtureRouter();const paths=await buildPedestrianPaths(router,stops,point('O'),point('D'),{
 maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:1,
 maxPedestrianDistanceMeters:2000,maxDirectWalkMeters:0,
 transferPairs:[{fromStopId:'C',toStopId:'X',priority:'cross_route'},
 {fromStopId:'A',toStopId:'B',priority:'cross_route'}],
 preferredTransferFromStopIds:['O'],preferredTransferToStopIds:['D'],
 });
 assert.deepEqual(paths.transfers.map(p=>[p.fromStopId,p.toStopId]),[['C','X']],
  'without timetable hints, original deterministic cell order must remain');
 assert.equal(paths.coverage.candidateAudit.transfers.timetableHinted,0);
 assert.equal(paths.coverage.executed,1);
});

test('A10: positive timetable hint never escapes the hard walking budget',async()=>{
 const router=fixtureRouter();const response=await buildPedestrianPaths(router,stops,point('O'),point('D'),{
 maxOriginStops:0,maxDestinationStops:0,maxTransferPairs:1,maxRequestCount:1,
 maxPedestrianDistanceMeters:15,maxDirectWalkMeters:0,
 transferPairs:[{fromStopId:'A',toStopId:'B',timetableArrivalEstimateSeconds:34500}],
 });
 assert.equal(response.coverage.executed,0);
 assert.equal(response.transfers.length,0);
 assert.equal(response.coverage.candidateAudit.transfers.possibleGtfsPairs,0);
});

test('A10: overnight 25:xx inbound plus next-day 01:25 outbound gets correctly prioritized',async()=>{
 const fr='2026-10-09';
 const overnight={...data,
  trips:[{id:'overnight-in',routeId:'IN',serviceId:'fri'},
    {id:'overnight-out',routeId:'OUT',serviceId:'sat'}],
  calendars:[calendar('fri',fr),calendar('sat',DATE)],
  stopTimes:[...schedule('overnight-in','O','A',25*3600+5*60,25*3600+20*60),
    ...schedule('overnight-out','B','D',1*3600+28*60,1*3600+40*60)]};
 const rr={...req,departAfterSeconds:3600};
 const result=await planDoorToDoor(overnight,fixtureRouter(),rr,opts);
 assert.ok(result.journeys.some(j=>pairNames(j.legs).join(',')==='overnight-in,overnight-out'));
 assert.equal(result.coverage.candidateAudit.transfers.selectedTimetableHinted,1);
});

test('A10: second eligible inbound vehicle survives same-trip exclusion in indexed event search',async()=>{
 const loop={...data,trips:[{id:'loop',routeId:'IN',serviceId:'sat'},
   {id:'other-in',routeId:'OUT',serviceId:'sat'}],
  stopTimes:[
    {tripId:'loop',stopId:'O',sequence:1,arrivalSeconds:32700,departureSeconds:32700},
    {tripId:'loop',stopId:'A',sequence:2,arrivalSeconds:33120,departureSeconds:33120},
    {tripId:'loop',stopId:'B',sequence:3,arrivalSeconds:34200,departureSeconds:34200},
    {tripId:'loop',stopId:'D',sequence:4,arrivalSeconds:34800,departureSeconds:34800},
    ...schedule('other-in','O','A',33000,33600),
  ]};
 const response=await planDoorToDoor(loop,fixtureRouter(),req,opts);
 const transfer=response.coverage.candidateAudit.transfers;
 assert.ok(transfer.timetableHinted>=1,'other-in 09:20 can change into loop 09:30');
 assert.ok(response.journeys.every(j=>!pairNames(j.legs).includes('invalid-train')));
});

test('A10: a single GTFS vehicle cannot be counted as a timed self-transfer',async()=>{
 const one={...data,trips:[{id:'loop',routeId:'IN',serviceId:'sat'}],
 stopTimes:[
  {tripId:'loop',stopId:'O',sequence:1,arrivalSeconds:32700,departureSeconds:32700},
  {tripId:'loop',stopId:'A',sequence:2,arrivalSeconds:33600,departureSeconds:33600},
  {tripId:'loop',stopId:'B',sequence:3,arrivalSeconds:34080,departureSeconds:34080},
  {tripId:'loop',stopId:'D',sequence:4,arrivalSeconds:34800,departureSeconds:34800},
 ]};
 const result=await planDoorToDoor(one,fixtureRouter(),req,opts);
 assert.equal(result.coverage.candidateAudit.transfers.timetableHinted,0);
 assert.ok(result.journeys.every(j=>j.transfers===0));
});

test('A10: inactive service cannot create a timed transfer or a fictitious journey',async()=>{
 const expired={...data,calendars:[{...calendar('sat'),endDate:'2026-10-09'}]};
 const res=await planDoorToDoor(expired,fixtureRouter(),req,opts);
 assert.equal(res.coverage.candidateAudit.transfers.timetableHinted,0);
 assert.equal(res.journeys.length,0);
});

test('A10: fastest and less_walking use different timetable evidence across geographic cells',async()=>{
 const changedStops=stops.map(s=>s.id==='B'?{...s,lat:54.115}:s);
 const changedTimes=data.stopTimes.map(s=>s.tripId==='decoy-out'
  ?{...s,arrivalSeconds:s.stopId==='X'?9*3600+41*60:9*3600+55*60,
    departureSeconds:s.stopId==='X'?9*3600+41*60:9*3600+55*60}:s);
 const table={...data,stops:changedStops,stopTimes:changedTimes};
 const ask=rankBy=>planDoorToDoor(table,fixtureRouter(),{...req,rankBy},opts);
 const fast=await ask('fastest');
 const less=await ask('less_walking');
 assert.ok(fast.journeys.some(j=>pairNames(j.legs).join(',')==='in,out'),
  'fastest must outrank the alphabetical cell containing the slower connection');
 assert.ok(less.journeys.some(j=>pairNames(j.legs).join(',')==='decoy-in,decoy-out'),
  'less_walking must prioritize the shorter transfer, even if it arrives later');
 assert.equal(fast.coverage.candidateAudit.transfers.selectedTimetableHinted,1);
 assert.equal(less.coverage.candidateAudit.transfers.selectedTimetableHinted,1);
});
