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
function field(raw:ReadonlyMap<string,string>,key:string):string|null {
  const value=raw.get(key);
  if(value===undefined)return null;
  const text=decode(value);
  return text||null;
}
function intField(raw:ReadonlyMap<string,string>,key:string):number|null {
  const value=field(raw,key);
  if(value==null||!/^\d{1,4}$/.test(value))return null;
  const n=Number(value);return Number.isSafeInteger(n)&&n<=1440?n:null;
}
function clockField(raw:ReadonlyMap<string,string>,key:string):string|null {
  const s=field(raw,key);
  return s&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)?s:null;
}
/** Parser for the deliberately narrow Irish Rail station-board XML shape.
 * No DTD, CDATA, processing instructions (except an XML declaration), or mixed
 * XML content. QNames and attribute names are XML case-sensitive. Attributes
 * must be quoted and unique; malformed input is never treated as an empty board.
 * This is not a general-purpose XML parser.
 */
interface RailXmlTag { name:string; attrs:Map<string,string>; empty:boolean }
const XML_NAME='[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
const XML_NAME_EXACT=new RegExp(`^${XML_NAME}$`);
const XML_NAME_PREFIX=new RegExp(`^(${XML_NAME})`);
const XML_END_TAG=new RegExp(`^/(${XML_NAME})[ \t\r\n]*$`);
const XML_SPACE=/[ \t\r\n]/;
function parseXmlStartTag(source:string):RailXmlTag {
  const head=XML_NAME_PREFIX.exec(source);
  if(!head)throw new Error('invalid_rail_xml_response');
  const name=head[1]!;
  const attrs=new Map<string,string>();
  let i=name.length,empty=false;
  while(i<source.length){
    const spaceStart=i;
    while(i<source.length&&XML_SPACE.test(source[i]!))i++;
    if(source[i]==='/'&&i===source.length-1){empty=true;i++;break;}
    if(i===source.length)break;
    // XML requires whitespace between the element QName and each attribute.
    if(spaceStart===i)throw new Error('invalid_rail_xml_response');
    const match=XML_NAME_PREFIX.exec(source.slice(i));
    if(!match)throw new Error('invalid_rail_xml_response');
    const key=match[1]!;i+=key.length;
    while(i<source.length&&XML_SPACE.test(source[i]!))i++;
    if(source[i]!=='=')throw new Error('invalid_rail_xml_response');
    i++;
    while(i<source.length&&XML_SPACE.test(source[i]!))i++;
    const quote=source[i];
    if(quote!=="'"&&quote!=='"')throw new Error('invalid_rail_xml_response');
    i++;
    const start=i;
    while(i<source.length&&source[i]!==quote)i++;
    if(i===source.length)throw new Error('invalid_rail_xml_response');
    const value=source.slice(start,i++);
    if(value.includes('<')||attrs.has(key))throw new Error('invalid_rail_xml_response');
    // Attribute entities must be valid, too, not just passenger-visible fields.
    decode(value);
    attrs.set(key,value);
  }
  if(i!==source.length||!XML_NAME_EXACT.test(name))throw new Error('invalid_rail_xml_response');
  return {name,attrs,empty};
}
function xmlLocalName(qname:string):string{return qname.split(':').pop()!;}
interface RailXmlFrame {name:string;nameLocal:string;text:string;fields?:Map<string,string>}
function readStationXml(xml:string):Map<string,string>[] {
  const source=xml.replace(/^\uFEFF/,'').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,'');
  const stack:RailXmlFrame[]=[];
  const records:Map<string,string>[]=[];
  let i=0,rootSeen=false,rootClosed=false;
  function appendText(s:string):void {
    if(s.includes(']]>'))throw new Error('invalid_rail_xml_response');
    if(!stack.length){if(/[^ \t\r\n]/.test(s))throw new Error('invalid_rail_xml_response');return;}
    if(stack.length<3){if(/[^ \t\r\n]/.test(s))throw new Error('invalid_rail_xml_response');return;}
    decode(s); // rejects unknown entities in all leaves, including unknown fields
    stack[2]!.text+=s;
  }
  if(source.startsWith('<?xml')){
    const end=source.indexOf('?>');
    if(end<0)throw new Error('invalid_rail_xml_response');
    const declaration=source.slice(2,end);
    // Declaration attributes are pseudo-attributes and must also be quoted.
    const head=/^xml\s+/.exec(declaration);
    if(!head)throw new Error('invalid_rail_xml_response');
    parseXmlStartTag('xml '+declaration.slice(head[0].length));
    i=end+2;
  }
  while(i<source.length){
    const next=source.indexOf('<',i);
    if(next===-1){appendText(source.slice(i));break;}
    appendText(source.slice(i,next));
    if(source.startsWith('<!--',next)){
      const end=source.indexOf('-->',next+4);
      if(end===-1||source.slice(next+4,end).includes('--')||source.slice(next+4,end).endsWith('-'))
        throw new Error('invalid_rail_xml_response');
      i=end+3;continue;
    }
    if(source.startsWith('<!',next)||source.startsWith('<?',next))throw new Error('invalid_rail_xml_response');
    // Scan to the first > outside quoted attributes; > inside quoted values is legal XML.
    let end=next+1,quote:string|null=null;
    for(;end<source.length;end++){
      const ch=source[end]!;
      if(quote){if(ch===quote)quote=null;}
      else if(ch==='"'||ch==="'")quote=ch;
      else if(ch==='>')break;
      else if(ch==='<')throw new Error('invalid_rail_xml_response');
    }
    if(end>=source.length||quote)throw new Error('invalid_rail_xml_response');
    const raw=source.slice(next+1,end);
    if(raw.startsWith('/')){
      const ending=XML_END_TAG.exec(raw);
      if(!ending||stack.at(-1)?.name!==ending[1])throw new Error('invalid_rail_xml_response');
      const level=stack.length;
      const closed=stack.pop()!;
      if(level===3){
        const record=stack[1]!.fields!;
        if(record.has(closed.nameLocal))throw new Error('invalid_rail_xml_response');
        record.set(closed.nameLocal,closed.text);
      }else if(level===2){
        if(records.length>=120)throw new Error('rail_station_board_too_large');
        records.push(closed.fields!);
      }else if(level===1)rootClosed=true;
    }else{
      const tag=parseXmlStartTag(raw);
      const local=xmlLocalName(tag.name);
      const level=stack.length;
      if(rootClosed||level===0&&(rootSeen||local!=='ArrayOfObjStationData')||
         level===1&&local!=='objStationData'||level===2&&local==='objStationData'||level>=3)
        throw new Error('invalid_rail_xml_response');
      if(level===0)rootSeen=true;
      // Ensure namespaced QNames are not accepted with undeclared prefixes.
      const declared=new Set<string>();
      for(const frame of stack){
        const xmlns=(frame as RailXmlFrame & {prefixes?:Set<string>}).prefixes;
        if(xmlns)for(const prefix of xmlns)declared.add(prefix);
      }
      for(const key of tag.attrs.keys())if(key.startsWith('xmlns:'))declared.add(key.slice(6));
      if(tag.name.includes(':')&&!declared.has(tag.name.split(':')[0]!))throw new Error('invalid_rail_xml_response');
      for(const key of tag.attrs.keys())if(key.includes(':')&&!key.startsWith('xmlns:')&&!declared.has(key.split(':')[0]!))
        throw new Error('invalid_rail_xml_response');
      const frame:RailXmlFrame & {prefixes?:Set<string>}={name:tag.name,nameLocal:local,text:''};
      frame.prefixes=new Set([...tag.attrs.keys()].filter(k=>k.startsWith('xmlns:')).map(k=>k.slice(6)));
      if(level===1)frame.fields=new Map();
      if(tag.empty){
        if(level===1){
          if(records.length>=120)throw new Error('rail_station_board_too_large');
          records.push(new Map());
        }else if(level===2){
          const record=stack[1]!.fields!;
          if(record.has(local))throw new Error('invalid_rail_xml_response');
          record.set(local,'');
        }else rootClosed=true;
      }else stack.push(frame);
    }
    i=end+1;
  }
  if(!rootSeen||!rootClosed||stack.length)throw new Error('invalid_rail_xml_response');
  return records;
}
/** Reject code points forbidden by XML 1.0, including NUL, surrogates and noncharacters. */
function validateXmlCharacters(xml:string):void {
  for(const char of xml){
    const code=char.codePointAt(0)!;
    if(code===9||code===10||code===13||
       code>=0x20&&code<=0xD7FF||code>=0xE000&&code<=0xFFFD||
       code>=0x10000&&code<=0x10FFFF)continue;
    throw new Error('invalid_rail_xml_response');
  }
}
/** Strict parsing of this one provider's known response object, not a general-purpose XML parser. */
export function parseIrishRailStationXml(xml:string,station:string,fetchedAt:string):IrishRailStationBoard {
  if(xml.length>KNOWN_MAX_XML_BYTES)throw new Error('invalid_rail_xml_response');
  validateXmlCharacters(xml);
  const records=readStationXml(xml);
  const services:IrishRailStationCall[]=[];
  for(const data of records) {
    const trainCode=field(data,'Traincode')??'';
    const stationName=field(data,'Stationfullname')??'';
    if(!/^[A-Za-z0-9]{1,12}$/.test(trainCode)||!stationName)throw new Error('invalid_rail_train_record');
    services.push({trainCode,stationName,origin:field(data,'Origin')??'',destination:field(data,'Destination')??'',
      trainDate:field(data,'Traindate'),scheduledArrival:clockField(data,'Scharrival'),scheduledDeparture:clockField(data,'Schdepart'),
      expectedArrival:clockField(data,'Exparrival'),expectedDeparture:clockField(data,'Expdepart'),
      lateMinutes:intField(data,'Late'),dueInMinutes:intField(data,'Duein'),status:field(data,'Status'),lastLocation:field(data,'Lastlocation')});
  }
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
