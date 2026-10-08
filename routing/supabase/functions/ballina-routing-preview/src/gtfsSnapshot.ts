import {fromSupabaseTables,type GtfsTables} from './supabaseAdapter.ts';
import type {Timetable} from './types.ts';

/**
 * Server-only loader. Do not invoke this from a browser or expose credentials in a bundle.
 * Uses the Supabase PostgREST API and a private service key supplied by the hosting runtime.
 */
export interface SnapshotOptions {
  supabaseUrl: string;
  privateKey: string;
  fetcher?: typeof fetch;
  pageSize?: number;
  timeoutMs?: number;
  maxRowsPerTable?: number;
}

const TABLES = {
  stops: ['gtfs_stops','version,stop_id,stop_name,stop_lat,stop_lon,stop_code,stop_desc','stop_id.asc'],
  routes: ['gtfs_routes','version,route_id,route_short_name,route_long_name,route_type','route_id.asc'],
  trips: ['gtfs_trips','version,trip_id,route_id,service_id,trip_headsign','trip_id.asc'],
  stopTimes: ['gtfs_stop_times','version,trip_id,stop_id,stop_sequence,arrival_seconds,departure_seconds,pickup_type,drop_off_type','trip_id.asc,stop_sequence.asc'],
  calendars: ['gtfs_calendars','version,service_id,start_date,end_date,sunday,monday,tuesday,wednesday,thursday,friday,saturday','service_id.asc'],
  calendarDates: ['gtfs_calendar_dates','version,service_id,service_date,exception_type','service_id.asc,service_date.asc'],
} as const;

type Group = keyof typeof TABLES;

export async function loadActiveGtfsSnapshot(options:SnapshotOptions):Promise<Timetable> {
  const {supabaseUrl,privateKey}=options;
  if(!/^https:\/\//.test(supabaseUrl)||!privateKey || /\s/.test(privateKey))throw new Error('invalid_server_configuration');
  const pageSize=options.pageSize??1000;
  const maxRows=options.maxRowsPerTable??100_000;
  const timeoutMs=options.timeoutMs??20_000;
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isInteger(maxRows)||maxRows<pageSize||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60_000){
    throw new Error('invalid_snapshot_options');
  }
  const fetcher=options.fetcher??fetch;
  const root=supabaseUrl.replace(/\/$/,'')+'/rest/v1/';
  const headers:Record<string,string>={apikey:privateKey,Accept:'application/json'};
  if(privateKey.startsWith('eyJ'))headers.Authorization=`Bearer ${privateKey}`;
  async function requestPage(path:string,withCount=false):Promise<{rows:Record<string,unknown>[];total:number|null}> {
    // Count only first page; if no reliable count header, fall back to serial pagination.
    const url=root+path;
    const pageHeaders=withCount?{...headers,Prefer:'count=exact'}:headers;
    const response=await fetcher(url,{method:'GET',headers:pageHeaders,signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw new Error(`snapshot_http_${response.status}`);
    const rows:unknown=await response.json();
    if(!Array.isArray(rows)||!rows.every(x=>x!==null&&typeof x==='object'&&!Array.isArray(x)))throw new Error('invalid_snapshot_response');
    const header=withCount?response.headers.get('content-range'):null;
    const match=header?.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
    const total=match?Number(match[1]):null;
    if(total!==null&&(!Number.isSafeInteger(total)||total<0))throw new Error('invalid_snapshot_count');
    return {rows:rows as Record<string,unknown>[],total};
  }
  async function request(path:string):Promise<Record<string,unknown>[]> {return (await requestPage(path)).rows;}
  async function activeVersion():Promise<string> {
    const rows=await request('gtfs_feed_versions?select=version&active=eq.true&label=eq.nta-realtime&limit=2');
    if(rows.length!==1 || typeof rows[0]?.version!=='string'||!rows[0].version)throw new Error('active_feed_unavailable_or_ambiguous');
    return rows[0].version;
  }
  const version=await activeVersion();
  const tables={} as Pick<GtfsTables,'stops'|'routes'|'trips'|'stopTimes'|'calendars'|'calendarDates'>;
  async function loadGroup(group:Group):Promise<void> {
    const [table,select,order]=TABLES[group];
    const path=(offset:number)=>`${table}?select=${select}&version=eq.${encodeURIComponent(version)}&order=${order}&limit=${pageSize}&offset=${offset}`;
    const first=await requestPage(path(0),true);
    const all:Record<string,unknown>[]=[];
    const validate=(rows:Record<string,unknown>[])=>{
      if(rows.length>pageSize)throw new Error(`snapshot_page_overflow_${table}`);
      if(rows.some(r=>r.version!==version))throw new Error(`mixed_gtfs_version_${table}`);
      all.push(...rows);
      if(all.length>maxRows)throw new Error(`snapshot_limit_exceeded_${table}`);
    };
    validate(first.rows);
    if(first.total!==null){
      const total=first.total;
      if(total>maxRows)throw new Error(`snapshot_limit_exceeded_${table}`);
      if(first.rows.length!==Math.min(total,pageSize))throw new Error('snapshot_count_mismatch');
      // 3 outstanding pages per table, 2 table groups in parallel: <=6 total HTTP requests.
      for(let offset=pageSize;offset<total;offset+=3*pageSize){
        const offsets=Array.from({length:3},(_,i)=>offset+i*pageSize).filter(n=>n<total);
        const pages=await Promise.all(offsets.map(n=>request(path(n))));
        pages.forEach((rows,i)=>{
          if(rows.length!==Math.min(pageSize,total-offsets[i]!))throw new Error('snapshot_count_mismatch');
          validate(rows);
        });
      }
      if(all.length!==total)throw new Error('snapshot_count_mismatch');
    }else{
      // Intermediaries or older mocks without Content-Range: full, conservative fallback.
      for(let offset=pageSize;first.rows.length===pageSize;offset+=pageSize){
        if(offset>maxRows)throw new Error(`snapshot_limit_exceeded_${table}`);
        const rows=await request(path(offset));validate(rows);
        if(rows.length<pageSize)break;
      }
    }
    tables[group]=all;
  }
  const groups=Object.keys(TABLES) as Group[];
  for(let i=0;i<groups.length;i+=2)await Promise.all(groups.slice(i,i+2).map(loadGroup));
  // Detect a new feed activation while pages were being fetched, instead of mixing datasets.
  if(await activeVersion()!==version)throw new Error('active_feed_switched_during_snapshot');
  if(!tables.stops.length||!tables.routes.length||!tables.trips.length||!tables.stopTimes.length)throw new Error('incomplete_snapshot');
  const timetable=fromSupabaseTables({feedVersion:version,...tables});
  const knownStops=new Set(timetable.stops.map(s=>s.id));
  const knownRoutes=new Set(timetable.routes.map(r=>r.id));
  if(timetable.trips.some(t=>!knownRoutes.has(t.routeId)) || timetable.stopTimes.some(st=>!knownStops.has(st.stopId))){
    throw new Error('snapshot_broken_references');
  }
  return timetable;
}
