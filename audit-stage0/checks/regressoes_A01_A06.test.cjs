'use strict';
// Contract tests written for desired CORRECT behavior.  On the frozen Round 3
// candidate they MUST FAIL until their corresponding code defects are fixed.
// This is the opposite of a suite that asserts the old bug.
const test=require('node:test');
const assert=require('node:assert/strict');
const {planJourneys,planDoorToDoor,createRoutingApi,parseIrishRailStationXml,fromSupabaseTables}=require('../candidate/routing/dist/index.js');
const date='2026-10-08';
const service={serviceId:'d',startDate:'2026-10-01',endDate:'2026-10-31',weekdays:[true,true,true,true,true,true,true]};
const point=lat=>({lat,lon:-9.2});
const walk=(a,b,m,s)=>({distanceMeters:m,durationSeconds:s,geometry:[a,b],provider:'stage0-offline-fixture'});
const base=(stops,routes,trips,times)=>({feedVersion:'stage0',timezone:'Europe/Dublin',stops,routes,trips,stopTimes:times,calendars:[service],exceptions:[]});

async function transferFixture(){
  const O=point(54.099),A=point(54.1),B=point(54.105),C=point(54.1125),D=point(54.12),Z=point(54.121);
  const stops=[['A',A],['B',B],['C',C],['D',D]].map(([id,p])=>({id,name:id,...p}));
  const db=base(stops,[{id:'bus',name:'bus',mode:'bus'},{id:'rail',name:'rail',mode:'rail'}],
    [{id:'t1',routeId:'bus',serviceId:'d'},{id:'t2',routeId:'rail',serviceId:'d'}],
    [{tripId:'t1',stopId:'A',sequence:1,arrivalSeconds:33000,departureSeconds:33000},
     {tripId:'t1',stopId:'B',sequence:2,arrivalSeconds:34200,departureSeconds:34200},
     {tripId:'t2',stopId:'C',sequence:1,arrivalSeconds:35600,departureSeconds:35600},
     {tripId:'t2',stopId:'D',sequence:2,arrivalSeconds:37500,departureSeconds:37500}]);
  const req={serviceDate:date,departAfterSeconds:32400,origin:O,destination:Z,maxTransfers:1,maxWalkingMeters:2000,minTransferSeconds:120};
  const paths={origin:O,destination:Z,access:[{stopId:'A',...walk(O,A,100,90)}],egress:[{stopId:'D',...walk(D,Z,100,90)}],transfers:[{fromStopId:'B',toStopId:'C',...walk(B,C,900,720)}]};
  const key=p=>`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  let transferRequests=0;
  const router={walk:async(a,b)=>{
    if(key(a)===key(O)&&key(b)===key(A))return walk(a,b,100,90);
    if(key(a)===key(D)&&key(b)===key(Z))return walk(a,b,100,90);
    if(key(a)===key(B)&&key(b)===key(C)){transferRequests++;return walk(a,b,900,720)}
    return null;
  }};
  const opts={modes:['bus','rail'],maxRequestCount:24,maxTransferPairs:10,maxOriginStops:4,maxDestinationStops:4,maxDirectWalkMeters:0};
  return {oracle:planJourneys(db,paths,req),result:await planDoorToDoor(db,router,req,opts),transferRequests};
}

test('A01: descoberta considera transferencia verificada de 900m dentro de 2km',async()=>{
  const x=await transferFixture();
  assert.equal(x.oracle.length,1,'controle: horario e orcamento permitem o itinerario');
  assert.ok(x.transferRequests>0,'o provedor deve ser consultado para esta baldeacao');
  assert.ok(x.result.journeys.length>0,'nenhuma conexao viavel deve desaparecer silenciosamente');
});

test('A02: opcao rapida mas inviavel nao elimina opcao mais lenta e curta',()=>{
  const O=point(54.309),A=point(54.31),B=point(54.312),D=point(54.313);
  const db=base([{id:'a',name:'a',...A},{id:'b',name:'b',...B}],
    [{id:'r',name:'r',mode:'bus'}],[{id:'t',routeId:'r',serviceId:'d'}],
    [{tripId:'t',stopId:'a',sequence:1,arrivalSeconds:33000,departureSeconds:33000},
     {tripId:'t',stopId:'b',sequence:2,arrivalSeconds:35000,departureSeconds:35000}]);
  const input={origin:O,destination:D,access:[{stopId:'a',...walk(O,A,50,70)}],egress:[{stopId:'b',...walk(B,D,120,720)},{stopId:'b',...walk(B,D,900,690)}],transfers:[]};
  const req={serviceDate:date,departAfterSeconds:32400,maxTransfers:0,maxWalkingMeters:500};
  assert.equal(planJourneys(db,{...input,egress:[input.egress[0]]},req).length,1);
  assert.equal(planJourneys(db,input,req).length,1);
});

test('A03: aborto de request encerra leitura pendente de corpo sem fechar manualmente stream',async()=>{
  let close;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));close=()=>c.close();}});
  const controller=new AbortController();
  const request=new Request('https://example.invalid/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body,duplex:'half',signal:controller.signal});
  const handler=createRoutingApi({loadTimetable:async()=>{throw Error('unreachable')},router:{walk:async()=>null},consumeRateLimit:async()=>true,clientIdentity:()=> 'stage0'});
  let finished=false;
  const pending=handler(request).then(()=>{finished=true},()=>{finished=true});
  await new Promise(r=>setTimeout(r,45));controller.abort();
  await new Promise(r=>setTimeout(r,160));
  const afterAbort=finished;
  close();await pending; // cleanup even when baseline fails, without hanging test runner
  assert.equal(afterAbort,true,'reader continuou pendente apos req.signal abort');
});

const goodXml='<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/"><objStationData><Traincode>A123</Traincode><Stationfullname>Ballina</Stationfullname></objStationData></ArrayOfObjStationData>';
const parse=s=>parseIrishRailStationXml(s,'Ballina','2026-10-08T09:00:00Z');

test('A04: rejeita XML de raiz com case ou QName de fechamento incompatível',()=>{
  assert.equal(parse(goodXml).services.length,1);
  assert.throws(()=>parse(goodXml.replace('</ArrayOfObjStationData>','</arrayofobjstationdata>')));
  assert.throws(()=>parse(goodXml.replace('</ArrayOfObjStationData>','</z:ArrayOfObjStationData>')));
});

test('A05: rejeita atributo sem aspas e atributo duplicado',()=>{
  assert.equal(parse(goodXml).services.length,1);
  assert.throws(()=>parse(goodXml.replace('<objStationData>','<objStationData x=abc>')));
  assert.throws(()=>parse(goodXml.replace('<objStationData>','<objStationData x="1" x="2">')));
});

test('A06: rota GTFS ferry (4) nunca pode ser publicada com mode bus',()=>{
  const t=fromSupabaseTables({feedVersion:'v',routes:[{version:'v',route_id:'bus',route_type:3},{version:'v',route_id:'ferry',route_type:4}],stops:[],trips:[],stopTimes:[],calendars:[],calendarDates:[]});
  assert.equal(t.routes.find(r=>r.id==='bus')?.mode,'bus');
  assert.notEqual(t.routes.find(r=>r.id==='ferry')?.mode,'bus','ferry foi reclassificada silenciosamente como bus');
});
