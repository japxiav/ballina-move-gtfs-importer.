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
// A published identifier must be the exact source reference, never a truncated
// alias. These are public-protocol bounds, not a claim about all GTFS feeds.
const publicIdentifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_ .:-]{1,120}$/.test(v);
const dateValid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const dayAt = (day: string, offset: number) => new Date(Date.parse(day + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const civilFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Modern Ireland uses offsets 0/+1h. Round-trip both possibilities: never
 * guess a missing spring hour or either occurrence of an autumn fold. */
export function dublinInstant(date: string, time: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const candidates = [wall, wall - 3600000].filter(epoch => {
    const parts = civilFormatter.formatToParts(epoch), get = (type: string) => parts.find(p => p.type === type)!.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}` === `${date}T${time}`;
  });
  if (candidates.length !== 1) throw Error('clock_change_unsupported');
  return candidates[0]!;
}
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
  const covered = snapshot.tables.stops!.filter(r => used.has(r.stop_id));
  if (covered.some(r => !publicIdentifier(r.stop_id))) throw Error('unsupported_schedule_identifier');
  const stops = covered.map(r => ({ id: r.stop_id as string, name: clean(r.stop_name), code: clean(r.stop_code, 50) || null, lat: r.stop_lat, lon: r.stop_lon }));
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
type Ride = { tripId: string; routeId: string; route: string; mode: 'bus' | 'rail'; destination: string; from: ReturnType<typeof catalog>['stops'][number]; to: ReturnType<typeof catalog>['stops'][number]; boardAt: number; alightAt: number; boardSequence: number; alightSequence: number; serviceDate: string };
// Names and presentation text do not identify a service. JSON tuples preserve
// boundaries even when an official ID contains ':' or other separators.
const operationalKey = (rides: Ride[]) => JSON.stringify(rides.map(r => [r.serviceDate, r.tripId, r.routeId, r.mode, r.from.id, r.to.id, r.boardSequence, r.alightSequence, r.boardAt, r.alightAt]));
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function searchSchedules(snapshot: ScheduleSnapshot, q: StopQuery) {
  const data = catalog(snapshot), stops = new Map(data.stops.map(s => [s.id, s]));
  if (!stops.has(q.from) || !stops.has(q.to)) throw Error('unknown_stop');
  if (q.date < snapshot.start || q.date > snapshot.end) throw Error('date_outside_feed');
  const reference = dublinInstant(q.date, '00:00'), requested = dublinInstant(q.date, q.time);
  const routes = new Map(snapshot.tables.routes!.map(r => [r.route_id, r]));
  if (snapshot.tables.routes!.some(r => !publicIdentifier(r.route_id))) throw Error('unsupported_schedule_identifier');
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
  const depart = (requested - reference) / 1000, horizon = depart + 36 * 3600;
  type TripDetails = { tripId: string; routeId: string; routeLabel: string; destination: string; mode: 'bus' | 'rail' };
  type Event = { key: string; details: TripDetails; rows: Row[]; index: number; at: number; offset: number; date: string };
  type State = { stop: string; at: number; rides: Ride[]; used: string[] };
  const departures = new Map<string, Event[]>(), terminalDepartures = new Map<string, Event[]>(), tripIds = new Set<unknown>();
  const eligibleTrips: Row[][] = [];
  const destinationRows = new Map<unknown, number[]>();
  // Query-local reuse only: a version string does not guarantee that two
  // snapshots (or a mutable offline fixture) contain identical rows.
  // GTFS seconds start at local noon minus twelve ELAPSED hours, matching
  // get_stop_departures_v2. This origin is not wall-clock midnight on DST days.
  const days = [-3, -2, -1, 0, 1, 2].map(day => {
    const date = dayAt(q.date, day);
    return { date, offset: (dublinInstant(date, '12:00') - 12 * 3600000 - reference) / 1000 };
  });
  const modes = new Set(q.modes.split(','));
  const activeServices = new Map<unknown, boolean[]>();
  for (const trip of snapshot.tables.trips!) {
    if (!publicIdentifier(trip.trip_id)) throw Error('unsupported_schedule_identifier');
    if (tripIds.has(trip.trip_id)) throw Error('duplicate_trip');
    tripIds.add(trip.trip_id);
    const route = routes.get(trip.route_id), mode = route?.route_type === 2 ? 'rail' : route?.route_type === 3 ? 'bus' : null;
    if (!route || !mode || !modes.has(mode)) continue;
    const tripId = trip.trip_id, routeId = clean(route.route_id, 120);
    const routeLabel = clean(route.route_short_name) || clean(route.route_long_name), destination = clean(trip.trip_headsign);
    // These immutable presentation/identity fields belong to one trip, not
    // every boarding event. Share their reference within this query only.
    const details: TripDetails = { tripId, routeId, routeLabel, destination, mode };
    const rows = [...(times.get(trip.trip_id) ?? [])].sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    let previous = -1, sequence = -1;
    for (const r of rows) {
      const a = r.arrival_seconds, d = r.departure_seconds;
      if ((a != null && (!seconds(a) || a < previous)) || (d != null && (!seconds(d) || d < previous || (a != null && d < Number(a)))) || !Number.isInteger(r.stop_sequence) || Number(r.stop_sequence) <= sequence || !stops.has(String(r.stop_id))) throw Error('invalid_trip_schedule');
      if (seconds(a)) previous = a;
      if (seconds(d)) previous = d;
      sequence = Number(r.stop_sequence);
    }
    const ends = rows.map((r, i) => r.stop_id === q.to && regular(r.drop_off_type) && seconds(r.arrival_seconds) ? i : -1).filter(i => i >= 0);
    destinationRows.set(trip.trip_id, ends);
    let eligible = false;
    let serviceDays = activeServices.get(trip.service_id);
    if (!serviceDays) {
      serviceDays = days.map(({ date }) => date >= snapshot.start && date <= snapshot.end && operates(calendars, exceptions, trip.service_id, date));
      activeServices.set(trip.service_id, serviceDays);
    }
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const { offset, date } = days[dayIndex]!;
      if (!serviceDays[dayIndex]) continue;
      for (let index = 0; index < rows.length - 1; index++) {
        const row = rows[index]!, at = Number(row.departure_seconds) + offset;
        if (!seconds(row.departure_seconds) || !regular(row.pickup_type) || at < depart + 60 || at > horizon) continue;
        const id = String(row.stop_id), group = departures.get(id) ?? [];
        const event = { key: `${date}:${trip.trip_id}`, details, rows, index, at, offset, date };
        group.push(event); departures.set(id, group); eligible = true;
        if (ends.some(end => end > index)) { const final = terminalDepartures.get(id) ?? []; final.push(event); terminalDepartures.set(id, final); }
      }
    }
    if (eligible) eligibleTrips.push(rows);
  }
  for (const map of [departures, terminalDepartures]) for (const group of map.values()) group.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  // Optimistic GTFS topology only: proves an impossible continuation may be
  // skipped, never that a connection is timed, walkable or on the correct bay.
  const reachable: Set<string>[] = [new Set([q.to])];
  for (let remaining = 1; remaining <= Number(q.changes); remaining++) {
    const previous = reachable[remaining - 1]!, current = new Set(previous);
    for (const rows of eligibleTrips) {
      let canAlight = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (canAlight && regular(row.pickup_type) && seconds(row.departure_seconds)) current.add(String(row.stop_id));
        if (previous.has(String(row.stop_id)) && regular(row.drop_off_type) && seconds(row.arrival_seconds)) canAlight = true;
      }
    }
    reachable.push(current);
  }
  let frontier: State[] = [{ stop: q.from, at: depart, rides: [], used: [] }], work = 0, labels = 1;
  const found: { rides: Ride[]; key: string }[] = [], seen = new Set<string>();
  for (let round = 0; round <= Number(q.changes); round++) {
    const next: State[] = [];
    for (const state of frontier) {
      const finalRound = round === Number(q.changes);
      const earliest = state.at + (round === 0 ? 60 : 120), events = (finalRound ? terminalDepartures : departures).get(state.stop) ?? [];
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid]!.at < earliest) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < events.length; i++) {
        const event = events[i]!;
        if (++work > 150000) throw Error('search_capacity_reached');
        if (state.used.includes(event.key)) continue;
        const alights = finalRound ? destinationRows.get(event.details.tripId)! : null;
        // Visit exactly the same indices in the same order, with the same work
        // accounting, without allocating a whole index array per event/state.
        for (let cursor = alights ? 0 : event.index + 1; cursor < (alights ? alights.length : event.rows.length); cursor++) {
          const k = alights ? alights[cursor]! : cursor;
          if (k <= event.index) continue;
          if (++work > 150000) throw Error('search_capacity_reached');
          const row = event.rows[k]!, at = Number(row.arrival_seconds) + event.offset;
          if (!seconds(row.arrival_seconds) || at > horizon || !regular(row.drop_off_type)) continue;
          if (!reachable[Number(q.changes) - round]!.has(String(row.stop_id))) continue;
          const ride: Ride = { tripId: event.details.tripId, routeId: event.details.routeId, route: event.details.routeLabel, mode: event.details.mode, destination: event.details.destination, from: stops.get(state.stop)!, to: stops.get(String(row.stop_id))!, boardAt: event.at, alightAt: at, boardSequence: Number(event.rows[event.index]!.stop_sequence), alightSequence: Number(row.stop_sequence), serviceDate: event.date };
          const rides = [...state.rides, ride], identity = operationalKey(rides);
          if (seen.has(identity)) continue;
          seen.add(identity);
          if (++labels > 25000) throw Error('search_capacity_reached');
          if (String(row.stop_id) === q.to) { found.push({ rides, key: identity }); continue; }
          if (round < Number(q.changes) && String(row.stop_id) !== q.from) next.push({ stop: String(row.stop_id), at, rides, used: [...state.used, event.key] });
        }
      }
    }
    frontier = next;
  }
  // Completed journeys only. Never prune intermediate histories or pretend
  // unknown walking/platform risk is zero. Equal metrics with different stop
  // sequences remain distinct. Sort plus three skyline slots avoids O(N²).
  const candidates = found;
  candidates.sort((a, b) => a.rides.at(-1)!.alightAt - b.rides.at(-1)!.alightAt || a.rides.length - b.rides.length || b.rides[0]!.boardAt - a.rides[0]!.boardAt || lexical(a.key, b.key));
  const best: ({ departure: number; arrival: number } | undefined)[] = [];
  const selected: Ride[][] = [];
  for (const { rides } of candidates) {
    const changes = rides.length - 1, departure = rides[0]!.boardAt, arrival = rides.at(-1)!.alightAt;
    let dominated = false;
    for (let k = 0; k <= changes; k++) {
      const earlier = best[k];
      if (earlier && earlier.departure >= departure && (earlier.arrival < arrival || earlier.departure > departure || k < changes)) { dominated = true; break; }
    }
    if (dominated) continue;
    if (!best[changes] || departure > best[changes]!.departure) best[changes] = { departure, arrival };
    if (selected.length < 6) selected.push(rides);
  }
  return { version: 2, referenceAt: new Date(reference).toISOString(), source: 'nta_gtfs', feedVersion: snapshot.version, loadedAt: snapshot.loadedAt, serviceDate: q.date, timezone: 'Europe/Dublin', scope: data.scope,
    predictionType: 'scheduled', walkingIncluded: false, realTimeApplied: false, minBoardingSeconds: 60, minTransferSeconds: 120,
    journeys: selected.map((rides, index) => ({ id: String(index + 1), departureAt: rides[0]!.boardAt, arrivalAt: rides[rides.length - 1]!.alightAt, changes: rides.length - 1, rides })) };
}
/** Public IDs hash operational identity, not list position. Native WebCrypto is
 * already supplied by the Edge runtime; six bounded digests require no network.
 * The synchronous solver remains usable by offline correctness/CPU oracles.
 */
export async function searchScheduledJourneys(snapshot: ScheduleSnapshot, q: StopQuery) {
  const result = searchSchedules(snapshot, q);
  const journeys = await Promise.all(result.journeys.map(async journey => {
    const identity = JSON.stringify(['ballina-scheduled-v1', snapshot.version, q.date, operationalKey(journey.rides)]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const id = 'j-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    return { ...journey, id };
  }));
  if (new Set(journeys.map(j => j.id)).size !== journeys.length) throw Error('ambiguous_journey_identity');
  return { ...result, journeys };
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
