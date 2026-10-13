const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessRideRealtime:assess}=require('/tmp/ballina-pilot-compiled/realtime.js');
const now=Date.parse('2026-10-13T07:00:00Z'),options={now,sourceAvailable:true};
const ride={feedVersion:'offline-gtfs',queryDate:'2026-10-13',serviceDate:'2026-10-13',tripId:'trip420',routeId:'route420',mode:'bus',boardSequence:3,alightSequence:8,from:{id:'A'},to:{id:'B'},boardAt:28800,alightAt:31920};
const update=(changes={})=>({source:'nta_gtfs_rt',feedVersion:ride.feedVersion,serviceDate:ride.serviceDate,tripId:ride.tripId,routeId:ride.routeId,mode:'bus',kind:'departure',stopId:'A',stopSequence:3,observedAt:'2026-10-13T06:59:30Z',expectedAt:'2026-10-13T07:02:00Z',fixture:'offline synthetic normalized update',...changes});
const cancel=(changes={})=>{const r=update({kind:'cancelled',...changes});delete r.expectedAt;delete r.stopId;delete r.stopSequence;return r;};
test('exact trip instance and repeated-stop sequence can supply evidence without changing scheduled times',()=>{
 const r=assess(ride,[update()],options);assert.equal(r.status,'prediction_evidence');assert.equal(r.predictedDepartureAt,'2026-10-13T07:02:00Z');assert.equal(r.predictedArrivalAt,null);
 assert.equal(r.scheduledBoardAt,ride.boardAt);assert.equal(r.scheduledAlightAt,ride.alightAt);assert.equal(r.publicItineraryRealtimeApplied,false);
 for(const key of ['feedVersion','serviceDate','tripId','routeId','mode','stopId','stopSequence']){const row=update({[key]:key==='stopSequence'?1:key==='mode'?'rail':key==='serviceDate'?'2026-10-12':'other'});assert.equal(assess(ride,[row],options).status,'unmatched');}
});
test('equivalent timestamps, own-age boundaries and newest identical vehicle are deterministic',()=>{
 assert.equal(assess(ride,[update(),update({expectedAt:'2026-10-13T07:02:00.000Z'})],options).status,'prediction_evidence');
 for(const [offset,status]of [[-180000,'prediction_evidence'],[-180001,'uncertain'],[15000,'prediction_evidence'],[15001,'uncertain']])assert.equal(assess(ride,[update({observedAt:new Date(now+offset).toISOString()})],options).status,status);
 const a=update({kind:'vehicle',vehicleId:'bus1',lat:54.1,lon:-9.1}),b={...a,observedAt:'2026-10-13T06:59:59Z'};
 for(const v of [a,b]){delete v.expectedAt;delete v.stopId;delete v.stopSequence;}
 assert.deepEqual(assess(ride,[a,b],options),assess(ride,[b,a],options));
 assert.equal(assess(ride,[a,b],options).matchedVehicle.observedAt,b.observedAt);
});
test('prediction evidence requires Dublin schedule alignment, query date and DST fail-closed behavior',()=>{
 assert.equal(assess({...ride,boardAt:60300,alightAt:63000},[update()],options).status,'uncertain');
 assert.equal(assess({...ride,queryDate:undefined},[update()],options).status,'uncertain');
 const transition={...ride,queryDate:'2026-10-25',serviceDate:'2026-10-25'};
 assert.equal(assess(transition,[update({serviceDate:'2026-10-25',observedAt:'2026-10-25T06:59:30Z',expectedAt:'2026-10-25T07:02:00Z'})],{...options,now:Date.parse('2026-10-25T07:00:00Z')}).reason,'schedule_clock_change_unsupported');
 const overnight={...ride,queryDate:'2026-10-13',serviceDate:'2026-10-12',boardAt:3600,alightAt:7200};
 assert.equal(assess(overnight,[update({serviceDate:'2026-10-12',observedAt:'2026-10-13T00:00:00Z',expectedAt:'2026-10-13T00:01:00Z'})],{...options,now:Date.parse('2026-10-13T00:00:00Z')}).status,'prediction_evidence');
 const winter={...ride,queryDate:'2027-01-13',serviceDate:'2027-01-13'};
 assert.equal(assess(winter,[update({serviceDate:winter.serviceDate,observedAt:'2027-01-13T08:00:00Z',expectedAt:'2027-01-13T08:02:00Z'})],{...options,now:Date.parse('2027-01-13T08:00:00Z')}).status,'prediction_evidence');
 const arrival=assess(ride,[update({kind:'arrival',stopId:'B',stopSequence:8,expectedAt:'2026-10-13T07:53:00Z'})],options);
 assert.equal(arrival.predictedArrivalAt,'2026-10-13T07:53:00Z');assert.equal(arrival.predictedDepartureAt,null);
});
test('source receipt, train code, GPS proximity and incomplete identities cannot renew predictions',()=>{
 for(const observedAt of [null,'2026-10-13T06:50:00Z','2026-10-13T07:01:00Z'])assert.equal(assess(ride,[update({observedAt,retrievedAt:'2026-10-13T07:00:00Z'})],options).status,'uncertain');
 assert.equal(assess({...ride,routeId:undefined},[update()],options).status,'unmatched');
 assert.equal(assess(ride,[update({source:'irish_rail_reports',TrainCode:ride.tripId})],options).status,'uncertain');
 const row=update();delete row.feedVersion;assert.equal(assess(ride,[row],options).status,'uncertain');
 assert.equal(assess(ride,[],{...options,sourceAvailable:false}).status,'unavailable');
});
test('fresh whole-trip cancellation expires by its own timestamp and conflicts never silently restore schedule',()=>{
 assert.equal(assess(ride,[cancel()],options).cancellationConfirmed,true);
 for(const observedAt of [null,'2026-10-13T06:50:00Z']){const r=assess(ride,[cancel({observedAt})],options);assert.equal(r.status,'uncertain');assert.equal(r.cancellationConfirmed,false);}
 assert.equal(assess(ride,[cancel(),update()],options).reason,'contradictory_cancelled_and_predicted');
 const r=assess(ride,[{...cancel(),stopId:'A',stopSequence:3}],options);assert.equal(r.status,'uncertain');
});
test('ambiguous, impossible or far-future predictions fail closed with no private-field exposure',()=>{
 assert.equal(assess(ride,[update(),update({expectedAt:'2026-10-13T07:03:00Z'})],options).reason,'ambiguous_realtime_match');
 assert.equal(assess(ride,[update(),update({kind:'arrival',stopId:'B',stopSequence:8,expectedAt:'2026-10-13T07:01:00Z'})],options).reason,'contradictory_prediction_order');
 for(const expectedAt of ['2030-10-13T07:02:00Z','2026-10-13T06:50:00Z','2026-02-30T07:02:00Z'])assert.equal(assess(ride,[update({expectedAt})],options).status,'uncertain');
 assert(!JSON.stringify(assess(ride,[update({private:'never-forward'})],options)).includes('never-forward'));
 assert.equal(assess(ride,Array(257).fill(update()),options).status,'uncertain');
});
test('matched fresh vehicle provides a position only, never an ETA or rail-code inference',()=>{
 const vehicle=update({kind:'vehicle',vehicleId:'bus1',lat:54.1,lon:-9.1});delete vehicle.expectedAt;delete vehicle.stopId;delete vehicle.stopSequence;
 const r=assess(ride,[vehicle],options);assert.equal(r.status,'position_only');assert.equal(r.predictedDepartureAt,null);assert.equal(r.matchedVehicle.id,'bus1');
 assert.equal(assess(ride,[vehicle,{...vehicle,vehicleId:'bus2'}],options).status,'uncertain');
 assert.equal(assess(ride,[cancel({observedAt:null}),vehicle],options).reason,'cancellation_observation_unconfirmed');
});
