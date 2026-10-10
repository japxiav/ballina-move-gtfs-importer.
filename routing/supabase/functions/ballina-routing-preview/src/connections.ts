import type {BoardingInstruction,Journey,RideLeg,Stop,WalkLeg} from './types.ts';
import {boardingInstruction,proximityMeters,routableStopCoordinate,MAX_WALK_ENDPOINT_DRIFT_METERS} from './boarding.ts';

/** Scheduled, never guaranteed: running late can invalidate any transfer. */
export interface ConnectionInstruction {
  kind:'same_stop'|'walk_between_stops';
  fromRoute:string;toRoute:string;
  alightStopId:string;alightStopName:string;alightStopCode:string|null;
  boardStopId:string;boardStopName:string;boardStopCode:string|null;
  alightAtSeconds:number;boardAtSeconds:number;
  transferWalkSeconds:number;transferWalkMeters:number;
  scheduledWindowSeconds:number;waitingAfterWalkSeconds:number;
  boarding:BoardingInstruction;
  guaranteed:false;
  note:string;
}

/** Explicit change instructions for the future map and step-by-step itinerary.
 * Uses only ride stops from the planner and pre-validated pedestrian leg geometry.
 * Never claims a particular platform without an independently sourced review. */
export function journeyConnections(journey:Journey,stops:Stop[]):ConnectionInstruction[]{
  const known=new Map(stops.map(s=>[s.id,s]));
  const connections:ConnectionInstruction[]=[];
  let previous:{ride:RideLeg;index:number}|null=null;
  for(const [index,leg] of journey.legs.entries()){
    if(leg.type!=='ride')continue;
    if(previous){
      const prior:RideLeg=previous.ride;
      const from=known.get(prior.alightStopId);
      const to=known.get(leg.boardStopId);
      if(!from||!to)throw new Error('connection_unknown_stop');
      const middle=journey.legs.slice(previous.index+1,index);
      if(middle.some(l=>l.type!=='walk'||l.purpose!=='transfer')||middle.length>1)
        throw new Error('connection_invalid_intermediate_legs');
      const walk=middle[0] as WalkLeg|undefined;
      if(from.id!==to.id && !walk)throw new Error('connection_missing_pedestrian_path');
      if(walk && (from.id===to.id ||
        proximityMeters(walk.from,routableStopCoordinate(from))>MAX_WALK_ENDPOINT_DRIFT_METERS ||
        proximityMeters(walk.to,routableStopCoordinate(to))>MAX_WALK_ENDPOINT_DRIFT_METERS))
        throw new Error('connection_unexpected_walk');
      const walkSecs=walk?.durationSeconds??0;
      const window=leg.boardAtSeconds-prior.alightAtSeconds;
      if(window<walkSecs)throw new Error('connection_impossible_schedule');
      connections.push({
        kind:walk?'walk_between_stops':'same_stop',
        fromRoute:prior.routeName,toRoute:leg.routeName,
        alightStopId:from.id,alightStopName:from.name,alightStopCode:from.code??null,
        boardStopId:to.id,boardStopName:to.name,boardStopCode:to.code??null,
        alightAtSeconds:prior.alightAtSeconds,boardAtSeconds:leg.boardAtSeconds,
        transferWalkSeconds:walkSecs,transferWalkMeters:walk?.distanceMeters??0,
        scheduledWindowSeconds:window,waitingAfterWalkSeconds:window-walkSecs,
        boarding:boardingInstruction(to),guaranteed:false,
        note:walk?'Walk between the indicated stops using the provided pedestrian route. Connection is scheduled, not guaranteed.':
          `Remain at the same GTFS stop for the next ${leg.mode==='rail'?'train':'bus'}. Physical platform/bay is not confirmed unless independently verified.`,
      });
    }
    previous={ride:leg,index};
  }
  return connections;
}
