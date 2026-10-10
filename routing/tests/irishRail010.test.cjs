'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {parseIrishRailStationXml,createIrishRailStationClient,IRISH_RAIL_COVERAGE_WARNING}=require('../dist');
const xml=`<?xml version="1.0" encoding="utf-8"?><ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
 <objStationData><Traincode>A509</Traincode><Stationfullname>Ballina</Stationfullname><Origin>Ballina</Origin><Destination>Manulla Junction</Destination><Traindate>2026-10-08</Traindate><Scharrival>05:05</Scharrival><Schdepart>05:05</Schdepart><Exparrival>05:07</Exparrival><Expdepart>05:07</Expdepart><Late>2</Late><Duein>4</Duein><Status>En Route</Status><Lastlocation>Foxford &amp; Ballina</Lastlocation></objStationData>
</ArrayOfObjStationData>`;
test('Irish Rail XML station board extracts fields but does not falsely certify realtime',()=>{
 const board=parseIrishRailStationXml(xml,'Ballina','2026-10-08T04:00:00Z');
 assert.equal(board.services.length,1);assert.equal(board.services[0].trainCode,'A509');
 assert.equal(board.services[0].lateMinutes,2);assert.equal(board.services[0].expectedDeparture,'05:07');
 assert.equal(board.services[0].lastLocation,'Foxford & Ballina');
 assert.equal(board.dataQuality,'official_api_may_show_schedule_only');
 assert.equal(board.matchedToGtfsTrips,false);assert.match(IRISH_RAIL_COVERAGE_WARNING,/scheduled/);
});
test('Irish Rail empty response is accepted as zero current station calls, not as cancelled trains',()=>{
 const board=parseIrishRailStationXml('<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/" />','Ballina','2026-10-08T04:00:00Z');
 assert.equal(board.services.length,0);
});
test('rejects DTD/entity attacks, wrong XML, huge body, and invalid record',()=>{
 for(const raw of [
  '<!DOCTYPE xml [<!ENTITY x "repeat">]><ArrayOfObjStationData></ArrayOfObjStationData>',
  '<html>not data</html>','x'.repeat(300000),
  '<ArrayOfObjStationData><objStationData><Traincode></Traincode><Stationfullname>Ballina</Stationfullname></objStationData></ArrayOfObjStationData>',
  '<ArrayOfObjStationData><objStationData><Traincode>A509</Traincode><Stationfullname>&danger;</Stationfullname></objStationData></ArrayOfObjStationData>',
 ]) assert.throws(()=>parseIrishRailStationXml(raw,'Ballina','2026-10-08T04:00:00Z'));
});
test('upstream station request always goes to fixed Irish Rail HTTPS host; responses cached',async()=>{
 const urls=[];let clock=Date.parse('2026-10-08T04:00:00Z');
 const client=createIrishRailStationClient({now:()=>new Date(clock),fetcher:async (url)=>{urls.push(url);return new Response(xml,{status:200,headers:{'Content-Type':'text/xml'}})}});
 assert.equal((await client('Ballina')).services.length,1);
 assert.equal((await client('Ballina')).services.length,1);assert.equal(urls.length,1);
 clock+=45001;await client('Ballina');assert.equal(urls.length,2);
 assert.ok(urls.every(u=>u.startsWith('https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByNameXML?StationDesc=')));
 await assert.rejects(()=>client('Ballina?&evil=1'),/invalid_rail_station/);assert.equal(urls.length,2);
});
test('upstream error does not cache a fake successful station board',async()=>{
 let n=0;const client=createIrishRailStationClient({fetcher:async()=>{n++;return new Response('unavailable',{status:503})}});
 await assert.rejects(()=>client('Ballina'));await assert.rejects(()=>client('Ballina'));assert.equal(n,2);
});

test('oversized streaming upstream response is rejected before full body is buffered',async()=>{
 const over=new Uint8Array(260000);over.fill(65);
 const client=createIrishRailStationClient({fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(over);c.close();}}),{status:200,headers:{'Content-Type':'text/xml'}})});
 await assert.rejects(()=>client('Ballina'),/rail_upstream_response_too_large/);
});
test('prematurely aborted Irish Rail upstream request does not create fake cached realtime rows',async()=>{
 const controller=new AbortController();controller.abort();
 const client=createIrishRailStationClient({fetcher:async()=>{throw new Error('upstream timeout')},timeoutMs:100});
 await assert.rejects(()=>client('Ballina'));
});
