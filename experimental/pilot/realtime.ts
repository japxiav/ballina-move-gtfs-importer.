/** Prepared server-side matching; not wired to public scheduled search. */
export interface ScheduledIdentity {
  feedVersion: string; queryDate?: string; serviceDate: string; tripId: string; routeId?: string; mode: 'bus' | 'rail';
  boardSequence?: number; alightSequence?: number; from: { id: string }; to: { id: string };
  boardAt: number; alightAt: number;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_ .:-]{1,120}$/.test(v);
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function stamp(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
}
type Update = {
  source: 'nta_gtfs_rt'; feedVersion: string; serviceDate: string; tripId: string; routeId: string; mode: 'bus' | 'rail';
  kind: 'departure' | 'arrival' | 'cancelled' | 'vehicle'; observedAt: string | null;
  stopId?: string; stopSequence?: number; expectedAt?: string; vehicleId?: string; lat?: number; lon?: number;
};
function validUpdate(v: unknown): v is Update {
  if (!object(v) || v.source !== 'nta_gtfs_rt' || !id(v.feedVersion) || !day(v.serviceDate) || !id(v.tripId) || !id(v.routeId) || typeof v.mode !== 'string' || !['bus', 'rail'].includes(v.mode) || typeof v.kind !== 'string' || !['departure', 'arrival', 'cancelled', 'vehicle'].includes(v.kind) || v.observedAt !== null && !stamp(v.observedAt)) return false;
  if (v.kind === 'cancelled') return v.expectedAt === undefined && v.lat === undefined && v.lon === undefined && v.stopId === undefined && v.stopSequence === undefined;
  if (v.kind === 'vehicle') return id(v.vehicleId) && typeof v.lat === 'number' && typeof v.lon === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.lat >= 51 && v.lat <= 55.7 && v.lon >= -11 && v.lon <= -5 && v.expectedAt === undefined;
  return id(v.stopId) && typeof v.stopSequence === 'number' && Number.isInteger(v.stopSequence) && v.stopSequence >= 0 && stamp(v.expectedAt) && v.lat === undefined && v.lon === undefined;
}
const canonical = (value: string) => new Date(value).toISOString().replace(/\.000Z$/, 'Z');
function scheduleClock(ride: ScheduledIdentity) {
  // boardAt/alightAt are relative to the QUERY date, not necessarily the
  // trip's service date (previous-day trips can board after midnight).
  if (!day(ride.queryDate)) return null;
  const start = Date.parse(ride.queryDate + 'T00:00:00Z');
  for (let offset = -2; offset <= 2; offset++) {
    const date = new Date(start + offset * 86400000), month = date.getUTCMonth();
    if ((month === 2 || month === 9) && date.getUTCDay() === 0 && date.getUTCDate() + 7 > new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate()) return null;
  }
  const noon = start + 12 * 3600000;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(noon);
  const get = (key: string) => Number(parts.find(p => p.type === key)!.value);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const midnight = start - (localAsUtc - noon);
  return { departure: midnight + ride.boardAt * 1000, arrival: midnight + ride.alightAt * 1000 };
}

export function assessRideRealtime(ride: ScheduledIdentity, raw: unknown, options: { now: number; sourceAvailable: boolean }) {
  if (!Number.isFinite(options.now) || !id(ride.feedVersion) || !day(ride.serviceDate) || !id(ride.tripId) || !['bus', 'rail'].includes(ride.mode) || !id(ride.from.id) || !id(ride.to.id) || !Number.isInteger(ride.boardAt) || ride.boardAt < 0 || !Number.isInteger(ride.alightAt) || ride.alightAt < ride.boardAt) throw Error('invalid_scheduled_identity');
  const base = { scheduledBoardAt: ride.boardAt, scheduledAlightAt: ride.alightAt,
    publicItineraryRealtimeApplied: false as const, matchedVehicle: null as { id: string; lat: number; lon: number; observedAt: string } | null,
    predictedDepartureAt: null as string | null, predictedArrivalAt: null as string | null,
    cancellationConfirmed: false, observationTimes: [] as string[] };
  if (!options.sourceAvailable) return { ...base, status: 'unavailable' as const, reason: 'source_unavailable' };
  if (!id(ride.routeId) || !Number.isInteger(ride.boardSequence) || !Number.isInteger(ride.alightSequence) || ride.boardSequence! < 0 || ride.alightSequence! <= ride.boardSequence!) return { ...base, status: 'unmatched' as const, reason: 'scheduled_operational_identity_incomplete' };
  if (!Array.isArray(raw) || raw.length > 256) return { ...base, status: 'uncertain' as const, reason: 'invalid_realtime_batch' };
  // A partial/unproven source projection cannot be promoted by name, point
  // proximity, ingestion time, train code, or a missing feed namespace.
  if (!raw.every(validUpdate)) return { ...base, status: 'uncertain' as const, reason: 'unproven_realtime_identity_or_schema' };
  const matching = raw.filter(v => v.feedVersion === ride.feedVersion && v.serviceDate === ride.serviceDate && v.tripId === ride.tripId && v.routeId === ride.routeId && v.mode === ride.mode && (v.kind === 'cancelled' || v.kind === 'vehicle' || v.kind === 'departure' && v.stopId === ride.from.id && v.stopSequence === ride.boardSequence || v.kind === 'arrival' && v.stopId === ride.to.id && v.stopSequence === ride.alightSequence));
  if (!matching.length) return { ...base, status: 'unmatched' as const, reason: 'no_exact_trip_instance_match' };
  const fresh = matching.filter(v => v.observedAt !== null && (options.now - Date.parse(v.observedAt)) / 1000 >= -15 && (options.now - Date.parse(v.observedAt)) / 1000 <= 180);
  if (!fresh.length) return { ...base, status: 'uncertain' as const, reason: 'missing_stale_or_future_observation' };
  // Missing/old cancellation evidence remains explicitly unconfirmed even if
  // a separate fresh vehicle report exists. Retrieval never renews its age.
  if (matching.some(v => v.kind === 'cancelled' && !fresh.includes(v))) return { ...base, status: 'uncertain' as const, reason: 'cancellation_observation_unconfirmed' };
  const cancellations = fresh.filter(v => v.kind === 'cancelled'), departures = fresh.filter(v => v.kind === 'departure'), arrivals = fresh.filter(v => v.kind === 'arrival'), vehicles = fresh.filter(v => v.kind === 'vehicle');
  if ([...departures, ...arrivals].some(v => Date.parse(v.expectedAt!) < options.now - 120000 || Date.parse(v.expectedAt!) > options.now + 36 * 3600000)) return { ...base, status: 'uncertain' as const, reason: 'prediction_outside_observation_window' };
  if (cancellations.length && (departures.length || arrivals.length)) return { ...base, status: 'uncertain' as const, reason: 'contradictory_cancelled_and_predicted' };
  // Do not arbitrarily select between conflicting simultaneous candidates.
  if (new Set(departures.map(v => Date.parse(v.expectedAt!))).size > 1 || new Set(arrivals.map(v => Date.parse(v.expectedAt!))).size > 1 || new Set(vehicles.map(v => JSON.stringify([v.vehicleId, v.lat, v.lon]))).size > 1) return { ...base, status: 'uncertain' as const, reason: 'ambiguous_realtime_match' };
  const departure = departures[0]?.expectedAt ? canonical(departures[0].expectedAt) : null, arrival = arrivals[0]?.expectedAt ? canonical(arrivals[0].expectedAt) : null;
  if (departure && arrival && Date.parse(arrival) < Date.parse(departure)) return { ...base, status: 'uncertain' as const, reason: 'contradictory_prediction_order' };
  if (departure || arrival) {
    const clock = scheduleClock(ride);
    if (!clock) return { ...base, status: 'uncertain' as const, reason: day(ride.queryDate) ? 'schedule_clock_change_unsupported' : 'schedule_clock_reference_missing' };
    // Prepared conservative alignment, not a connection-feasibility decision:
    // at most2min early /6h late relative to each actual scheduled stop event.
    if (departure && (Date.parse(departure) < clock.departure - 120000 || Date.parse(departure) > clock.departure + 6 * 3600000) || arrival && (Date.parse(arrival) < clock.arrival - 120000 || Date.parse(arrival) > clock.arrival + 6 * 3600000)) return { ...base, status: 'uncertain' as const, reason: 'prediction_inconsistent_with_schedule' };
  }
  const vehicle = [...vehicles].sort((a, b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!))[0];
  return { ...base, status: cancellations.length ? 'cancelled' as const : departure || arrival ? 'prediction_evidence' as const : 'position_only' as const,
    reason: 'exact_identity_and_own_fresh_observation', cancellationConfirmed: cancellations.length > 0,
    predictedDepartureAt: departure, predictedArrivalAt: arrival,
    matchedVehicle: vehicle ? { id: vehicle.vehicleId!, lat: vehicle.lat!, lon: vehicle.lon!, observedAt: canonical(vehicle.observedAt!) } : null,
    observationTimes: [...new Set(fresh.map(v => canonical(v.observedAt!)))].sort((a, b) => Date.parse(a) - Date.parse(b)) };
}
