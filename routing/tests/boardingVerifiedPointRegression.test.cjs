const test = require('node:test');
const assert = require('node:assert/strict');
const {journeyBoardingDetails,applyBoardingEvidence}=require('../dist/index.js');

const version='verified-point-test-v1';
const original={id:'BALLINA_STOP',name:'Ballina stop',lat:54.11101,lon:-9.1599,code:'555051'};
const timetable={feedVersion:version,timezone:'Europe/Dublin',routes:[],trips:[],stopTimes:[],calendars:[],exceptions:[],stops:[original]};
const verified={stopId:'BALLINA_STOP',feedVersion:version,verifiedAt:'2026-10-07',sourceUrl:'https://example.org/review',reviewer:'manual',boardingPoint:{lat:54.11135,lon:-9.1599},sideOfStreet:'verified side'};
const departure={serviceDate:'2026-10-08',feedVersion:version,departureAtSeconds:1000,arrivalAtSeconds:2000,transfers:0,walkingMeters:50,predictionType:'scheduled',boardings:[],legs:[
 {type:'walk',purpose:'access',provider:'tested-pedestrian',durationSeconds:42,distanceMeters:50,from:{lat:54.1118,lon:-9.1613},to:verified.boardingPoint,geometry:[{lat:54.1118,lon:-9.1613},verified.boardingPoint]},
 {type:'ride',tripId:'T',routeId:'R',routeName:'Bus',headsign:'Castlebar',mode:'bus',boardStopId:original.id,alightStopId:'DEST',boardAtSeconds:1100,alightAtSeconds:1900,serviceDate:'2026-10-08'},
]};
test('boarded walk is attached to separately verified point even when GTFS coordinate is 38m away',()=>{
 const annotated=applyBoardingEvidence(timetable,[verified]);
 const result=journeyBoardingDetails(departure,annotated.stops);
 assert.equal(result.length,1);
 assert.equal(result[0].walkingDistanceMeters,50);
 assert.equal(result[0].walkingDurationSeconds,42);
 assert.equal(result[0].boardingPointSource,'verified_override');
 assert.equal(result[0].sideOfStreet,'verified side');
 assert.deepEqual(result[0].coordinate,{lat:original.lat,lon:original.lon});
});
test('without validated evidence, side and platform remain unverified',()=>{
 const result=journeyBoardingDetails({...departure,legs:[{...departure.legs[0],to:{lat:original.lat,lon:original.lon}},departure.legs[1]]},[original]);
 assert.equal(result[0].boardingPointSource,'official_gtfs');
 assert.equal(result[0].sideOfStreet,null);
});
