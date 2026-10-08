import {boardingInstruction,proximityMeters,MAX_WALK_ENDPOINT_DRIFT_METERS} from './boarding.ts';
import type {BoardingInstruction,Confidence,Journey,LatLon,Stop,Timetable,WalkLeg} from './types.ts';

/**
 * Manually reviewed boarding evidence, kept apart from the immutable NTA GTFS.
 * The evidence must name its source and review date. Absence means unverified.
 * It never overrides the official stop ID, public stop code or official coordinate.
 */
export interface BoardingEvidence {
  stopId:string;
  feedVersion:string;
  verifiedAt:string; // YYYY-MM-DD, UTC date
  sourceUrl:string; // source record, not a self-asserted note
  reviewer:string;
  sideOfStreet?:string;
  platform?:string;
  accessNote?:string;
  /** Optional independently checked *actual boarding* coordinate, not a guessed curb position. */
  boardingPoint?:LatLon;
}
export interface DetailedBoarding extends BoardingInstruction {
  /** Official GTFS position can differ from a separately verified boarding point. */
  boardingPoint:LatLon;
  boardingPointSource:'official_gtfs'|'verified_override';
  evidenceSourceUrl:string|null;
  evidenceVerifiedAt:string|null;
  walkingDistanceMeters:number|null;
  walkingDurationSeconds:number|null;
}
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const validPoint=(p:LatLon):boolean=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
function validateEvidence(e:BoardingEvidence):void {
  const timestamp=datePattern.test(e.verifiedAt)?Date.parse(e.verifiedAt+'T00:00:00Z'):NaN;
  if(!e.stopId||!e.feedVersion||!e.reviewer?.trim()||!Number.isFinite(timestamp)||
     new Date(timestamp).toISOString().slice(0,10)!==e.verifiedAt || timestamp>Date.now()) {
    throw new Error('boarding_invalid_evidence');
  }
  const url=(()=>{try{return new URL(e.sourceUrl)}catch{return null}})();
  if(!url || url.protocol!=='https:' || !url.hostname || url.username || url.password)throw new Error('boarding_invalid_source');
  if(e.boardingPoint&&!validPoint(e.boardingPoint))throw new Error('boarding_invalid_coordinate');
}
/** A reviewed annotation is applied only to the GTFS version it was reviewed against. */
export function applyBoardingEvidence(data:Timetable,evidence:BoardingEvidence[]):Timetable {
  const known=new Set(data.stops.map(s=>s.id));
  const annotated=new Map<string,BoardingEvidence>();
  const byStop=new Map(data.stops.map(s=>[s.id,s]));
  for(const e of evidence){
    validateEvidence(e);
    if(e.feedVersion!==data.feedVersion)continue; // stale reviews cannot silently survive GTFS refresh
    if(!known.has(e.stopId))throw new Error('boarding_unknown_stop');
    if(annotated.has(e.stopId))throw new Error('boarding_duplicate_evidence');
    const stop=byStop.get(e.stopId)!;
    if(e.boardingPoint && proximityMeters(stop,e.boardingPoint)>75)throw new Error('boarding_override_too_far_from_gtfs');
    annotated.set(e.stopId,e);
  }
  return {...data,stops:data.stops.map(s=>{
    const e=annotated.get(s.id);
    if(!e)return {...s,boarding:{confidence:'official_unverified' as Confidence}};
    return {...s,boarding:{confidence:'verified' as Confidence,
      sideOfStreet:e.sideOfStreet,platform:e.platform,note:e.accessNote,
      boardingPoint:e.boardingPoint,sourceUrl:e.sourceUrl,verifiedAt:e.verifiedAt}};
  })};
}
/** Keep the pedestrian arrival aligned with the separately verified boarding point. */
function verifiedBoardingPoint(stop:Stop):LatLon {
  return stop.boarding?.confidence==='verified' && stop.boarding.sourceUrl && stop.boarding.verifiedAt && stop.boarding.boardingPoint
    ? stop.boarding.boardingPoint : {lat:stop.lat,lon:stop.lon};
}
/** These details drive the future "Where do I catch the bus?" card in the webapp. */
export function journeyBoardingDetails(journey:Journey,stops:Stop[]):DetailedBoarding[] {
  const known=new Map(stops.map(s=>[s.id,s]));
  const out:DetailedBoarding[]=[];
  for(let i=0;i<journey.legs.length;i++){
    const leg=journey.legs[i]!;
    if(leg.type!=='ride')continue;
    const stop=known.get(leg.boardStopId);
    if(!stop)throw new Error('boarding_stop_missing');
    const instruction=boardingInstruction(stop);
    const walk=journey.legs[i-1];
    const relevantWalk=walk?.type==='walk'&&(walk as WalkLeg).purpose!=='egress'
      &&proximityMeters(walk.to,verifiedBoardingPoint(stop))<=MAX_WALK_ENDPOINT_DRIFT_METERS ? walk as WalkLeg:null;
    const verified=instruction.locationConfidence==='verified' && !!stop.boarding?.sourceUrl;
    out.push({...instruction,
      boardingPoint:verified && stop.boarding?.boardingPoint ? stop.boarding.boardingPoint : {lat:stop.lat,lon:stop.lon},
      boardingPointSource:verified&&stop.boarding?.boardingPoint?'verified_override':'official_gtfs',
      evidenceSourceUrl:verified?stop.boarding?.sourceUrl??null:null,
      evidenceVerifiedAt:verified?stop.boarding?.verifiedAt??null:null,
      walkingDistanceMeters:relevantWalk?.distanceMeters??null,
      walkingDurationSeconds:relevantWalk?.durationSeconds??null,
    });
  }
  return out;
}
