import { decodeStopSearch, encodeStopSearch, fetchSchedules, type OfficialStop, type StopCatalog, type StopSearch, type ScheduleResult, type ScheduledJourney } from './scheduleData';

export interface SearchChoice { id: string; title: string; detail: string; aliases: string[]; stops: OfficialStop[]; kind: 'stop' | 'place' }
export interface JourneyOption { journey: ScheduledJourney; query: StopSearch }
// Associations use these official GTFS identities/names, not proximity.
// A place result means arrival at a stop; no entrance/walking connection is asserted.
export function searchChoices(catalog: StopCatalog): SearchChoice[] {
  const stops: SearchChoice[] = catalog.stops.map(s => ({ id: s.id, title: s.name.replace(/\bStn\b/g, 'Station'), detail: `Stop ${s.code || s.id}`, aliases: [s.name, s.code || '', s.id], stops: [s], kind: 'stop' }));
  const hospital = catalog.stops.filter(s => ['8490B151081', '8490B151091'].includes(s.id) && s.name === 'Mayo Hospital' && s.code === (s.id === '8490B151081' ? '15108' : '15109'));
  if (hospital.length) stops.unshift({ id: 'place:mayo-hospital', title: 'Mayo Hospital', detail: `Place · ${hospital.length} official ${hospital.length === 1 ? 'stop' : 'stops'}`, aliases: ['Mayo University Hospital', 'hospital', 'Castlebar hospital'], stops: hospital.sort((a, b) => a.id.localeCompare(b.id)), kind: 'place' });
  return stops;
}
const normal = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\bstn\b/g, 'station').trim();
export function suggestions(choices: SearchChoice[], text: string): SearchChoice[] {
  const q = normal(text).slice(0, 160);
  return choices.map((choice, index) => {
    const words = [choice.title, ...choice.aliases].map(normal);
    const score = !q ? (choice.kind === 'place' ? 0 : choice.title.includes('Ballina Bus') ? 1 : 3) : words.some(w => w === q) ? 0 : words.some(w => w.startsWith(q)) ? 1 : words.some(w => q.split(/\s+/).every(token => w.includes(token))) ? 2 : Infinity;
    return { choice, score, index };
  }).filter(v => Number.isFinite(v.score)).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 8).map(v => v.choice);
}
export function decodePassengerSearch(search: string): StopSearch | null {
  const q = decodeStopSearch(search);
  return q && [q.from, q.to].every(id => !id.startsWith('place:') || id === 'place:mayo-hospital') ? q : null;
}
export function pageSearch(search: string, detail: boolean): { query: StopSearch | null; back: StopSearch | null } {
  const p = new URLSearchParams(search), back = p.get('back');
  if (p.getAll('back').length > 1 || back !== null && (!detail || back.length > 700)) return { query: null, back: null };
  p.delete('back');
  const query = decodePassengerSearch(p.toString()), context = back === null ? null : decodePassengerSearch(back);
  if (back !== null && (!context || !query || ['date', 'time', 'modes', 'changes'].some(k => context[k as keyof StopSearch] !== query[k as keyof StopSearch]))) return { query: null, back: null };
  return { query, back: context };
}
export function expandSearch(q: StopSearch, choices: SearchChoice[]): StopSearch[] {
  const from = choices.find(c => c.id === q.from), to = choices.find(c => c.id === q.to);
  if (!from || !to) throw Error('Choose a covered stop or place from the suggestions.');
  const pairs = from.stops.flatMap(a => to.stops.filter(b => b.id !== a.id).map(b => ({ ...q, from: a.id, to: b.id })));
  if (!pairs.length || pairs.length > 4) throw Error('Choose different stops or places.');
  return pairs;
}
export function orderOptions(options: JourneyOption[]): JourneyOption[] {
  // Stop arrivals only; different endpoints are never Pareto-pruned as equivalent.
  return [...options].sort((a, b) => a.journey.arrivalAt - b.journey.arrivalAt || a.journey.changes - b.journey.changes || b.journey.departureAt - a.journey.departureAt || a.query.to.localeCompare(b.query.to));
}
export function itineraryLink(option: JourneyOption, context: StopSearch): string {
  const p = new URLSearchParams(encodeStopSearch(option.query));
  if (context.from !== option.query.from || context.to !== option.query.to) p.set('back', encodeStopSearch(context));
  return `#/scheduled/${option.journey.id}?${p}`;
}
// Small memory-only cache prevents detail/back navigation repeating a place batch.
// Still validate against the newly fetched catalog; no persistent timetable cache.
const cache = new Map<string, { at: number; result: ScheduleResult }>();
const firstRemembered = new WeakMap<ScheduleResult, number>();
const fresh = (entry: { at: number }) => Date.now() - entry.at >= 0 && Date.now() - entry.at < 15000;
export function prefetchStopOptions(q: StopSearch, signal: AbortSignal, retry: boolean): Promise<ScheduleResult | null> {
  const suffix = `|${encodeStopSearch(q)}`;
  // A suffix identifies the query, never the feed. Wait for the fresh catalog
  // before using any cached result; cold reads can still run in parallel.
  const cachedQuery = [...cache].some(([key, value]) => key.endsWith(suffix) && fresh(value));
  return !retry && cachedQuery ? Promise.resolve(null) : fetchSchedules(q, signal);
}
export function rememberStopOptions(q: StopSearch, catalog: StopCatalog, signal: AbortSignal, result: ScheduleResult): ScheduleResult {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const key = `${catalog.feedVersion}|${encodeStopSearch(q)}`;
  const existing = cache.get(key);
  if (result.feedVersion !== catalog.feedVersion) {
    cache.delete(key);
    throw Error('The timetable changed during this search. Please refresh.');
  }
  // A navigation hit must not renew the source result's lifetime.
  if (existing?.result === result) return result;
  const at = firstRemembered.get(result) ?? Date.now();
  firstRemembered.set(result, at);
  cache.delete(key); cache.set(key, { at, result });
  while (cache.size > 6) cache.delete(cache.keys().next().value!);
  return result;
}
export async function loadStopOptions(q: StopSearch, catalog: StopCatalog, signal: AbortSignal, retry: boolean): Promise<ScheduleResult> {
  const key = `${catalog.feedVersion}|${encodeStopSearch(q)}`, cached = cache.get(key);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!retry && cached && fresh(cached)) return cached.result;
  const result = await fetchSchedules(q, signal);
  return rememberStopOptions(q, catalog, signal, result);
}
