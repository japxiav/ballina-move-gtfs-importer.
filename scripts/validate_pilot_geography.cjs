'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {catalog,searchScheduledJourneys}=require('/tmp/ballina-ts-compiled/ballina_journeys.js');
const {inspectWalkingConnection,distanceMeters}=require('/tmp/ballina-pilot-compiled/walking.js');
const snapshot=JSON.parse(fs.readFileSync(process.argv[2])),graph=JSON.parse(fs.readFileSync(process.argv[3]));
(async()=>{
 const stops=catalog(snapshot).stops,q={from:'8490B5550501',to:'8490B151081',date:'2026-10-13',time:'02:59',modes:'bus,rail',changes:'1'};
 const selected=await searchScheduledJourneys(snapshot,q),other=await searchScheduledJourneys(snapshot,{...q,to:'8490B151091'});
 const point=id=>{const s=stops.find(s=>s.id===id);if(!s)throw Error('missing_official_point');return{lat:s.lat,lon:s.lon};};
 const a=point('8490B151091'),b=point(q.to),tail=inspectWalkingConnection(graph,a,b);
 console.log(JSON.stringify({scope:'offline official-schedule replay and separate unverified last-mile inspection',
  officialSnapshotSha256:crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),
  selectedDestination:q.to,alternativeDestination:'8490B151091',sameDestination:false,
  historicalServiceDate:q.date,selectedScheduledArrival:selected.journeys[0]?.arrivalAt??null,alternativeScheduledArrival:other.journeys[0]?.arrivalAt??null,
  scheduledArrivalGapSeconds:selected.journeys[0]&&other.journeys[0]?selected.journeys[0].arrivalAt-other.journeys[0].arrivalAt:null,
  hospitalStopGeodesicMeters:distanceMeters(a,b),tail,
  wholeTripWalking:inspectWalkingConnection(graph,point(q.from),b).status,
  scheduledItinerariesModified:false,walkingEnabledPublicly:false,paidProviderCalls:0},null,2));
})().catch(()=>{console.error('Offline geography validation failed.');process.exitCode=1;});
