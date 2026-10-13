import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { catalog, createScheduleReader, parseStopQuery, searchScheduledJourneys } from "../transport-api/journeys.ts";

// Isolated read-only schedule endpoint. Existing transport-api and private
// walking canary stay untouched. Keys come only from Supabase's runtime.
function namedKey(jsonName: string, names: string[]): string {
  try { const parsed = JSON.parse(Deno.env.get(jsonName) ?? '{}'); if (typeof parsed?.default === 'string') return parsed.default; } catch { /* named aliases */ }
  for (const name of names) { const value = Deno.env.get(name); if (value) return value; }
  return '';
}
const root = Deno.env.get('SUPABASE_URL') ?? '';
const privateKey = namedKey('SUPABASE_SECRET_KEYS', ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SB_SERVICE_ROLE_KEY']);
const publicKey = namedKey('SUPABASE_PUBLISHABLE_KEYS', ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY']);
const gatewaySecret = Deno.env.get('BALLINA_JOURNEY_GATEWAY_SECRET') ?? '';
const headers: Record<string, string> = { apikey: privateKey, 'Content-Type': 'application/json' };
if (privateKey.startsWith('eyJ')) headers.Authorization = `Bearer ${privateKey}`;
const snapshot = createScheduleReader(root, headers);
const answer = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function quota(): Promise<boolean> {
  // Fixed SHA-256 bucket matches the existing transport limiter's key format.
  const controller = new AbortController(), deadline = Date.now() + 3000;
  const timer = setTimeout(() => controller.abort(), 3000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(root + '/rest/v1/rpc/consume_transport_api_rate_limit', { method: 'POST', headers, body: JSON.stringify({ p_key: 'a837fb1f25e22fefb7fc5b418a158c956445694ca5b805087f6522f219254668', p_limit: 30, p_window_seconds: 60 }), signal: controller.signal, redirect: 'error' });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw Error('quota_unavailable'); }
    reader = response.body?.getReader(); if (!reader) throw Error('invalid_quota');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw Error('invalid_quota');
    const buffer = new Uint8Array(1024); let size = 0;
    while (true) {
      if (controller.signal.aborted || Date.now() >= deadline) throw Error('quota_timeout');
      const part = await reader.read();
      if (controller.signal.aborted || Date.now() >= deadline) throw Error('quota_timeout');
      if (part.done) break;
      if (size + part.value.length > buffer.length) throw Error('invalid_quota');
      buffer.set(part.value, size); size += part.value.length;
    }
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.allowed !== 'boolean') throw Error('invalid_quota');
    return rows[0].allowed;
  } catch (error) { cancel(); throw error; }
  finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); reader?.releaseLock(); }
}
Deno.serve(async (req: Request) => {
  // A publishable key is not private authorization. Both credentials must be
  // present; absent configuration never silently reopens anonymous access.
  if (req.method !== 'GET') return answer({ error: 'method_not_allowed' }, 405);
  if (req.headers.get('origin')) return answer({ error: 'origin_not_allowed' }, 403);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(root) || !privateKey || !publicKey || !/^[a-f0-9]{64}$/.test(gatewaySecret)) return answer({ error: 'configuration_missing' }, 503);
  const supplied = req.headers.get('x-ballina-gateway') ?? '';
  if (req.headers.get('apikey') !== publicKey || !/^[a-f0-9]{64}$/.test(supplied)) return answer({ error: 'unauthorized' }, 401);
  let different = 0;
  for (let i = 0; i < 64; i++) different |= supplied.charCodeAt(i) ^ gatewaySecret.charCodeAt(i);
  if (different !== 0) return answer({ error: 'unauthorized' }, 401);
  const p = new URL(req.url).searchParams;
  const action = p.get('action');
  if (p.getAll('action').length !== 1 || !['stops', 'journeys', 'admission'].includes(action ?? '')) return answer({ error: 'unknown_action' }, 404);
  p.delete('action');
  if (action === 'admission') {
    if ([...p.keys()].length) return answer({ error: 'invalid_search' }, 400);
    // Server-only protocol agreement, after BOTH credential checks. Does not
    // consume quota, read GTFS tables or claim database/provider readiness.
    return answer({ version: 1, source: 'journey-api', admission: 'gateway-secret-v1', quotaConsumed: false, snapshotRead: false });
  }
  const q = action === 'journeys' ? parseStopQuery(p) : null;
  if ((action === 'stops' && [...p.keys()].length) || (action === 'journeys' && !q)) return answer({ error: 'invalid_search' }, 400);
  try {
    if (!await quota()) return answer({ error: 'rate_limited' }, 429);
    const data = await snapshot();
    return answer(action === 'stops' ? catalog(data) : await searchScheduledJourneys(data, q!));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const safe = ['unknown_stop', 'date_outside_feed', 'clock_change_unsupported', 'search_capacity_reached'].includes(code) ? code : 'schedules_unavailable';
    return answer({ error: safe }, ['unknown_stop', 'date_outside_feed'].includes(safe) ? 400 : 503);
  }
});
