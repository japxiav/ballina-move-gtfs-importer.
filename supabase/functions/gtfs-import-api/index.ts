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

  const body = await req.json().catch(() => null) as Json | null;
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

  const rpcBody = { p_token: importToken, ...params };

  try {
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
        detail: raw.slice(0, 2000),
      }, response.status >= 500 ? 502 : 400);
    }
    if (!raw) return json(null);
    try {
      return json(JSON.parse(raw));
    } catch {
      return json({ error: "invalid_rpc_response", rpc: rpcName }, 502);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    return json({ error: "import_rpc_transport_error", detail }, 502);
  }
});
