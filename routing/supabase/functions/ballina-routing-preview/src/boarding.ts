import type {BoardingInstruction,Stop} from './types.ts';
/** Provisional snapped-point tolerances, independent of boarding-bay verification. */
export const MAX_WALK_ENDPOINT_DRIFT_METERS=25; // Stops: do not infer a boarding bay from a snapped road.
export const MAX_USER_ENDPOINT_DRIFT_METERS=50; // Provisional conservative cap pending measured road-snap histogram.
export const USER_SNAP_CONFIRMATION_METERS=25; // UI must ask rider to verify snapped road point above this distance.
export function boardingInstruction(stop:Stop):BoardingInstruction {
  const conf=stop.boarding?.confidence==='verified' && !!stop.boarding.sourceUrl && !!stop.boarding.verifiedAt
    ?'verified':'official_unverified';
  return {
    stopId:stop.id,stopCode:stop.code??null,stopName:stop.name,
    coordinate:{lat:stop.lat,lon:stop.lon},locationConfidence:conf,
    sideOfStreet:conf==='verified'?stop.boarding?.sideOfStreet??null:null,
    platform:conf==='verified'?stop.boarding?.platform??null:null,
    notes:conf==='verified'?stop.boarding?.note??null:null,
    caveat:conf==='verified'?null:'Stop coordinates from GTFS; correct sidewalk or boarding bay not independently verified.'
  };
}
export function proximityMeters(a:{lat:number;lon:number},b:{lat:number;lon:number}):number {
  const r=6371000;
  const dlat=(b.lat-a.lat)*Math.PI/180;
  const dlon=(b.lon-a.lon)*Math.PI/180;
  const t=Math.sin(dlat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dlon/2)**2;
  return 2*r*Math.asin(Math.min(1,Math.sqrt(t)));
}

/** Only a sourced, dated review may redirect the pedestrian route away from the official coordinate. */
export function routableStopCoordinate(stop:Stop):{lat:number;lon:number} {
  if(stop.boarding?.confidence==='verified'&&stop.boarding.sourceUrl&&stop.boarding.verifiedAt&&stop.boarding.boardingPoint) {
    return {lat:stop.boarding.boardingPoint.lat,lon:stop.boarding.boardingPoint.lon};
  }
  return {lat:stop.lat,lon:stop.lon};
}
