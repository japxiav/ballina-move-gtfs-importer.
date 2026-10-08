/** Supabase's existing atomic rate-limit RPC, used from the trusted backend only. */
export interface SupabaseLimiterOptions {
  supabaseUrl:string;
  privateKey:string;
  fetcher?:typeof fetch;
  timeoutMs?:number;
}
export function createSupabaseRateLimiter(options:SupabaseLimiterOptions){
  const {supabaseUrl,privateKey}=options;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)||!privateKey||/\s/.test(privateKey)) {
    throw new Error('invalid_rate_limiter_configuration');
  }
  const fetcher=options.fetcher??fetch;
  const timeout=options.timeoutMs??6000;
  if(!Number.isInteger(timeout)||timeout<100||timeout>20000)throw new Error('invalid_rate_limiter_timeout');
  const endpoint=supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/consume_transport_api_rate_limit';
  const headers:Record<string,string>={'Content-Type':'application/json',apikey:privateKey};
  if(privateKey.startsWith('eyJ'))headers.Authorization=`Bearer ${privateKey}`;
  return async(bucket:string,limit:number,windowSeconds:number):Promise<boolean>=>{
    if(!bucket||bucket.length>500||!Number.isInteger(limit)||limit<1||limit>1000||![60,3600].includes(windowSeconds)){
      throw new Error('invalid_rate_limit_args');
    }
    // Do not store literal remote IP in the database rate-limit key.
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ballina-routing-v1|'+bucket));
    const key=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
    const response=await fetcher(endpoint,{
      method:'POST',headers,
      body:JSON.stringify({p_key:key,p_limit:limit,p_window_seconds:windowSeconds}),
      signal:AbortSignal.timeout(timeout),
    });
    if(!response.ok)throw new Error('rate_limiter_unavailable');
    const result:unknown=await response.json();
    if(!Array.isArray(result)||result.length!==1||!result[0]||typeof result[0]!=='object'||typeof result[0].allowed!=='boolean'){
      throw new Error('invalid_rate_limiter_response');
    }
    return result[0].allowed;
  };
}
