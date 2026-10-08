import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, unknown>;

function readNamedKey(jsonEnv: string, fallbackEnvs: string[]): string {
  const raw = Deno.env.get(jsonEnv);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.default === "string") return parsed.default;
    } catch {
      // Fall through.
    }
  }
  for (const name of fallbackEnvs) {
    const found = Deno.env.get(name);
    if (found) return found;
  }
  return "";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY = readNamedKey(
  "SUPABASE_PUBLISHABLE_KEYS",
  ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
);
const SECRET_KEY = readNamedKey(
  "SUPABASE_SECRET_KEYS",
  ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY"],
);

const ACTIONS: Record<string, string> = {
  config: "get_gtfs_import_config",
  start_run: "start_gtfs_import_run",
  update_run: "update_gtfs_import_run",
  previous_http_state: "get_gtfs_import_http_state",
  feed_state: "get_gtfs_feed_state",
  claim_lock: "claim_gtfs_import_worker",
  release_lock: "release_gtfs_import_worker",
  begin: "begin_gtfs_import",
  batch: "import_gtfs_batch",
  validate: "validate_gtfs_import",
  finalize: "finalize_gtfs_import",
  abort: "abort_gtfs_import",
};

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: SECRET_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (SECRET_KEY.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${SECRET_KEY}`;
  }
  return headers;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function checkRate(key: string, limit: number): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_transport_api_rate_limit`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({p_key: key,p_limit:limit,p_window_seconds:60}),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("import_rate_limiter_unavailable");
  const rows = await response.json() as Array<{allowed: boolean}>;
  if (!Array.isArray(rows) || rows.length < 1) throw new Error("import_rate_limiter_invalid");
  return rows[0].allowed;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
    return json({ error: "import_api_configuration_missing" }, 500);
  }
  if (req.headers.get("apikey") !== PUBLISHABLE_KEY) {
    return json({ error: "unauthorized" }, 401);
  }

  const bodyText = await req.text().catch(() => "");
  if (!bodyText || bodyText.length > 1_000_000) {
    return json({ error: "invalid_or_oversized_json" }, 400);
  }
  let body: Json | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Json;
  } catch { /* bad JSON */ }
  if (!body) return json({ error: "invalid_json" }, 400);

  const action = typeof body.action === "string" ? body.action : "";
  const rpcName = ACTIONS[action];
  if (!rpcName) return json({ error: "unknown_action" }, 404);

  const importToken = typeof body.import_token === "string" ? body.import_token : "";
  if (!importToken) return json({ error: "unauthorized" }, 401);

  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? body.params as Json
      : {};

  // Supplied params MUST NOT overwrite the token the caller presented.
  const rpcBody = { ...params, p_token: importToken };

  try {
    // Allow the normal importer (hundreds of batches), while limiting repeated
    // guesses and accidental floods before the privileged token-gated RPC.
    const globalRateKey = await sha256Hex("ballina-import-api-global");
    const apparentIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "edge-unknown";
    const perIpKey = await sha256Hex(`ballina-import-api|${apparentIp.slice(0,64)}`);
    if (!(await checkRate(globalRateKey,900)) || !(await checkRate(perIpKey,300))) {
      return json({ error: "rate_limited" }, 429);
    }
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(65_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      return json({
        error: "import_rpc_failed",
        rpc: rpcName,
        status: response.status,
        // Keep raw Postgres errors server-side, not in the unauthenticated response.
        // Even malformed tokens should never get hints about table structure.
      }, response.status >= 500 ? 502 : 400);
    }
    if (!raw) return json(null);
    try {
      return json(JSON.parse(raw));
    } catch {
      return json({ error: "invalid_rpc_response", rpc: rpcName }, 502);
    }
  } catch (error) {
    console.error("import_rpc_error",rpcName,error instanceof Error ? error.name : "unknown_error");
    return json({ error: "import_rpc_transport_error" }, 502);
  }
});
