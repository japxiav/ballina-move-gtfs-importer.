'use strict';
// Independent exhaustive enumeration + pairwise completed-journey oracle.
// No production discovery/skyline helpers are reused. No network or paid providers.
const assert=require('node:assert/strict');
const {searchSchedules,searchScheduledJourneys}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
const DATE='2026-10-13';
const day=(date,delta)=>new Date(Date.parse(date+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const regular=v=>v==null||v===0;
const secs=v=>Number.isInteger(v)&&v>=0&&v<=259200;
const key=rides=>JSON.stringify(rides.map(r=>[r.serviceDate,r.tripId,r.routeId,r.mode,r.from.id,r.to.id,r.boardSequence,r.alightSequence,r.boardAt,r.alightAt]));
const signature=rides=>({key:key(rides),dep:rides[0].boardAt,arr:rides.at(-1).alightAt,changes:rides.length-1});
const dominates=(a,b)=>a.arr<=b.arr&&a.dep>=b.dep&&a.changes<=b.changes&&(a.arr<b.arr||a.dep>b.dep||a.changes<b.changes);
const compare=(a,b)=>a.arr-b.arr||a.changes-b.changes||b.dep-a.dep||(a.key<b.key?-1:a.key>b.key?1:0);
function enumerate(snapshot,q){
 const t=snapshot.tables,stopMap=new Map(t.stops.map(s=>[s.stop_id,{id:s.stop_id}])),routeMap=new Map(t.routes.map(r=>[r.route_id,r]));
 const start=Number(q.time.slice(0,2))*3600+Number(q.time.slice(3))*60,end=start+129600,instances=[];
 for(const trip of t.trips){
  const route=routeMap.get(trip.route_id),mode=route.route_type===3?'bus':route.route_type===2?'rail':null;
  if(!mode||!q.modes.split(',').includes(mode))continue;
  const rows=t.times.filter(r=>r.trip_id===trip.trip_id).sort((a,b)=>a.stop_sequence-b.stop_sequence);
  for(let delta=-2;delta<=2;delta++){
   const date=day(q.date,delta);if(date<snapshot.start||date>snapshot.end)continue;
   const exception=t.exceptions.find(e=>e.service_id===trip.service_id&&String(e.service_date).slice(0,10)===date);
   const calendar=t.calendars.find(c=>c.service_id===trip.service_id);
   const active=exception?exception.exception_type===1:!!calendar&&date>=calendar.start_date&&date<=calendar.end_date&&calendar[names[new Date(date+'T00:00:00Z').getUTCDay()]]===true;
   if(active)instances.push({trip,route,rows,delta,date,mode,vehicle:JSON.stringify([date,trip.trip_id])});
  }
 }
 const complete=new Map();let visited=0;
 function visit(stop,at,rides,used){
  assert.ok(++visited<20000,'oracle small-dataset bound exceeded');
  if(rides.length>=Number(q.changes)+1)return;
  for(const instance of instances){
   if(used.has(instance.vehicle))continue;
   const {rows,delta,date,trip,route,mode}=instance;
   for(let board=0;board<rows.length-1;board++){
    const b=rows[board],boardAt=b.departure_seconds+delta*86400;
    if(b.stop_id!==stop||!secs(b.departure_seconds)||!regular(b.pickup_type)||boardAt<at+(rides.length?120:60)||boardAt<start+60||boardAt>end)continue;
    for(let exit=board+1;exit<rows.length;exit++){
     const e=rows[exit],alightAt=e.arrival_seconds+delta*86400;
     if(!secs(e.arrival_seconds)||!regular(e.drop_off_type)||alightAt>end)continue;
     const next=[...rides,{serviceDate:date,tripId:trip.trip_id,routeId:route.route_id,mode,from:stopMap.get(b.stop_id),to:stopMap.get(e.stop_id),boardSequence:b.stop_sequence,alightSequence:e.stop_sequence,boardAt,alightAt}];
     if(e.stop_id===q.to){complete.set(key(next),signature(next));continue;}
     if(e.stop_id!==q.from)visit(e.stop_id,alightAt,next,new Set([...used,instance.vehicle]));
    }
   }
  }
 }
 visit(q.from,start,[],new Set());
 const all=[...complete.values()];assert.ok(all.length<2500,'oracle pairwise bound exceeded');
 return all.filter(j=>!all.some(other=>dominates(other,j))).sort(compare).slice(0,6).map(j=>j.key);
}
const row=(version,x)=>({version,...x});
function snapshot(spec,version='independent-oracle-feed'){
 const routes=[{route_id:'R:bus',route_type:3,route_short_name:'Fixture bus'},{route_id:'R:rail',route_type:2,route_short_name:'Fixture train'}];
 const ids=[...new Set(['A','D',...spec.flatMap(s=>s.stops)])];
 return {version,start:day(DATE,-2),end:day(DATE,2),loadedAt:DATE+'T12:00:00Z',tables:{stops:ids.map((id,i)=>row(version,{stop_id:id,stop_name:'Fixture '+id,stop_code:id,stop_lat:54+i*.0001,stop_lon:-9})),routes:routes.map(r=>row(version,r)),trips:spec.map((s,i)=>row(version,{trip_id:'trip:'+i,route_id:s.rail?'R:rail':'R:bus',service_id:s.service||'S'})),times:spec.flatMap((s,i)=>s.stops.map((stop,k)=>row(version,{trip_id:'trip:'+i,stop_id:stop,stop_sequence:k+1,arrival_seconds:s.times[k],departure_seconds:s.times[k],pickup_type:s.pickup?.[k]??0,drop_off_type:s.drop?.[k]??0}))),calendars:[row(version,{service_id:'S',start_date:DATE,end_date:DATE,tuesday:true})],exceptions:[]}};
}
let comparisons=0,maxResults=0;
function check(s,q,label){
 const expected=enumerate(s,q),actual=searchSchedules(s,q).journeys.map(j=>key(j.rides));
 assert.deepEqual(actual,expected,label);comparisons++;maxResults=Math.max(maxResults,actual.length);return actual;
}
function reversed(s){return {...s,tables:Object.fromEntries(Object.entries(s.tables).map(([k,v])=>[k,[...v].reverse()]))};}
const q={from:'A',to:'D',date:DATE,time:'07:50',modes:'bus,rail',changes:'2'};
const explicit=[
 ['later departures beyond cap',Array.from({length:9},(_,i)=>({stops:['A','D'],times:[28800+i*600,29100+i*600]}))],
 ['inclusive 36h horizon',[{stops:['A','D'],times:[157500,157800]},{stops:['A','D'],times:[157700,157900]}]],
 ['two operational ties',[{stops:['A','X'],times:[28800,29000]},{stops:['A','Y'],times:[28800,29000]},{stops:['X','Y','D'],times:[29300,29420,30000]}]],
 ['repeated stop occurrences',[{stops:['A','D','A','D'],times:[28800,29400,32400,33000]}]],
 ['strict dominated indirect',[{stops:['A','X'],times:[28800,29000]},{stops:['X','D'],times:[40000,41000]},{stops:['A','D'],times:[39000,41000]}]],
 ['later departure tradeoff',[{stops:['A','D'],times:[28800,29400]},{stops:['A','D'],times:[32400,33000]}]],
 ['same vehicle cannot be reboarded',[{stops:['A','X','Y','D'],times:[28800,29000,29200,29400]}]],
 ['pickup dropoff rules',[{stops:['A','D'],times:[28800,29400],pickup:[1,0]},{stops:['A','D'],times:[28900,29500],drop:[0,2]},{stops:['A','X'],times:[29000,29200]},{stops:['X','D'],times:[29320,29400]}]],
 ['after midnight and previous day 25h',[{stops:['A','D'],times:[90000,90600],service:'night'},{stops:['A','D'],times:[3700,4300]}]],
 ['two changes only',[{stops:['A','X'],times:[28800,29000]},{stops:['X','Y'],times:[29120,29400]},{stops:['Y','D'],times:[29520,30000]}]],
 ['identical summaries different vehicle IDs',[{stops:['A','D'],times:[28800,29400]},{stops:['A','D'],times:[28800,29400],rail:true}]],
];
for(const [label,spec]of explicit){
 const s=snapshot(spec);if(label.includes('previous'))s.tables.exceptions.push(row(s.version,{service_id:'night',service_date:day(DATE,-1),exception_type:1}));
 for(const changes of ['0','1','2'])for(const modes of ['bus','rail','bus,rail']){
  const query={...q,changes,modes,time:label.includes('previous')?'00:30':q.time};
  check(s,query,label);check(reversed(s),query,label+' reversed');
 }
}
const addedDay=snapshot([{stops:['A','D'],times:[600,1200]}]);
addedDay.tables.exceptions.push(row(addedDay.version,{service_id:'S',service_date:day(DATE,1),exception_type:1}));
for(const changes of ['0','1','2'])check(addedDay,{...q,time:'23:30',changes},'next-day calendar addition');
const removed=snapshot(explicit.find(x=>x[0]==='later departure tradeoff')[1]);removed.tables.exceptions.push(row(removed.version,{service_id:'S',service_date:DATE,exception_type:2}));
check(removed,q,'calendar removal overrides weekday');
let randomSeed=0x151091;const rand=n=>{randomSeed^=randomSeed<<13;randomSeed^=randomSeed>>>17;randomSeed^=randomSeed<<5;return (randomSeed>>>0)%n;};
for(let seed=0;seed<120;seed++){
 const spec=[{stops:['A','D'],times:[28800+rand(4)*300,30100+rand(4)*300]}];
 const pool=['A','X','Y','D'];
 for(let i=0;i<6;i++){
  const length=2+rand(3),stops=Array.from({length},()=>pool[rand(pool.length)]);let at=28500+rand(20)*120;
  const times=Array.from({length},()=>{at+=120+rand(5)*60;return at});
  spec.push({stops,times,rail:rand(3)===0,pickup:Array.from({length},()=>rand(5)?0:1+rand(3)),drop:Array.from({length},()=>rand(5)?0:1+rand(3))});
 }
 const s=snapshot(spec);
 for(const changes of ['0','1','2'])for(const modes of ['bus','bus,rail']){const query={...q,changes,modes};check(s,query,'seed '+seed);check(reversed(s),query,'seed '+seed+' reversed');}
}
(async()=>{
 const s=snapshot(explicit.find(x=>x[0]==='two operational ties')[1]);
 const original=await searchScheduledJourneys(s,q),permuted=await searchScheduledJourneys(reversed(s),q);
 assert.deepEqual(original.journeys.map(j=>j.id),permuted.journeys.map(j=>j.id),'stable hash across input permutations');
 for(const j of original.journeys){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['ballina-scheduled-v1',s.version,q.date,key(j.rides)])));
  const expected='j-'+Buffer.from(digest).toString('hex');assert.equal(j.id,expected,'native operational hash');
 }
 const feedChanged=await searchScheduledJourneys({...s,version:'second-feed'},q);
 assert.ok(original.journeys.every(j=>!feedChanged.journeys.some(other=>other.id===j.id)),'feed namespace changes IDs');
 const renamed=structuredClone(s);renamed.tables.routes.forEach(r=>r.route_short_name='Renamed presentation');renamed.tables.stops.forEach(r=>r.stop_name='Renamed display');
 assert.deepEqual((await searchScheduledJourneys(renamed,q)).journeys.map(j=>j.id),original.journeys.map(j=>j.id),'names do not identify services');
 console.log(JSON.stringify({status:'PASS',comparisons,seededDatasets:120,explicitDatasets:explicit.length,maxResults,scope:'exhaustive small-dataset DFS, pairwise completed-journey Pareto, operational tuples, permutations, native SHA256 IDs; zero network/provider calls'}));
})().catch(error=>{console.error(error);process.exitCode=1});
