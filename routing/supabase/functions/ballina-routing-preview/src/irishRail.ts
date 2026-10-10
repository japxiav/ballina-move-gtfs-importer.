/** Iarnród Éireann station-board API adapter. Server-side only, never a timetable substitute.
 * Official API: https://api.irishrail.ie/realtime/realtime.asmx?op=getStationDataByNameXML
 * On the Athlone - Westport / Ballina corridor a value from this API may itself be scheduled.
 * Never associate an API Traincode to a GTFS trip_id without separately verified matching.
 */
export interface IrishRailStationCall {
  trainCode:string;
  stationName:string;
  origin:string;
  destination:string;
  trainDate:string|null;
  scheduledArrival:string|null;
  scheduledDeparture:string|null;
  expectedArrival:string|null;
  expectedDeparture:string|null;
  lateMinutes:number|null;
  dueInMinutes:number|null;
  status:string|null;
  lastLocation:string|null;
}
export interface IrishRailStationBoard {
  station:string;
  source:'irish_rail_station_api';
  fetchedAt:string;
  dataQuality:'official_api_may_show_schedule_only';
  matchedToGtfsTrips:false;
  services:IrishRailStationCall[];
}
export const IRISH_RAIL_COVERAGE_WARNING='The Irish Rail API may return scheduled rather than observed times on the Athlone–Westport/Ballina line. Train services are not automatically matched to GTFS trip IDs.';
const ENDPOINT='https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByNameXML';
const KNOWN_MAX_XML_BYTES=256_000;
function decode(value:string):string {
  // Reject XML entities not in the five predefined entities, preventing fake
  // nested expansion and mangled/untrusted passenger-facing text.
  // Check the RAW XML, not the decoded result: `&amp;Belfast` is valid XML
  // text denoting `&Belfast`, and must not be rejected after decoding.
  if(/&(?!(?:amp|lt|gt|quot|apos);)/.test(value))throw new Error('invalid_rail_xml_entity');
  const safe=value.replace(/&(amp|lt|gt|quot|apos);/g,(_whole,key:string)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]??'');
  return safe.trim().slice(0,160);
}
function field(raw:string,key:string):string|null {
  const pattern=new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${key}\\s*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${key}\\s*>`,'i');
  const found=pattern.exec(raw)?.[1];
  if(found===undefined||/<[^>]+>/.test(found))return null;
  const val=decode(found);
  return val||null;
}
function intField(raw:string,key:string):number|null {
  const value=field(raw,key);
  if(value==null||!/^\d{1,4}$/.test(value))return null;
  const n=Number(value);return Number.isSafeInteger(n)&&n<=1440?n:null;
}
function clockField(raw:string,key:string):string|null {
  const s=field(raw,key);
  return s&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)?s:null;
}
/** Verify the structural subset returned by Irish Rail before extracting records.
 * XML fields are leaves; only objStationData can be a direct child of the root.
 * This rejects malformed XML and ghost services hidden in unexpected wrappers.
 * It is intentionally NOT a general-purpose XML parser (no CDATA or DTDs). */
function validateStationBody(inner:string):void {
  const stack:string[]=[];
  const tags=/<([^<>]+)>/g;
  let position=0;
  function verifyText(text:string):void {
    if(text.includes('<'))throw new Error('invalid_rail_xml_response');
    if(stack.length<2){if(text.trim())throw new Error('invalid_rail_xml_response');}
    else decode(text); // validate predefined entities even in unknown leaf fields
  }
  for(let match; (match=tags.exec(inner))!==null; ){
    verifyText(inner.slice(position,match.index));
    const source=(match[1]??'').trim();
    const closing=/^\/([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*$/.exec(source);
    if(closing){
      if(stack.pop()!==closing[1])throw new Error('invalid_rail_xml_response');
    }else{
      const opening=/^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s+[^<>]*?)?\s*(\/)?$/.exec(source);
      if(!opening)throw new Error('invalid_rail_xml_response');
      const localName=opening[1]!.split(':').pop()!;
      if(stack.length===0 ? localName!=='objStationData' : stack.length!==1||localName==='objStationData')
        throw new Error('invalid_rail_xml_response');
      if(!opening[2])stack.push(opening[1]!);
      else if(stack.length===0)throw new Error('invalid_rail_xml_response');
    }
    position=tags.lastIndex;
  }
  verifyText(inner.slice(position));
  if(stack.length)throw new Error('invalid_rail_xml_response');
}
/** Strict parsing of this one provider's known response object, not a general-purpose XML parser. */
export function parseIrishRailStationXml(xml:string,station:string,fetchedAt:string):IrishRailStationBoard {
  if(xml.length>KNOWN_MAX_XML_BYTES||/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))throw new Error('invalid_rail_xml_response');
  // Official SOAP XML can contain comments. Never parse a train hidden inside one.
  const noComments=xml.replace(/<!--[\s\S]*?-->/g,'').replace(/^\uFEFF/,'').trim();
  if(noComments.includes('<!--')||noComments.includes('-->')||/<!\[CDATA\[/i.test(noComments))throw new Error('invalid_rail_xml_response');
  const root=/^(?:<\?xml\s[^<>]*\?>\s*)?<(?:[A-Za-z_][\w.-]*:)?ArrayOfObjStationData(?=[\s/>])[^<>]*?(\/?)>/.exec(noComments);
  if(!root)throw new Error('invalid_rail_xml_response');
  if(root[1]==='/'){
    if(noComments.slice(root[0].length).trim())throw new Error('invalid_rail_xml_response');
  }else{
    const close=/<\/(?:[A-Za-z_][\w.-]*:)?ArrayOfObjStationData\s*>\s*$/i.exec(noComments);
    if(!close)throw new Error('invalid_rail_xml_response');
    validateStationBody(noComments.slice(root[0].length,close.index));
  }
  const declared=(noComments.match(/<(?:[A-Za-z_][\w.-]*:)?objStationData(?=[\s/>])/gi)??[]).length;
  const closed=(noComments.match(/<\/(?:[A-Za-z_][\w.-]*:)?objStationData\s*>/gi)??[]).length;
  if(declared!==closed)throw new Error('invalid_rail_xml_response');
  const services:IrishRailStationCall[]=[];
  const re=/<(?:\w+:)?objStationData(?:\s+[^<>]*?)?\s*>([\s\S]*?)<\/(?:\w+:)?objStationData\s*>/gi;
  for(let match; (match=re.exec(noComments))!==null; ) {
    if(services.length>=120)throw new Error('rail_station_board_too_large');
    const data=match[1]??'';
    const trainCode=field(data,'Traincode')??'';
    const stationName=field(data,'Stationfullname')??'';
    if(!/^[A-Za-z0-9]{1,12}$/.test(trainCode)||!stationName)throw new Error('invalid_rail_train_record');
    services.push({trainCode,stationName,origin:field(data,'Origin')??'',destination:field(data,'Destination')??'',
      trainDate:field(data,'Traindate'),scheduledArrival:clockField(data,'Scharrival'),scheduledDeparture:clockField(data,'Schdepart'),
      expectedArrival:clockField(data,'Exparrival'),expectedDeparture:clockField(data,'Expdepart'),
      lateMinutes:intField(data,'Late'),dueInMinutes:intField(data,'Duein'),status:field(data,'Status'),lastLocation:field(data,'Lastlocation')});
  }
  if(services.length!==declared)throw new Error('invalid_rail_xml_response');
  return {station,source:'irish_rail_station_api',fetchedAt,dataQuality:'official_api_may_show_schedule_only',matchedToGtfsTrips:false,services};
}
export function createIrishRailStationClient(options:{
  fetcher?:typeof fetch;now?:()=>Date;timeoutMs?:number;cacheMs?:number;
}={}) {
  const fetcher=options.fetcher??fetch,now=options.now??(()=>new Date());
  const timeoutMs=Math.max(100,Math.min(10000,options.timeoutMs??5000));
  const cacheMs=Math.max(1000,Math.min(120000,options.cacheMs??45000));
  const cache=new Map<string,{expires:number;board:IrishRailStationBoard}>();
  // Deduplicate requests before the station response has entered the TTL cache.
  const pending=new Map<string,Promise<IrishRailStationBoard>>();
  async function readBounded(response:Response):Promise<string>{
    const declared=response.headers.get('content-length');
    if(declared&&Number(declared)>KNOWN_MAX_XML_BYTES)throw new Error('rail_upstream_response_too_large');
    if(!response.body)throw new Error('rail_upstream_empty_body');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
    try {
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        total+=value.byteLength;
        if(total>KNOWN_MAX_XML_BYTES){await reader.cancel().catch(()=>undefined);throw new Error('rail_upstream_response_too_large');}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
    const raw=new Uint8Array(total);let position=0;
    for(const chunk of chunks){raw.set(chunk,position);position+=chunk.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(raw);
  }
  return async function getStationBoard(station:string):Promise<IrishRailStationBoard> {
    if(!/^[A-Za-z][A-Za-z '-]{1,58}$/.test(station))throw new Error('invalid_rail_station');
    const key=station.toLowerCase();const existing=cache.get(key);
    if(existing&&existing.expires>now().getTime())return existing.board;
    const underway=pending.get(key);
    if(underway)return underway;
    const run=(async()=>{
      const controller=new AbortController();
      let timedOut=false;
      let timeout:ReturnType<typeof setTimeout>|undefined;
      const work=(async()=>{
        const response=await fetcher(`${ENDPOINT}?StationDesc=${encodeURIComponent(station)}`,{
          method:'GET',signal:controller.signal,headers:{Accept:'application/xml,text/xml'}});
        if(!response.ok)throw new Error('irish_rail_upstream_unavailable');
        const body=await readBounded(response);
        // A mock or nonstandard fetcher may ignore AbortSignal. No late result
        // may poison the station cache after the timeout was reported.
        if(timedOut)throw new Error('irish_rail_timeout');
        const board=parseIrishRailStationXml(body,station,now().toISOString());
        if(cache.size>100)cache.clear();
        cache.set(key,{expires:now().getTime()+cacheMs,board});
        return board;
      })();
      const deadline=new Promise<never>((_,reject)=>{
        timeout=setTimeout(()=>{
          timedOut=true;
          controller.abort();
          reject(new Error('irish_rail_timeout'));
        },timeoutMs);
      });
      try{return await Promise.race([work,deadline]);}
      finally{if(timeout)clearTimeout(timeout);}
    })();
    pending.set(key,run);
    try{return await run;}
    finally{if(pending.get(key)===run)pending.delete(key);}
  };
}
