/** Dates and times follow GTFS local SERVICE-DAY time, never Unix UTC timestamps. */
export type LatLon = { lat: number; lon: number };
export type Position = LatLon;
export type Confidence = 'verified' | 'official_unverified';
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  code?: string | null;
  description?: string | null;
  /** Separate verified stop-specific metadata. Never infer this from coordinate alone. */
  boarding?: { confidence: Confidence; sideOfStreet?: string; platform?: string; note?: string; boardingPoint?:LatLon; sourceUrl?:string; verifiedAt?:string };
}
export interface Route { id: string; name: string; operator?: string; mode: 'bus'|'rail'; }
export interface Trip {
  id: string; routeId: string; serviceId: string; headsign?: string | null;
}
export interface StopTime {
  tripId: string;
  stopId: string;
  sequence: number;
  arrivalSeconds: number | null;
  departureSeconds: number | null;
  /** GTFS 0 (or omitted) = regular. 1 = not available; 2/3 require special arrangement. */
  pickupType?: number | null;
  dropOffType?: number | null;
}
export interface Calendar {
  serviceId: string;
  startDate: string;
  endDate: string;
  /** 0=Sunday ... 6=Saturday; boolean true means service operates. */
  weekdays: [boolean,boolean,boolean,boolean,boolean,boolean,boolean];
}
export interface CalendarException {serviceId: string; date: string; type: 1|2;}
export interface Timetable {
  feedVersion: string;
  timezone: 'Europe/Dublin';
  stops: Stop[];
  routes: Route[];
  trips: Trip[];
  stopTimes: StopTime[];
  calendars: Calendar[];
  exceptions: CalendarException[];
}
export interface WalkPath {
  /** Confirmed routable footway, NEVER a straight-line estimate. */
  durationSeconds: number;
  distanceMeters: number;
  geometry: Position[];
  provider: string;
  /** Geometry endpoints after street snapping; unrouted gaps remain unverified. */
  endpointSnapMeters?:{from:number;to:number};
  /** Sum of unrouted straight-line gaps added conservatively to duration and walking budget. */
  unverifiedConnector?:{meters:number;estimatedSeconds:number;estimateOnly:true};
  /** For UI: display the actual road start/end; never draw the gap as a walkable path. */
  snappedUserEndpoints?:{from?:Position;to?:Position};
  /** A >25 m household-to-road snap must be explicitly checked by the passenger. */
  requiresSnapConfirmation?:boolean;
}
export interface AccessWalk extends WalkPath { stopId: string; }
export interface TransferWalk extends WalkPath { fromStopId: string; toStopId: string; }
/** Precomputed paths from a pedestrian router, e.g., Valhalla pedestrian. */
export interface PedestrianPaths {
  origin: Position;
  destination: Position;
  access: AccessWalk[];
  egress: AccessWalk[];
  transfers: TransferWalk[];
  /** Optional, independently routed walk from origin directly to destination. */
  direct?: WalkPath;
  /** Aggregate resource limits only; never imply the entire network was searched. */
  coverage?:{
    planned:number;executed:number;skippedBudget:number;directSkippedBudget:boolean;candidateLimitReached:boolean;
    /** A09: Aggregate diagnostics only. Geographic proximity and GTFS topology do not prove routability. */
    candidateAudit?:{
      origins:{nearbyGeodesic:number;selectionLimit:number;selected:number;omittedByStopCap:number};
      destinations:{nearbyGeodesic:number;selectionLimit:number;selected:number;omittedByStopCap:number};
      transfers:{possibleGtfsPairs:number;pairSelectionLimit:number;selected:number;omittedBySelectionLimit:number;
        topologyHinted:number;selectedTopologyHinted:number};
      requestLimit:number;
      limitedBy:Array<'origin_stop_cap'|'destination_stop_cap'|'transfer_pair_cap'|'transfer_preselection_budget'>;
    };
  };
}
export interface WalkLeg { type:'walk'; from: Position; to: Position; durationSeconds:number;distanceMeters:number;geometry:Position[]; provider:string; purpose:'access'|'transfer'|'egress'|'direct'; endpointSnapMeters?:{from:number;to:number};unverifiedConnector?:{meters:number;estimatedSeconds:number;estimateOnly:true};snappedUserEndpoints?:{from?:Position;to?:Position};requiresSnapConfirmation?:boolean; }
export interface RideLeg {type:'ride'; tripId:string;routeId:string;routeName:string;mode:'bus'|'rail';headsign:string|null;boardStopId:string;alightStopId:string;/** Seconds relative to the requested local calendar date (not serviceDate). */
  boardAtSeconds:number;alightAtSeconds:number;
  /** GTFS seconds relative to serviceDate (may exceed 86400). Use with GTFS-RT start_date. */
  boardAtServiceSeconds:number;alightAtServiceSeconds:number;
  /** Calendar-day offset from serviceDate. 25:05 => 1, even if boardAtSeconds is 01:05. */
  boardDayOffset:number;alightDayOffset:number;
  serviceDate:string; }
export type Leg = WalkLeg | RideLeg;
export interface BoardingInstruction {
  stopId:string;stopCode:string|null;stopName:string;coordinate:Position;
  locationConfidence:Confidence;
  sideOfStreet:string|null;
  platform:string|null;
  notes:string|null;
  /** Cannot claim a correct sidewalk unless independently verified. */
  caveat:string|null;
}
export interface Journey {
  serviceDate:string;
  feedVersion:string;
  /** Request time, NOT the actual scheduled boarding time. */
  departureAtSeconds:number;
  /** Latest safe origin departure for first boarding, including access walk and
   * boarding buffer (service-day seconds). Walking-only: original search time.
   * Populated by planner >=0.9.3; optional for compatibility with older data. */
  latestLeaveAtSeconds?:number;
  arrivalAtSeconds:number;
  transfers:number;
  walkingMeters:number;
  /** Included in walkingMeters/time but not verified navigable or rendered as a route. */
  unverifiedConnectorMeters?:number;
  unverifiedConnectorSeconds?:number;
  requiresSnapConfirmation?:boolean;
  legs: Leg[];
  boardings:BoardingInstruction[];
  /** A scheduled itinerary, not a real-time promise. */
  predictionType:'scheduled'|'walking_estimate';
}
export interface PlanRequest {
  serviceDate:string;
  departAfterSeconds:number;
  maxTransfers?:number;
  limit?:number;
  minBoardingSeconds?:number;
  minTransferSeconds?:number;
  maxWalkingMeters?:number;
  rankBy?:'fastest'|'less_walking'|'fewest_transfers';
}
