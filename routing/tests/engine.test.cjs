const assert=require('node:assert/strict');
const test=require('node:test');
const {planJourneys,parseGtfsTime,activeService,boardingInstruction,displayServiceTime,dstTransitionDay}=require('../dist/index.js');
const date='2026-10-08';
const P={HOME:{lat:54.1000,lon:-9.2000},A:{lat:54.1005,lon:-9.2000},B:{lat:54.1010,lon:-9.2000},C:{lat:54.1020,lon:-9.2000},DEST:{lat:54.1025,lon:-9.2000},B2:{lat:54.1011,lon:-9.201}};
const geo=(a,b)=>[P[a],P[b]];
const W=(from,to,s,m)=>({durationSeconds:s,distanceMeters:m,geometry:geo(from,to),provider:'test-graph'});
const access=(id,s,m)=>({stopId:id,...W('HOME',id,s,m)});
const egress=(id,s,m)=>({stopId:id,...W(id,'DEST',s,m)});
function db(){return {
  feedVersion:'synthetic-fixture',timezone:'Europe/Dublin',
  stops:['A','B','B2','C'].map(id=>({id,name:'Fixture '+id,...P[id],code:'FIX-'+id})),
  routes:[{id:'R1',name:'R1',mode:'bus'},{id:'R2',name:'R2',mode:'bus'}],
  trips:[{id:'T1',routeId:'R1',serviceId:'WK',headsign:'Fixture B'},
         {id:'T2',routeId:'R2',serviceId:'WK',headsign:'Fixture C'}],
  stopTimes:[
    {tripId:'T1',stopId:'A',sequence:1,arrivalSeconds:32400,departureSeconds:33000}, // 09:10
    {tripId:'T1',stopId:'B',sequence:2,arrivalSeconds:34800,departureSeconds:34860},// 09:40
    {tripId:'T2',stopId:'B',sequence:1,arrivalSeconds:35040,departureSeconds:35100},// 09:45
    {tripId:'T2',stopId:'C',sequence:2,arrivalSeconds:36900,departureSeconds:36960},// 10:15
  ],calendars:[{serviceId:'WK',startDate:'2026-10-01',endDate:'2026-11-30',weekdays:[false,true,true,true,true,true,false]}],exceptions:[]
}}
function walking(){return {origin:P.HOME,destination:P.DEST,access:[access('A',300,400)],egress:[egress('C',300,300)],transfers:[]};}
const req={serviceDate:date,departAfterSeconds:32400,maxTransfers:1};
// 09:00 + 05:00 walk => 09:05, +60s board buffer to 09:10.
test('scheduled 2-leg itinerary with exact GTFS stops and route labels',()=>{
 const res=planJourneys(db(),walking(),req);
 assert.equal(res.length,1);const j=res[0];assert.equal(j.transfers,1);
 assert.equal(j.arrivalAtSeconds,37200); // 10:20
 assert.deepEqual(j.legs.map(l=>l.type),['walk','ride','ride','walk']);
 assert.deepEqual(j.boardings.map(b=>b.stopId),['A','B']);
 assert.equal(j.boardings[0].stopCode,'FIX-A');
 assert.match(j.boardings[0].caveat,/not independently verified/);
 assert.equal(j.predictionType,'scheduled');
});
test('departure time and boarding buffer prevents impossible trip',()=>{
 assert.deepEqual(planJourneys(db(),walking(),{...req,departAfterSeconds:32700}),[]);
});
test('transfer buffer prevents risky close connection',()=>{
 const d=db(); d.stopTimes.find(x=>x.tripId==='T2'&&x.stopId==='B').departureSeconds=34860;
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('pickup_type=1 means passenger cannot board there',()=>{
 const d=db();d.stopTimes[0].pickupType=1;
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('drop_off_type=1 prevents invalid transfer / alight',()=>{
 const d=db();d.stopTimes[1].dropOffType=1;
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('type 2 on-demand pickup not proposed as regular stop',()=>{
 const d=db();d.stopTimes[0].pickupType=2;
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('calendar weekday excludes Sunday',()=>{
 assert.deepEqual(planJourneys(db(),walking(),{...req,serviceDate:'2026-10-11'}),[]);
});
test('calendar dates override calendar for added and removed service',()=>{
 const d=db();d.exceptions=[{serviceId:'WK',date:date,type:2}];
 assert.deepEqual(planJourneys(d,walking(),req),[]);
 d.exceptions=[{serviceId:'WK',date:'2026-10-11',type:1}];
 assert.equal(planJourneys(d,walking(),{...req,serviceDate:'2026-10-11'}).length,1);
});
test('reject missing pedestrian paths rather than invent a straight line',()=>{
 const walk=walking();walk.access=[];
 assert.deepEqual(planJourneys(db(),walk,req),[]);
});
test('reject pedestrian path that misses real stop by over 25m',()=>{
 const walk=walking();walk.access[0].geometry=[P.HOME,P.C];
 assert.deepEqual(planJourneys(db(),walk,req),[]);
});
test('walk-distance cap checked before finding journey',()=>{
 assert.deepEqual(planJourneys(db(),walking(),{...req,maxWalkingMeters:600}),[]);
});
test('inter-stop transfer only with supplied real walking path',()=>{
 const d=db();d.stopTimes.find(x=>x.tripId==='T2'&&x.stopId==='B').stopId='B2';
 let walk=walking();assert.deepEqual(planJourneys(d,walk,req),[]);
 walk.transfers=[{fromStopId:'B',toStopId:'B2',...W('B','B2',80,90)}];
 assert.equal(planJourneys(d,walk,req).length,1);
 const journey=planJourneys(d,walk,req)[0];
 assert.equal(journey.transfers,1);
 assert.equal(journey.legs.filter(x=>x.type==='walk'&&x.purpose==='transfer').length,1);
});
test('unverified GTFS point must not invent boarding side',()=>{
 const unverified=boardingInstruction({...db().stops[0],boarding:{confidence:'official_unverified',sideOfStreet:'East',platform:'Z'}});
 assert.equal(unverified.sideOfStreet,null);assert.equal(unverified.platform,null);assert.ok(unverified.caveat);
 const verified=boardingInstruction({...db().stops[0],boarding:{confidence:'verified',sideOfStreet:'east sidewalk',platform:'Bay 1',sourceUrl:'https://example.org/review',verifiedAt:'2026-10-08'}});
 assert.equal(verified.sideOfStreet,'east sidewalk');assert.equal(verified.platform,'Bay 1');
});
test('GTFS 25-hour clock handled as elapsed service seconds (not time-of-day truncation)',()=>{
 const d=db();d.trips=[{id:'TN',routeId:'R1',serviceId:'WK'}];
 d.stopTimes=[{tripId:'TN',stopId:'A',sequence:1,arrivalSeconds:90000,departureSeconds:90600},
  {tripId:'TN',stopId:'C',sequence:2,arrivalSeconds:93000,departureSeconds:93200}];
 const res=planJourneys(d,walking(),{...req,departAfterSeconds:81000,maxTransfers:0});
 assert.equal(res.length,1);assert.equal(res[0].arrivalAtSeconds,93300);
 assert.equal(displayServiceTime(90600),'01:10 (+1d)');
});
test('strictly reject impossible non-monotonic trip sequence',()=>{
 const d=db();d.stopTimes[1].arrivalSeconds=31500;
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('GTFS parser and date validation',()=>{
 assert.equal(parseGtfsTime('25:15:00'),90900);
 assert.throws(()=>parseGtfsTime('18:99:00'));
 assert.equal(activeService('WK','2026-10-08',db().calendars,[]),true);
 assert.throws(()=>activeService('WK','2026-02-30',db().calendars,[]));
});
test('DST transition deliberately rejected until timezone-safe service-date conversion is implemented',()=>{
 assert.equal(dstTransitionDay('2026-10-25'),true);
 assert.throws(()=>planJourneys(db(),walking(),{...req,serviceDate:'2026-10-25'}),/dst_transition/);
});
test('wrong feed timezone intentionally rejected',()=>{
 const d=db();d.timezone='UTC';assert.throws(()=>planJourneys(d,walking(),req),/unsupported_timezone/);
});
test('no trips with no valid service, no phantom trip',()=>{
 const d=db();d.calendars=[];
 assert.deepEqual(planJourneys(d,walking(),req),[]);
});
test('never suggests alighting and re-boarding identical vehicle as extra transfer',()=>{
 const d=db();d.trips=[{id:'T1',routeId:'R1',serviceId:'WK'}];
 d.stopTimes=[{tripId:'T1',stopId:'A',sequence:1,arrivalSeconds:32500,departureSeconds:33000},
 {tripId:'T1',stopId:'B',sequence:2,arrivalSeconds:34800,departureSeconds:34900},
 {tripId:'T1',stopId:'C',sequence:3,arrivalSeconds:36500,departureSeconds:36560}];
 const res=planJourneys(d,walking(),{...req,maxTransfers:2});
 assert.equal(res.length,1);
 assert.equal(res[0].transfers,0);
});
test('maxTransfers=0 finds only direct trips',()=>{
 assert.deepEqual(planJourneys(db(),walking(),{...req,maxTransfers:0}),[]);
});
