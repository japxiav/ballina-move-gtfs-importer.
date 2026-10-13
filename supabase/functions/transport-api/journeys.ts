/** Official stop-to-stop schedules. No pedestrian/provider calls or realtime promises.
 * Connections require the SAME stop_id and a two-minute buffer. Different bays,
 * sidewalks and platforms cannot be inferred from coordinates or similar names.
 */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
export type StopQuery = { from: string; to: string; date: string; time: string; modes: string; changes: string };
const GROUPS = {
  stops: ['gtfs_stops', 'version,stop_id,stop_name,stop_lat,stop_lon,stop_code'],
  routes: ['gtfs_routes', 'version,route_id,route_short_name,route_long_name,route_type'],
  trips: ['gtfs_trips', 'version,trip_id,route_id,service_id,trip_headsign'],
  times: ['gtfs_stop_times', 'version,trip_id,stop_id,stop_sequence,arrival_seconds,departure_seconds,pickup_type,drop_off_type'],
  calendars: ['gtfs_calendars', 'version,service_id,start_date,end_date,sunday,monday,tuesday,wednesday,thursday,friday,saturday'],
  exceptions: ['gtfs_calendar_dates', 'version,service_id,service_date,exception_type'],
} as const;
const clean = (v: unknown, limit = 160) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit);
const dateValid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const dayAt = (day: string, offset: number) => new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
export function localToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseStopQuery(params: URLSearchParams, now = new Date()): StopQuery | null {
  const keys = ['from', 'to', 'date', 'time', 'modes', 'changes'];
  if ([...params.keys()].some(k => !keys.includes(k)) || keys.some(k => params.getAll(k).length !== 1)) return null;
  const q = Object.fromEntries(keys.map(k => [k, params.get(k)!])) as StopQuery;
  if (![q.from, q.to].every(s => /^[A-Za-z0-9_ .:-]{1,120}$/.test(s)) || q.from === q.to || !dateValid(q.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(q.time) || !['bus', 'rail', 'bus,rail'].includes(q.modes) || !['0', '1', '2'].includes(q.changes)) return null;
  const offset = (Date.parse(q.date + 'T00:00:00Z') - Date.parse(localToday(now) + 'T00:00:00Z')) / 86400000;
  return offset >= 0 && offset <= 14 ? q : null;
}
export interface ScheduleSnapshot { version: string; start: string; end: string; loadedAt: string; tables: Tables }
export function catalog(snapshot: ScheduleSnapshot) {
  const supported = new Set(snapshot.tables.routes!.filter(r => r.route_type === 2 || r.route_type === 3).map(r => r.route_id));
  const trips = new Set(snapshot.tables.trips!.filter(r => supported.has(r.route_id)).map(r => r.trip_id));
  const used = new Set(snapshot.tables.times!.filter(r => trips.has(r.trip_id)).map(r => r.stop_id));
  const stops = snapshot.tables.stops!.filter(r => used.has(r.stop_id)).map(r => ({ id: clean(r.stop_id, 120), name: clean(r.stop_name), code: clean(r.stop_code, 50) || null, lat: r.stop_lat, lon: r.stop_lon }));
  if (!stops.length || stops.length > 1000 || new Set(stops.map(s => s.id)).size !== stops.length || stops.some(s => !s.id || !s.name || typeof s.lat !== 'number' || typeof s.lon !== 'number' || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || s.lat < 51 || s.lat > 55.7 || s.lon < -11 || s.lon > -5)) throw Error('invalid_stop_catalog');
  return { version: 1, source: 'nta_gtfs', feedVersion: snapshot.version, loadedAt: snapshot.loadedAt, validFrom: snapshot.start, validUntil: snapshot.end, timezone: 'Europe/Dublin', scope: 'stop_to_stop_same_stop_transfers', stops: stops.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}
function operates(calendars: Map<unknown, Row>, exceptions: Map<string, Row>, id: unknown, date: string): boolean {
  const exception = exceptions.get(JSON.stringify([id, date]));
  if (exception) return exception.exception_type === 1;
  const c = calendars.get(id);
  return !!c && date >= String(c.start_date).slice(0, 10) && date <= String(c.end_date).slice(0, 10) && c[['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(date + 'T00:00:00Z').getUTCDay()]!] === true;
}
const regular = (v: unknown) => v === 0 || v === null || v === undefined;
const seconds = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 72 * 3600;
export function searchSchedules(snapshot: ScheduleSnapshot, q: StopQuery) {
  const data = catalog(snapshot), stops = new Map(data.stops.map(s => [s.id, s]));
  if (!stops.has(q.from) || !stops.has(q.to)) throw Error('unknown_stop');
  if (q.date < snapshot.start || q.date > snapshot.end) throw Error('date_outside_feed');
  // This release fails explicitly at clock changes rather than inventing a UTC ETA.
  for (let offset = -2; offset <= 2; offset++) {
    const d = new Date(dayAt(q.date, offset) + 'T00:00:00Z'), m = d.getUTCMonth(), day = d.getUTCDate();
    if ((m === 2 || m === 9) && d.getUTCDay() === 0 && day + 7 > new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate()) throw Error('clock_change_unsupported');
  }
  const routes = new Map(snapshot.tables.routes!.map(r => [r.route_id, r]));
  if (routes.size !== snapshot.tables.routes!.length) throw Error('duplicate_route');
  const calendars = new Map<unknown, Row>(), exceptions = new Map<string, Row>();
  for (const r of snapshot.tables.calendars!) {
    if (calendars.has(r.service_id)) throw Error('ambiguous_calendar');
    calendars.set(r.service_id, r);
  }
  for (const r of snapshot.tables.exceptions!) {
    const key = JSON.stringify([r.service_id, String(r.service_date).slice(0, 10)]);
    if (exceptions.has(key)) throw Error('ambiguous_calendar_exception');
    exceptions.set(key, r);
  }
  const times = new Map<unknown, Row[]>();
  for (const row of snapshot.tables.times!) { const group = times.get(row.trip_id) ?? []; group.push(row); times.set(row.trip_id, group); }
  const depart = Number(q.time.slice(0, 2)) * 3600 + Number(q.time.slice(3)) * 60, horizon = depart + 36 * 3600;
  type Event = { key: string; trip: Row; route: Row; rows: Row[]; index: number; at: number; offset: number; date: string };
  type Ride = { tripId: string; route: string; mode: 'bus' | 'rail'; destination: string; from: typeof data.stops[number]; to: typeof data.stops[number]; boardAt: number; alightAt: number; serviceDate: string };
  type State = { stop: string; at: number; rides: Ride[]; used: string[] };
  const departures = new Map<string, Event[]>(), tripIds = new Set<unknown>();
  for (const trip of snapshot.tables.trips!) {
    if (tripIds.has(trip.trip_id)) throw Error('duplicate_trip');
    tripIds.add(trip.trip_id);
    const route = routes.get(trip.route_id), mode = route?.route_type === 2 ? 'rail' : route?.route_type === 3 ? 'bus' : null;
    if (!route || !mode || !q.modes.split(',').includes(mode)) continue;
    const rows = [...(times.get(trip.trip_id) ?? [])].sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    let previous = -1, sequence = -1;
    for (const r of rows) {
      const a = r.arrival_seconds, d = r.departure_seconds;
      if ((a != null && (!seconds(a) || a < previous)) || (d != null && (!seconds(d) || d < previous || (a != null && d < Number(a)))) || !Number.isInteger(r.stop_sequence) || Number(r.stop_sequence) <= sequence || !stops.has(String(r.stop_id))) throw Error('invalid_trip_schedule');
      if (seconds(a)) previous = a;
      if (seconds(d)) previous = d;
      sequence = Number(r.stop_sequence);
    }
    for (let offset = -2; offset <= 2; offset++) {
      const date = dayAt(q.date, offset);
      if (date < snapshot.start || date > snapshot.end || !operates(calendars, exceptions, trip.service_id, date)) continue;
      for (let index = 0; index < rows.length - 1; index++) {
        const row = rows[index]!, at = Number(row.departure_seconds) + offset * 86400;
        if (!seconds(row.departure_seconds) || !regular(row.pickup_type) || at < depart + 60 || at > horizon) continue;
        const id = String(row.stop_id), group = departures.get(id) ?? [];
        group.push({ key: `${date}:${trip.trip_id}`, trip, route, rows, index, at, offset, date }); departures.set(id, group);
      }
    }
  }
  for (const group of departures.values()) group.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  let frontier: State[] = [{ stop: q.from, at: depart, rides: [], used: [] }], work = 0, labels = 1;
  const found: Ride[][] = [], seen = new Set<string>();
  for (let round = 0; round <= Number(q.changes); round++) {
    const next: State[] = [];
    for (const state of frontier) {
      const earliest = state.at + (round === 0 ? 60 : 120), events = departures.get(state.stop) ?? [];
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid]!.at < earliest) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < events.length; i++) {
        const event = events[i]!;
        if (++work > 150000) throw Error('search_capacity_reached');
        if (state.used.includes(event.key)) continue;
        for (let k = event.index + 1; k < event.rows.length; k++) {
          if (++work > 150000) throw Error('search_capacity_reached');
          const row = event.rows[k]!, at = Number(row.arrival_seconds) + event.offset * 86400;
          if (!seconds(row.arrival_seconds) || at > horizon || !regular(row.drop_off_type)) continue;
          const ride: Ride = { tripId: clean(event.trip.trip_id, 120), route: clean(event.route.route_short_name) || clean(event.route.route_long_name), mode: event.route.route_type === 2 ? 'rail' : 'bus', destination: clean(event.trip.trip_headsign), from: stops.get(state.stop)!, to: stops.get(String(row.stop_id))!, boardAt: event.at, alightAt: at, serviceDate: event.date };
          const rides = [...state.rides, ride], identity = rides.map(r => `${r.serviceDate}:${r.tripId}:${r.from.id}:${r.to.id}`).join('|');
          if (seen.has(identity)) continue;
          seen.add(identity);
          if (++labels > 25000) throw Error('search_capacity_reached');
          if (String(row.stop_id) === q.to) { found.push(rides); continue; }
          if (round < Number(q.changes) && String(row.stop_id) !== q.from) next.push({ stop: String(row.stop_id), at, rides, used: [...state.used, event.key] });
        }
      }
    }
    frontier = next;
  }
  found.sort((a, b) => a[a.length - 1]!.alightAt - b[b.length - 1]!.alightAt || a.length - b.length || a[0]!.boardAt - b[0]!.boardAt);
  return { version: 1, source: 'nta_gtfs', feedVersion: snapshot.version, loadedAt: snapshot.loadedAt, serviceDate: q.date, timezone: 'Europe/Dublin', scope: data.scope,
    predictionType: 'scheduled', walkingIncluded: false, realTimeApplied: false, minBoardingSeconds: 60, minTransferSeconds: 120,
    journeys: found.slice(0, 6).map((rides, index) => ({ id: String(index + 1), departureAt: rides[0]!.boardAt, arrivalAt: rides[rides.length - 1]!.alightAt, changes: rides.length - 1, rides })) };
}
/** Uses only the hosting runtime's existing service key; never return raw tables. */
export function createScheduleReader(root: string, headers: Record<string, string>, fetcher: typeof fetch = fetch) {
  let cached: ScheduleSnapshot | null = null, pending: Promise<ScheduleSnapshot> | null = null;
  const read = async (path: string, deadline: number): Promise<Row[]> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('snapshot_timeout');
    const response = await fetcher(root + '/rest/v1/' + path, { headers, signal: AbortSignal.timeout(remaining), redirect: 'error' });
    if (!response.ok) throw Error('snapshot_unavailable');
    const reader = response.body?.getReader(); if (!reader) throw Error('snapshot_unavailable');
    const buffer = new Uint8Array(1048576); let size = 0;
    try {
      while (true) { const part = await reader.read(); if (Date.now() >= deadline) throw Error('snapshot_timeout'); if (part.done) break; if (size + part.value.length > buffer.length) throw Error('snapshot_too_large'); buffer.set(part.value, size); size += part.value.length; }
    } catch (e) { void reader.cancel().catch(() => {}); throw e; } finally { reader.releaseLock(); }
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw Error('invalid_snapshot');
    return rows;
  };
  return async (): Promise<ScheduleSnapshot> => {
    if (pending) return pending;
    pending = (async () => {
      const deadline = Date.now() + 15000;
      const active = await read('gtfs_feed_versions?select=version,feed_start_date,feed_end_date&active=eq.true&label=eq.nta-realtime&limit=2', deadline);
      const feed = active[0];
      if (active.length !== 1 || typeof feed?.version !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(feed.version)) throw Error('active_feed_unavailable');
      const version = feed.version, start = String(feed.feed_start_date), end = String(feed.feed_end_date);
      if (!dateValid(start) || !dateValid(end) || start > localToday() || end < localToday()) throw Error('expired_feed');
      if (cached && cached.version === version && Date.now() - Date.parse(cached.loadedAt) < 120000) return cached;
      const tables: Tables = {};
      const groups = Object.entries(GROUPS);
      for (let n = 0; n < groups.length; n += 2) await Promise.all(groups.slice(n, n + 2).map(async ([key, [table, fields]]) => {
        const order = key === 'times' ? 'trip_id.asc,stop_sequence.asc' : key === 'exceptions' ? 'service_id.asc,service_date.asc' : fields.split(',')[1] + '.asc';
        const all: Row[] = [];
        for (let offset = 0; ; offset += 1000) {
          const rows = await read(`${table}?select=${fields}&version=eq.${encodeURIComponent(version)}&order=${order}&limit=1000&offset=${offset}`, deadline);
          if (rows.length > 1000 || rows.some(r => r.version !== version) || all.length + rows.length > (key === 'times' ? 100000 : 10000)) throw Error('invalid_snapshot');
          all.push(...rows); if (rows.length < 1000) break;
        }
        tables[key] = all;
      }));
      const after = await read('gtfs_feed_versions?select=version&active=eq.true&label=eq.nta-realtime&limit=2', deadline);
      if (after.length !== 1 || after[0]?.version !== version || !tables.trips?.length || !tables.times?.length) throw Error('snapshot_changed');
      const snapshot = { version, start, end, tables, loadedAt: new Date().toISOString() }; catalog(snapshot); cached = snapshot; return snapshot;
    })().finally(() => { pending = null; });
    return pending;
  };
}
