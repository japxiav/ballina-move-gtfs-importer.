import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Ballina Move public API, v5. Server-side Supabase secret key only.
const SOURCE = {
  provider: "National Transport Authority (NTA)",
  source_url: "https://developer.nationaltransport.ie/",
  licence: "CC BY 4.0",
  disclaimer: "NTA data is provided as-is and may contain errors or inaccuracies.",
};

function readNamedKey(jsonEnv: string, fallbackEnvs: string[]): string {
  const raw = Deno.env.get(jsonEnv);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.default === "string") return parsed.default;
    } catch { /* use fallback environment variables */ }
  }
  for (const name of fallbackEnvs) {
    const found = Deno.env.get(name);
    if (found) return found;
  }
  return "";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_KEY = readNamedKey("SUPABASE_SECRET_KEYS", ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY"]);
const PUBLIC_KEY = readNamedKey("SUPABASE_PUBLISHABLE_KEYS", ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
const BALLINA_STOPS = ["8490B5550501", "8490B559701", "8490IR0076"];
const ACTIONS = new Set(["departures", "vehicles", "health"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200, cacheControl = "no-store", extraHeaders: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      ...extraHeaders,
    },
  });
}

function adminHeaders(): Record<string,string> {
  const headers: Record<string,string> = {apikey: SECRET_KEY, "Content-Type":"application/json"};
  if (SECRET_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SECRET_KEY}`;
  return headers;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function rpc<T>(name: string, body: Record<string,unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: adminHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.error("transport_api_rpc_error",name,response.status);
    throw new Error(`rpc_${name}_${response.status}`);
  }
  return await response.json() as T;
}

type RateResult = { allowed: boolean; retry_after_seconds: number; remaining: number };
async function limitRate(key: string, maxPerMinute: number): Promise<RateResult> {
  const rows = await rpc<RateResult[]>("consume_transport_api_rate_limit", {
    p_key: key,p_limit: maxPerMinute,p_window_seconds:60,
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error("rate_limit_response_invalid");
  return rows[0];
}

// Limit unknown-IP clients together rather than trusting arbitrary x-forwarded-for.
// IP header trust is still dependent on the upstream gateway; global limiter
// provides a second bound even if the client's apparent IP changes.
function clientIp(req: Request): string {
  const candidate = req.headers.get("cf-connecting-ip") || "edge-unknown";
  return candidate.length <= 64 ? candidate : "edge-unknown";
}

function freshRun(run: Record<string,unknown>|undefined, activeVersion: string|null, nowMs: number): boolean {
  if (!run || run.status !== "ok" || run.http_status !== 200) return false;
  const timestamp = Date.parse(String(run.completed_at ?? run.started_at ?? ""));
  const ageSeconds = (nowMs - timestamp) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < -60 || ageSeconds > 240) return false;
  // A successful HTTP call may return an upstream feed that stopped updating.
  const feedStamp = run.feed_timestamp ? Date.parse(String(run.feed_timestamp)) : NaN;
  if (!Number.isFinite(feedStamp) || (nowMs-feedStamp)/1000 > 300 || (nowMs-feedStamp)/1000 < -120) return false;
  const meta = (run.metadata && typeof run.metadata === "object") ? run.metadata as Record<string,unknown> : {};
  return !!activeVersion && meta.active_feed_version === activeVersion;
}

function publicRun(run: Record<string,unknown>) {
  const metadata = (run.metadata && typeof run.metadata === "object") ? run.metadata as Record<string,unknown> : {};
  return {
    channel: run.channel, status: run.status, started_at: run.started_at,
    completed_at: run.completed_at, feed_timestamp: run.feed_timestamp,
    http_status: run.http_status, error_code: run.error_code,
    metadata: {
      active_feed_version: metadata.active_feed_version ?? null,
      exact_trip_matches: metadata.exact_trip_matches ?? null,
      unmapped_trips: metadata.unmapped_trips ?? null,
      stop_predictions: metadata.stop_predictions ?? null,
      collector_version: metadata.collector_version ?? null,
    },
  };
}

async function selectRows(path: string): Promise<Record<string,unknown>[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: adminHeaders(), signal:AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`health_query_failed_${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error("health_invalid_response");
  return value as Record<string,unknown>[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});
  if (req.method !== "GET") return json({error:"method_not_allowed"},405);
  if (!SUPABASE_URL || !SECRET_KEY || !PUBLIC_KEY) return json({error:"api_configuration_missing"},500);
  if (req.headers.get("apikey") !== PUBLIC_KEY) return json({error:"unauthorized"},401);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "health";
  // Action whitelist BEFORE creating rate-limit keys prevents unbounded
  // database buckets for arbitrary action strings.
  if (!ACTIONS.has(action)) return json({error:"unknown_action"},404);
  try {
    const globalKey = await sha256Hex("transport-api|global");
    const globalRate = await limitRate(globalKey,300);
    if (!globalRate.allowed) return json({error:"rate_limited",retry_after_seconds:globalRate.retry_after_seconds},429,"no-store",{"Retry-After":String(Math.max(1,globalRate.retry_after_seconds))});
    const perIpKey = await sha256Hex(`transport-api|${action}|${clientIp(req)}`);
    const rate = await limitRate(perIpKey,action==="health" ? 30 : 90);
    if (!rate.allowed) return json({error:"rate_limited",retry_after_seconds:rate.retry_after_seconds},429,"no-store",{"Retry-After":String(Math.max(1,rate.retry_after_seconds))});

    if (action === "departures") {
      const requested = Number(url.searchParams.get("limit") ?? "40");
      const limit = Number.isFinite(requested) ? Math.max(1,Math.min(Math.trunc(requested),60)) : 40;
      const departures = await rpc<unknown[]>("get_stop_departures_v2",{
        p_stop_ids:BALLINA_STOPS,p_from:new Date().toISOString(),p_limit:limit,
      });
      return json({generated_at:new Date().toISOString(),hub:"ballina",stops:BALLINA_STOPS,departures,source:SOURCE},200,"public, max-age=10, s-maxage=20, stale-while-revalidate=40");
    }

    if (action === "vehicles") {
      const requestedAge = Number(url.searchParams.get("max_age") ?? "600");
      const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
      const maxAge = Number.isFinite(requestedAge) ? Math.max(60,Math.min(Math.trunc(requestedAge),900)) : 600;
      const limit = Number.isFinite(requestedLimit) ? Math.max(1,Math.min(Math.trunc(requestedLimit),150)) : 100;
      const vehicles = await rpc<unknown[]>("get_live_vehicles",{p_max_age_seconds:maxAge,p_limit:limit});
      return json({generated_at:new Date().toISOString(),vehicles,source:SOURCE},200,"public, max-age=5, s-maxage=15, stale-while-revalidate=30");
    }

    const [allRuns,feeds,states,imports] = await Promise.all([
      selectRows("collection_runs?select=channel,status,started_at,completed_at,feed_timestamp,http_status,error_code,metadata&order=started_at.desc&limit=12"),
      selectRows("gtfs_feed_versions?select=version,label,imported_at,feed_start_date,feed_end_date,metadata&active=eq.true&label=eq.nta-realtime&limit=1"),
      selectRows("collector_state?select=last_claimed_at,min_interval_seconds,collector_version,history_quality_cutoff&singleton=eq.true&limit=1"),
      selectRows("gtfs_import_runs?select=status,started_at,completed_at,version,error_code,active_after,metadata&order=started_at.desc&limit=1"),
    ]);
    const feed = feeds[0] ?? null;
    const meta = feed?.metadata && typeof feed.metadata === "object" ? feed.metadata as Record<string,unknown> : {};
    const activeVersion = feed && typeof feed.version === "string" ? feed.version : null;
    const collector = states[0] ?? {};
    const minInterval = Number(collector.min_interval_seconds ?? 61);
    const heartbeatLimitSeconds = Math.max(180,Math.ceil(minInterval*3));
    const nowMs=Date.now();
    const latestRuns = ["vehicle","trip_update"].map(channel=>allRuns.find(r=>r.channel===channel)).filter((x):x is Record<string,unknown>=>!!x);
    const healthy = latestRuns.length === 2 && latestRuns.every(r=>freshRun(r,activeVersion,nowMs));
    const importRun = imports[0] ?? {};
    const importMeta = importRun.metadata && typeof importRun.metadata === "object" ? importRun.metadata as Record<string,unknown> : {};
    const feedEnd = feed?.feed_end_date ? Date.parse(String(feed.feed_end_date)+"T23:59:59Z") : NaN;
    const daysUntilExpiry = Number.isFinite(feedEnd) ? Math.ceil((feedEnd-nowMs)/86_400_000) : null;
    const feedValid = daysUntilExpiry !== null && daysUntilExpiry >= 0;
    const status = healthy && feedValid ? "ok" : "degraded";
    const latestStamp = allRuns[0]?.started_at ? Date.parse(String(allRuns[0].started_at)) : NaN;
    const collectorAgeSeconds = Number.isFinite(latestStamp) ? Math.max(0,Math.floor((nowMs-latestStamp)/1000)) : null;
    return json({
      status, checked_at:new Date().toISOString(),
      collector:{healthy,age_seconds:collectorAgeSeconds,heartbeat_limit_seconds:heartbeatLimitSeconds,
        version:collector.collector_version ?? null,last_claimed_at:collector.last_claimed_at ?? null,
        history_quality_cutoff:collector.history_quality_cutoff ?? null,
        latest_runs:latestRuns.map(publicRun)},
      importer:{latest_status:importRun.status ?? "not_run_yet",started_at:importRun.started_at ?? null,
        completed_at:importRun.completed_at ?? null,candidate_version:importRun.version ?? null,
        active_after:importRun.active_after ?? null,error_code:importRun.error_code ?? null,dry_run:importMeta.dry_run ?? false},
      active_feed:feed ? {version:feed.version,label:feed.label,imported_at:feed.imported_at,
        feed_start_date:feed.feed_start_date,feed_end_date:feed.feed_end_date,
        schema_completeness:meta.schema_completeness ?? null,days_until_expiry:daysUntilExpiry} : null,
      source:SOURCE,
    },status==="ok"?200:503,"public, max-age=10, s-maxage=30, stale-while-revalidate=60");
  } catch (error) {
    console.error("transport_api_error",error instanceof Error ? error.message : "unknown_error");
    return json({error:"upstream_unavailable"},503);
  }
});
