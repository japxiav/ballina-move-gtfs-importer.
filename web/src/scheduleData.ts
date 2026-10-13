import { boundedJson } from './liveData';
import { validDate, validTime } from './fixtures';
export interface OfficialStop { id: string; name: string; code: string | null; lat: number; lon: number }
export interface StopCatalog { version: 1; source: 'nta_gtfs'; feedVersion: string; loadedAt: string; validFrom: string; validUntil: string; timezone: 'Europe/Dublin'; scope: 'stop_to_stop_same_stop_transfers'; stops: OfficialStop[] }
export interface StopSearch { from: string; to: string; date: string; time: string; modes: string; changes: string }
export interface ScheduledRide { tripId: string; routeId?: string; boardSequence?: number; alightSequence?: number; route: string; mode: 'bus' | 'rail'; destination: string; from: OfficialStop; to: OfficialStop; boardAt: number; alightAt: number; serviceDate: string }
export interface ScheduledJourney { id: string; departureAt: number; arrivalAt: number; changes: number; rides: ScheduledRide[] }
export interface ScheduleResult { version: 1; source: 'nta_gtfs'; feedVersion: string; loadedAt: string; serviceDate: string; timezone: 'Europe/Dublin'; scope: 'stop_to_stop_same_stop_transfers'; predictionType: 'scheduled'; walkingIncluded: false; realTimeApplied: false; minBoardingSeconds: 60; minTransferSeconds: 120; journeys: ScheduledJourney[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 160;
const identifier = (v: unknown): v is string => text(v) && /^[A-Za-z0-9_ .:-]{1,120}$/.test(v);
function provenance(v: unknown): asserts v is Record<string, unknown> {
  if (!object(v) || v.version !== 1 || v.source !== 'nta_gtfs' || v.timezone !== 'Europe/Dublin' || v.scope !== 'stop_to_stop_same_stop_transfers' || !text(v.feedVersion) || !/^[A-Za-z0-9_-]{1,128}$/.test(v.feedVersion) || !text(v.loadedAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(v.loadedAt) || !Number.isFinite(Date.parse(v.loadedAt))) throw Error('Invalid schedule source.');
}
function stop(v: unknown): v is OfficialStop {
  return object(v) && identifier(v.id) && text(v.name) && !!v.name && (v.code === null || text(v.code)) && typeof v.lat === 'number' && typeof v.lon === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.lat >= 51 && v.lat <= 55.7 && v.lon >= -11 && v.lon <= -5;
}
export function decodeCatalog(value: unknown): StopCatalog {
  provenance(value);
  if (!text(value.validFrom) || !validDate(value.validFrom) || !text(value.validUntil) || !validDate(value.validUntil) || !Array.isArray(value.stops) || !value.stops.length || value.stops.length > 1000 || !value.stops.every(stop) || new Set(value.stops.map(s => s.id)).size !== value.stops.length) throw Error('Invalid stop catalog.');
  return value as unknown as StopCatalog;
}
export function decodeSchedules(value: unknown, query: StopSearch): ScheduleResult {
  provenance(value);
  if (value.serviceDate !== query.date || value.predictionType !== 'scheduled' || value.walkingIncluded !== false || value.realTimeApplied !== false || value.minBoardingSeconds !== 60 || value.minTransferSeconds !== 120 || !Array.isArray(value.journeys) || value.journeys.length > 6) throw Error('Invalid scheduled journeys.');
  const depart = Number(query.time.slice(0, 2)) * 3600 + Number(query.time.slice(3)) * 60;
  const ids = new Set<string>();
  for (const j of value.journeys) {
    if (!object(j) || !identifier(j.id) || ids.has(j.id) || !Array.isArray(j.rides) || !j.rides.length || j.rides.length > Number(query.changes) + 1 || j.changes !== j.rides.length - 1) throw Error('Invalid journey.');
    ids.add(j.id);
    let previous: ScheduledRide | null = null;
    const used = new Set<string>();
    for (const r of j.rides) {
      if (!object(r) || !text(r.tripId) || !r.tripId || !text(r.route) || !text(r.destination) || !['bus', 'rail'].includes(String(r.mode)) || !query.modes.split(',').includes(String(r.mode)) || !stop(r.from) || !stop(r.to) || !text(r.serviceDate) || !validDate(r.serviceDate) || typeof r.boardAt !== 'number' || typeof r.alightAt !== 'number' || !Number.isInteger(r.boardAt) || !Number.isInteger(r.alightAt) || r.boardAt < depart + 60 || r.alightAt < r.boardAt || r.alightAt > depart + 36 * 3600) throw Error('Invalid ride.');
      if (previous ? r.from.id !== previous.to.id || r.boardAt < previous.alightAt + 120 : r.from.id !== query.from) throw Error('Invalid connection.');
      // Backwards-compatible with the inspected v2 API; partial/invalid new
      // operational metadata is rejected rather than silently discarded.
      if (['routeId', 'boardSequence', 'alightSequence'].some(k => k in r) && (!identifier(r.routeId) || typeof r.boardSequence !== 'number' || typeof r.alightSequence !== 'number' || !Number.isInteger(r.boardSequence) || !Number.isInteger(r.alightSequence) || r.boardSequence < 0 || r.alightSequence <= r.boardSequence)) throw Error('Invalid service sequence.');
      const key = `${r.serviceDate}:${r.tripId}`; if (used.has(key)) throw Error('Repeated trip.'); used.add(key);
      previous = r as unknown as ScheduledRide;
    }
    if (previous!.to.id !== query.to || j.arrivalAt !== previous!.alightAt || j.departureAt !== j.rides[0].boardAt) throw Error('Invalid journey endpoints.');
  }
  return value as unknown as ScheduleResult;
}
export function decodeStopSearch(search: string): StopSearch | null {
  const p = new URLSearchParams(search), keys = ['from', 'to', 'date', 'time', 'modes', 'changes'];
  if ([...p.keys()].some(k => !keys.includes(k)) || keys.some(k => p.getAll(k).length !== 1)) return null;
  const q = Object.fromEntries(p) as unknown as StopSearch;
  return identifier(q.from) && identifier(q.to) && q.from !== q.to && validDate(q.date) && validTime(q.time) && ['bus', 'rail', 'bus,rail'].includes(q.modes) && ['0', '1', '2'].includes(q.changes) ? q : null;
}
export const encodeStopSearch = (q: StopSearch) => new URLSearchParams({ ...q }).toString();
async function request(path: string, signal: AbortSignal): Promise<unknown> {
  // Only same-origin, credentials omitted. No fallback to illustrative data.
  const response = await fetch(new URL(path, window.location.href), { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw Error(response.status === 429 ? 'Too many searches. Wait a minute and try again.' : 'Official schedules are unavailable. Try again later.');
  return boundedJson(response);
}
export const fetchCatalog = async (signal: AbortSignal) => decodeCatalog(await request('api/stops', signal));
export const fetchSchedules = async (q: StopSearch, signal: AbortSignal) => decodeSchedules(await request(`api/journeys?${encodeStopSearch(q)}`, signal), q);
