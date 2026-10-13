'use strict';
// Official capture replay; not a live query, passenger field test or completeness oracle.
const fs=require('node:fs'),crypto=require('node:crypto');
const {searchScheduledJourneys}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
const raw=fs.readFileSync(process.argv[2]),snapshot=JSON.parse(raw);
const towns=[['Ballina','8490B5550501','8490IR0076'],['Castlebar','8490B5557201','8490IR0081'],['Foxford','8490B141651','8490IR0080'],['Westport','8490B151011','8490IR0078']];
const cases=[];
for(const a of towns)for(const b of towns)if(a!==b)for(const modes of ['bus','rail'])for(const date of ['2026-10-13','2026-10-18'])for(const time of ['00:05','07:00'])cases.push({from:a[modes==='bus'?1:2],to:b[modes==='bus'?1:2],date,time,modes,changes:'2'});
for(const stop of ['8490B151081','8490B151091'])for(const date of ['2026-10-13','2026-10-17'])for(const reverse of [false,true])cases.push({from:reverse?stop:towns[0][1],to:reverse?towns[0][1]:stop,date,time:'02:59',modes:'bus,rail',changes:'1'});
for(const a of towns)for(const modes of ['bus','rail'])cases.push({from:a[modes==='bus'?1:2],to:a===towns[0]?towns[1][modes==='bus'?1:2]:towns[0][modes==='bus'?1:2],date:'2026-10-25',time:'00:05',modes,changes:'2'});
(async()=>{
 const rows=[];
 for(const query of cases){
  if(query.date==='2026-10-25'){
   let expected=false;try{await searchScheduledJourneys(snapshot,query);}catch(error){expected=error.message==='clock_change_unsupported';}
   if(!expected)throw Error('DST fail-closed regression');rows.push({query,status:'CLOCK_CHANGE_UNSUPPORTED_EXPECTED',field:'UNVERIFIED',options:null});continue;
  }
  const r=await searchScheduledJourneys(snapshot,query);
  if(r.walkingIncluded!==false||r.realTimeApplied!==false||r.journeys.length>6)throw Error('scope');
  for(const j of r.journeys)if(!/^j-[a-f0-9]{64}$/.test(j.id)||j.rides[0].from.id!==query.from||j.rides.at(-1).to.id!==query.to||j.changes>Number(query.changes))throw Error('itinerary contract');
  rows.push({query,status:r.journeys.length?'PASS_LOCAL_CONTRACT':'NO_OPTIONS_LOCAL',options:r.journeys.length,field:'UNVERIFIED'});
 }
 console.log(JSON.stringify({scope:'offline official-capture contract matrix; not field/live completeness',snapshotSha256:crypto.createHash('sha256').update(raw).digest('hex'),feedVersion:snapshot.version,cases:rows.length,providerCalls:0,fieldVerified:0,rows},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
