const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {searchSchedules,parseStopQuery,catalog,createScheduleReader}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
const fixture=JSON.parse(fs.readFileSync('routing/fixtures/nta-420-ballina-mayo-hospital-2026-10-08.json'));
const snapshot=()=>({version:fixture.feed_version,start:'2026-10-07',end:'2027-10-07',loadedAt:new Date().toISOString(),tables:{...structuredClone(fixture.tables),times:structuredClone(fixture.tables.stopTimes),exceptions:structuredClone(fixture.tables.calendarDates)}});
const q={from:'8490B5550501',to:'8490B151091',date:'2026-10-08',time:'07:55',modes:'bus,rail',changes:'2'};
test('historical official 420 timetable retains actual IDs, stops, pickup and 08:00→08:52',()=>{
 const result=searchSchedules(snapshot(),q);
 assert.equal(result.source,'nta_gtfs');assert.equal(result.realTimeApplied,false);assert.equal(result.walkingIncluded,false);
 assert.equal(result.journeys.length,1);const ride=result.journeys[0].rides[0];
 assert.equal(ride.tripId,'5913_63092');assert.equal(ride.boardAt,28800);assert.equal(ride.alightAt,31920);assert.equal(ride.from.code,'555051');
 assert.equal(searchSchedules(snapshot(),{...q,from:q.to,to:q.from}).journeys.length,0);
});
test('never projects historical calendar onto the next day or manufactures no-service after schema failure',()=>{
 assert.equal(searchSchedules(snapshot(),{...q,date:'2026-10-09'}).journeys.length,0);
 const s=snapshot();s.tables.times[1].arrival_seconds=NaN;assert.throws(()=>searchSchedules(s,q),/invalid_trip_schedule/);
 assert.equal(searchSchedules(snapshot(),{...q,date:'2026-10-26'}).journeys.length,0);
 assert.throws(()=>searchSchedules(snapshot(),{...q,from:'made-up'}),/unknown_stop/);
});
test('GTFS untimed intermediate stop is preserved without interpolation or disabling timed endpoints',()=>{
 const s=snapshot();s.tables.times[1].arrival_seconds=null;s.tables.times[1].departure_seconds=null;
 assert.equal(searchSchedules(s,q).journeys[0].arrivalAt,31920);
 assert.equal(searchSchedules(s,{...q,to:s.tables.times[1].stop_id}).journeys.length,0);
});
function connection(extra=0,different=false){
 const s=snapshot(),t=s.tables;
 t.stops.push({version:s.version,stop_id:'END',stop_name:'Final stop',stop_lat:53.84,stop_lon:-9.31});
 if(different)t.stops.push({version:s.version,stop_id:'OTHER-BAY',stop_name:'Mayo Hospital',stop_lat:53.85184,stop_lon:-9.30599});
 t.trips.push({version:s.version,trip_id:'connection-fixture',route_id:t.routes[0].route_id,service_id:'66',trip_headsign:'Final'});
 t.times.push({version:s.version,trip_id:'connection-fixture',stop_id:different?'OTHER-BAY':q.to,stop_sequence:1,arrival_seconds:32040+extra,departure_seconds:32040+extra,pickup_type:0,drop_off_type:1},
 {version:s.version,trip_id:'connection-fixture',stop_id:'END',stop_sequence:2,arrival_seconds:33000,departure_seconds:33000,pickup_type:1,drop_off_type:0});return s;
}
test('same-stop connection requires 120 seconds and preserves both trip histories; identical coordinates do not prove bay transfer',()=>{
 const search={...q,to:'END'};const r=searchSchedules(connection(),search);
 assert.equal(r.journeys.length,1);assert.equal(r.journeys[0].changes,1);assert.equal(r.journeys[0].rides[1].boardAt-r.journeys[0].rides[0].alightAt,120);
 assert.equal(searchSchedules(connection(-1),search).journeys.length,0);
 assert.equal(searchSchedules(connection(0,true),search).journeys.length,0);
 assert.equal(searchSchedules(connection(),{...search,changes:'0'}).journeys.length,0);
});
test('midnight continuation uses previous GTFS service day without relabelling its date',()=>{
 const s=snapshot();s.tables.times.forEach(r=>{r.arrival_seconds+=18*3600;r.departure_seconds+=18*3600});
 const r=searchSchedules(s,{...q,date:'2026-10-09',time:'01:55'});assert.equal(r.journeys.length,1);
 assert.equal(r.journeys[0].departureAt,7200);assert.equal(r.journeys[0].rides[0].serviceDate,'2026-10-08');
});
test('GTFS services outside declared feed validity never leak through adjacent-day search',()=>{
 const s=snapshot();s.end='2026-10-08';s.tables.exceptions.push({version:s.version,service_id:'66',service_date:'2026-10-09',exception_type:1});
 assert.equal(searchSchedules(s,{...q,time:'23:00'}).journeys.length,0);
});
test('rail is included only for official rail route_type; ferry never becomes bus or train',()=>{
 const s=snapshot();s.tables.routes[0].route_type=2;
 assert.equal(searchSchedules(s,{...q,modes:'rail'}).journeys[0].rides[0].mode,'rail');
 assert.equal(searchSchedules(s,{...q,modes:'bus'}).journeys.length,0);
 s.tables.routes[0].route_type=4;assert.throws(()=>catalog(s),/invalid_stop_catalog/);
});
test('public inputs enforce unique whitelist, dates today through +14 and bounded modes/changes before querying',()=>{
 const valid=new URLSearchParams({...q,date:'2026-10-13'}),now=new Date('2026-10-13T12:00:00Z');
 assert.deepEqual(parseStopQuery(valid,now),Object.fromEntries(valid));
 for(const [key,value] of [['date','2026-10-11'],['date','2026-11-01'],['date','2026-02-30'],['time','24:00'],['modes','ferry'],['changes','3'],['from','https://private.example/'],['to',q.from]]){
  const p=new URLSearchParams(valid);p.set(key,value);assert.equal(parseStopQuery(p,now),null);
 }
 for(const key of ['date','action','url','apikey']){const p=new URLSearchParams(valid);p.append(key,'bad');assert.equal(parseStopQuery(p,now),null);}
});
test('snapshot loader single-flight, rejects mixed/changed feeds, and uses existing runtime headers only on fixed root',async()=>{
 const data=snapshot();let calls=0;
 const tables={gtfs_stops:'stops',gtfs_routes:'routes',gtfs_trips:'trips',gtfs_stop_times:'times',gtfs_calendars:'calendars',gtfs_calendar_dates:'exceptions'};
 const fetcher=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.headers.apikey,'server-only-fixture');
  const u=new URL(url);assert.equal(u.origin,'https://fixture.supabase.co');
  if(u.pathname.endsWith('gtfs_feed_versions'))return Response.json([{version:data.version,feed_start_date:data.start,feed_end_date:data.end}]);
  return Response.json(data.tables[tables[u.pathname.split('/').at(-1)]]);
 };
 const reader=createScheduleReader('https://fixture.supabase.co',{apikey:'server-only-fixture'},fetcher);
 const [a,b]=await Promise.all([reader(),reader()]);assert.equal(a,b);assert.equal(calls,8);await reader();assert.equal(calls,9);
 const bad=createScheduleReader('https://fixture.supabase.co',{},async(url,init)=>String(url).includes('gtfs_stops?')?Response.json([{version:'different'}]):fetcher(url,{...init,headers:{apikey:'server-only-fixture'}}));
 await assert.rejects(bad(),/invalid_snapshot/);
});
