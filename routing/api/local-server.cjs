/** LOCAL ONLY. Bind localhost; do not use this Node bridge as a production gateway. */
const http=require('node:http');
const {Readable}=require('node:stream');
const {
 createRoutingApi,loadActiveGtfsSnapshot,createSnapshotCache,StadiaWalkingRouter,createSupabaseRateLimiter
}=require('../dist');
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,stadia=process.env.STADIA_API_KEY;
if(!url||!key||!stadia){console.error('Need SUPABASE_URL, SUPABASE_SECRET_KEY (server only), STADIA_API_KEY.');process.exit(2);}
const port=Number(process.env.PORT||8788);
if(!Number.isInteger(port)||port<1024||port>65535){console.error('Invalid port');process.exit(2)}
const handler=createRoutingApi({
 loadTimetable:createSnapshotCache(()=>loadActiveGtfsSnapshot({supabaseUrl:url,privateKey:key}),300000),
 router:new StadiaWalkingRouter(stadia),
 // socket remoteAddress is trusted for a LOCAL development gateway. Do not trust x-forwarded-for.
 clientIdentity:request=>new URL(request.url).hostname==='localhost'?'localhost':'local-request',
 consumeRateLimit:createSupabaseRateLimiter({supabaseUrl:url,privateKey:key}),
 allowedOrigins:['http://localhost:5173','http://127.0.0.1:5173'],
});
const server=http.createServer(async(req,res)=>{
 try{
  const target=new URL(req.url||'/',`http://localhost:${port}`);
  const headers=new Headers();
  for(const [k,v] of Object.entries(req.headers))if(v!=null)headers.set(k,Array.isArray(v)?v.join(','):v);
  const method=req.method||'GET';
  const webRequest=new Request(target,{method,headers,...(['GET','HEAD'].includes(method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
  const out=await handler(webRequest);
  res.writeHead(out.status,Object.fromEntries(out.headers.entries()));res.end(Buffer.from(await out.arrayBuffer()));
 }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"temporarily_unavailable"}');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local-only routing API http://127.0.0.1:${port}/health`));
