import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { catalog, createScheduleReader, parseStopQuery, searchSchedules } from "../transport-api/journeys.ts";

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
const headers: Record<string, string> = { apikey: privateKey, 'Content-Type': 'application/json' };
if (privateKey.startsWith('eyJ')) headers.Authorization = `Bearer ${privateKey}`;
const snapshot = createScheduleReader(root, headers);
const answer = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function quota(): Promise<boolean> {
  // Fixed SHA-256 bucket matches the existing transport limiter's key format.
  const response = await fetch(root + '/rest/v1/rpc/consume_transport_api_rate_limit', { method: 'POST', headers, body: JSON.stringify({ p_key: 'a837fb1f25e22fefb7fc5b418a158c956445694ca5b805087f6522f219254668', p_limit: 30, p_window_seconds: 60 }), signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw Error('quota_unavailable');
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.allowed !== 'boolean') throw Error('invalid_quota');
  return rows[0].allowed;
}
Deno.serve(async (req: Request) => {
  // No browser CORS. Only the reviewed public key authorizes gateway reads.
  if (req.method !== 'GET') return answer({ error: 'method_not_allowed' }, 405);
  if (req.headers.get('origin')) return answer({ error: 'origin_not_allowed' }, 403);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(root) || !privateKey || !publicKey) return answer({ error: 'configuration_missing' }, 503);
  if (req.headers.get('apikey') !== publicKey) return answer({ error: 'unauthorized' }, 401);
  const p = new URL(req.url).searchParams;
  const action = p.get('action');
  if (p.getAll('action').length !== 1 || !['stops', 'journeys'].includes(action ?? '')) return answer({ error: 'unknown_action' }, 404);
  p.delete('action');
  const q = action === 'journeys' ? parseStopQuery(p) : null;
  if ((action === 'stops' && [...p.keys()].length) || (action === 'journeys' && !q)) return answer({ error: 'invalid_search' }, 400);
  try {
    if (!await quota()) return answer({ error: 'rate_limited' }, 429);
    const data = await snapshot();
    return answer(action === 'stops' ? catalog(data) : searchSchedules(data, q!));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const safe = ['unknown_stop', 'date_outside_feed', 'clock_change_unsupported', 'search_capacity_reached'].includes(code) ? code : 'schedules_unavailable';
    return answer({ error: safe }, ['unknown_stop', 'date_outside_feed'].includes(safe) ? 400 : 503);
  }
});
