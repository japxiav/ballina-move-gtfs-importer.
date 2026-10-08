import type {Journey,Position,Stop} from './types';
import {routableStopCoordinate} from './boarding';
type Feature = {type:'Feature';properties:Record<string,string|number|null>;geometry:{type:'LineString';coordinates:number[][]}|{type:'Point';coordinates:number[]}};
export interface Overlay {type:'FeatureCollection';features:Feature[]}
/** No invented bus shape: walking paths and boarding/alighting point markers only. */
export function journeyOverlay(journey:Journey,stops:Stop[]):Overlay {
  const stopMap=new Map(stops.map(s=>[s.id,s]));
  const points=(p:Position[])=>p.map(x=>[x.lon,x.lat]);
  const features:Feature[]=[];
  for(const [i,leg] of journey.legs.entries()){
    if(leg.type==='walk') {
      features.push({type:'Feature',properties:{kind:'walk',purpose:leg.purpose,step:i},geometry:{type:'LineString',coordinates:points(leg.geometry)}});
    }else {
      for(const [type,id] of [['board',leg.boardStopId],['alight',leg.alightStopId]] as const){
        const stop=stopMap.get(id);
        if(!stop)continue;
        features.push({type:'Feature',properties:{kind:type,stopId:id,stopCode:stop.code??null,tripId:leg.tripId,route:leg.routeName},geometry:{type:'Point',coordinates:[routableStopCoordinate(stop).lon,routableStopCoordinate(stop).lat]}});
      }
    }
  }
  return {type:'FeatureCollection',features};
}
