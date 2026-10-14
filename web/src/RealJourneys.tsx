import { JourneyTools } from "./JourneyTools";
import { usePassengerPrefs } from "./passengerPrefs";
import { StopPicker } from './StopPicker';
import { decodePassengerSearch, pageSearch, expandSearch, searchChoices, orderOptions, itineraryLink, loadStopOptions, prefetchStopOptions, rememberStopOptions, type JourneyOption } from './passengerSearch';
import React, { useEffect, useRef, useState } from 'react';
import { dateLabel, dublinToday, minutes } from './fixtures';
import { scheduleClock, scheduleDaySuffix } from './dublinTime';
const lastSearchDate = () => new Date(Date.parse(dublinToday() + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
function upcomingDeparture(bufferMinutes = 5) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + bufferMinutes * 60000));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
import { decodeStopSearch, encodeStopSearch, fetchCatalog, ScheduleRequestError, type StopCatalog, type StopSearch, type ScheduleResult } from './scheduleData';
function ScheduleNotice() {
  return <details className="schedule-note"><summary>Scheduled times · travel limits</summary><p>Official scheduled times. Delays and cancellations are not applied to these itineraries. Check <a href="#/live">live departures</a> before travel. Walking, bays and accessibility are unverified.</p></details>;
}
export function RealJourneys({ search, detailId }: { search: string; detailId?: string }) {
  const prefs = usePassengerPrefs();
  const page = React.useMemo(() => search ? pageSearch(search, !!detailId) : { query: null, back: null }, [search, detailId]);
  const query = page.query;
  const [catalog, setCatalog] = useState<StopCatalog | null>(null), [result, setResult] = useState<ScheduleResult | null>(null);
  const [resultSearch, setResultSearch] = useState<string | null>(null);
  const [options, setOptions] = useState<JourneyOption[]>([]), [warning, setWarning] = useState(''), [showAll, setShowAll] = useState(false), [exact, setExact] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const retryRequested = useRef(false);
  const retry = () => { retryRequested.current = true; setAttempt(n => n + 1); };
  const [form, setForm] = useState<StopSearch>(() => ({ from: '', to: '', ...upcomingDeparture(), modes: 'bus,rail', changes: '1' }));
  const choices = React.useMemo(() => catalog ? searchChoices(catalog) : [], [catalog]);
  useEffect(() => {
    const forceRefresh = retryRequested.current;
    retryRequested.current = false;
    const controller = new AbortController();
    let completed = 0;
    const timer = window.setTimeout(() => { controller.abort(); setLoading(false); if (completed) setWarning('Some stop searches did not finish. These results are incomplete.'); else setError('Schedules took too long to respond. Please try again.'); }, 23000);
    setLoading(true); setError(''); setWarning(''); setResult(null); setResultSearch(null); setOptions([]); setShowAll(false); setCatalog(null);
    if (search && !query) { clearTimeout(timer); setLoading(false); setError('This search link is invalid. Start a new search.'); return () => controller.abort(); }
    (async () => {
      // Preserve the cold exact-stop parallel catalog/one-journey contract.
      // Place batches resolve the catalog first, then run one journey at a time.
      const isExact = query && ![query.from, query.to].some(id => id.startsWith('place:'));
      const [c, early] = await Promise.all([fetchCatalog(controller.signal), isExact ? prefetchStopOptions(query!, controller.signal, forceRefresh) : Promise.resolve(null)]);
      if (controller.signal.aborted) return;
      setCatalog(c);
      const candidates = searchChoices(c), origin = c.stops.find(s => s.name.includes('Ballina Bus'))?.id ?? c.stops[0]!.id;
      const place = candidates.find(c => c.kind === 'place' && c.stops.length > 1);
      const destination = place?.id ?? c.stops.find(s => s.name.includes('Mayo Hospital'))?.id ?? c.stops.find(s => s.id !== origin)?.id ?? '';
      if (!query) { setForm(q => ({ ...q, from: origin, to: destination })); setLoading(false); return; }
      if (query.date < c.validFrom || query.date > c.validUntil || query.date < dublinToday() || query.date > lastSearchDate()) throw Error('Choose covered stops and a date within the next 14 days.');
      const pairs = expandSearch(query, candidates);
      if (page.back && !expandSearch(page.back, candidates).some(q => q.from === query.from && q.to === query.to)) throw Error('This itinerary return link is invalid.');
      setForm(query);
      const found: JourneyOption[] = [];
      let basis: string | null = null;
      let failed = 0, failureMessage = '';
      for (const q of pairs) {
        if (controller.signal.aborted) break;
        try {
          const r = early ? rememberStopOptions(q, c, controller.signal, early) : await loadStopOptions(q, c, controller.signal, forceRefresh);
          if (controller.signal.aborted) break;
          const incomingBasis = `${r.version}|${r.referenceAt ?? 'wall-clock'}`;
          if (basis !== null && basis !== incomingBasis) throw Error('The timetable clock changed during this search. Please refresh.');
          basis = incomingBasis;
          completed++; setResultSearch(encodeStopSearch(query)); setResult(previous => previous ?? r);
          found.push(...r.journeys.map(journey => ({ journey, query: q })));
          setOptions(orderOptions(found));
        } catch (e) {
          if (controller.signal.aborted) break;
          if (!(e instanceof ScheduleRequestError) || pairs.length === 1) throw e;
          failed++; failureMessage = e.message; setWarning(`${e.message} Results for the other stops may be incomplete.`);
          if (e.status === 429) break; // Never continue a batch after quota exhaustion.
        }
      }
      if (!controller.signal.aborted) { if (!completed && failed) throw Error(failureMessage || 'No stop search could finish. Try an exact stop or retry later.'); setLoading(false); }
    })().catch(e => { if (!controller.signal.aborted) { setLoading(false); setResult(null); setOptions([]); setError(e instanceof Error ? e.message : 'Schedules are unavailable.'); } }).finally(() => { clearTimeout(timer); controller.abort(); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, query, attempt, page.back]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!catalog || !decodePassengerSearch(encodeStopSearch(form))) { setError('Choose different stops or places from the suggestions and a valid date and time.'); return; }
    try { expandSearch(form, choices); } catch { setError('Choose covered stops or places from the suggestions.'); return; }
    prefs.recent(form); setError('');
    if (query && encodeStopSearch(query) === encodeStopSearch(form)) { retry(); return; }
    window.location.hash = `/plan?${encodeStopSearch(form)}`;
  }
  const clock = (seconds: number) => scheduleClock(seconds, result?.referenceAt);
  const daySuffix = (seconds: number) => scheduleDaySuffix(seconds, result?.referenceAt);
  const detail = detailId ? options.find(o => o.journey.id === detailId)?.journey : null;
  const shownSearch = query ?? form;
  const currentResults = !!query && resultSearch === encodeStopSearch(query);
  const shownFrom = choices.find(s => s.id === shownSearch.from), shownTo = choices.find(s => s.id === shownSearch.to);
  return <section className="official-planner" aria-label="Official journey planner">
    <div className="page-heading"><div><div className="eyebrow">OFFICIAL TIMETABLES</div><h1>Find your journey.</h1><p>Stops & places · Ireland time</p></div><a className="button secondary" href="#/live">Live map</a></div>
    <ScheduleNotice />
    {!detailId && catalog && <details className="search-editor" key={search || 'home'} open={!result}>
      <summary hidden={!result}>Edit search · {shownFrom?.title} · {shownFrom?.detail} → {shownTo?.title} · {shownTo?.detail}<br />{shownSearch.date} · after {shownSearch.time}</summary>
      <form className="search-form official-form" onSubmit={submit}>
      <div className="places-grid">
        {exact ? <label className="field"><span>From stop</span><select aria-label="From stop" value={form.from} onChange={e => setForm(q => ({ ...q, from: e.target.value }))}><option value="">Choose a specific stop</option>{catalog.stops.map(s => <option key={s.id} value={s.id}>{s.name} · {s.code || s.id}</option>)}</select></label> : <StopPicker label="From" value={form.from} choices={choices} onChange={id => setForm(q => ({ ...q, from: id }))} />}
        <button className="swap-button" type="button" aria-label="Swap stops" onClick={() => setForm(q => ({ ...q, from: q.to, to: q.from }))}>⇄</button>
        {exact ? <label className="field"><span>To stop</span><select aria-label="To stop" value={form.to} onChange={e => setForm(q => ({ ...q, to: e.target.value }))}><option value="">Choose a specific stop</option>{catalog.stops.map(s => <option key={s.id} value={s.id}>{s.name} · {s.code || s.id}</option>)}</select></label> : <StopPicker label="To" value={form.to} choices={choices} onChange={id => setForm(q => ({ ...q, to: id }))} />}
      </div>
      <div className="planner-actions"><button type="button" className="text-link" aria-pressed={exact} onClick={() => { setExact(v => !v); if (!exact) setForm(q => ({ ...q, from: q.from.startsWith('place:') ? '' : q.from, to: q.to.startsWith('place:') ? '' : q.to })); }}>Choose exact stops</button><button type="button" className="text-link" onClick={() => setForm(q => ({ ...q, ...upcomingDeparture(0) }))}>Leave now</button></div>
      <div className="date-grid"><label className="field"><span>Date</span><input aria-label="Schedule date" type="date" required min={dublinToday()} max={catalog.validUntil < lastSearchDate() ? catalog.validUntil : lastSearchDate()} value={form.date} onChange={e => setForm(q => ({ ...q, date: e.target.value }))} /></label><label className="field"><span>After</span><input aria-label="Schedule time" type="time" required value={form.time} onChange={e => setForm(q => ({ ...q, time: e.target.value }))} /></label></div>
      <details className="search-options"><summary>Transport &amp; changes</summary><div className="options-grid"><label className="field"><span>Transport</span><select aria-label="Scheduled transport" value={form.modes} onChange={e => setForm(q => ({ ...q, modes: e.target.value }))}><option value="bus,rail">Bus &amp; train</option><option value="bus">Bus</option><option value="rail">Train</option></select></label><label className="field"><span>Maximum changes</span><select aria-label="Maximum changes" value={form.changes} onChange={e => setForm(q => ({ ...q, changes: e.target.value }))}><option value="0">Direct only</option><option value="1">One</option><option value="2">Two</option></select></label></div><p>Connections use the same official stop ID and at least two minutes. Check platforms and boarding bays.</p></details>
      <button className="button primary search-submit" disabled={loading} type="submit">Find scheduled journeys →</button>
    <JourneyTools form={form} choices={choices} prefs={prefs} onFrom={id => setForm(q => ({ ...q, from: id }))} onRecall={route => { setForm({ ...route, ...upcomingDeparture() }); setExact(false); }} />
    </form></details>}
    {loading && <p className="loading-heading" role="status"><span className="spinner" /> Loading official schedules…</p>}
    {error && <div className="empty-state" role="alert"><h2>Schedules unavailable.</h2><p>{error}</p><button className="button primary" onClick={retry}>Try again</button><a className="text-link" href="#/plan">New search</a></div>}
    {!loading && !error && result && currentResults && !detailId && <div className="scheduled-results" aria-label="Scheduled results">
      <p className="results-heading">To {shownTo?.title}. {[query?.from, query?.to].some(id => id?.startsWith('place:')) ? 'Official stops are searched separately; access to or from the building and walks between stops are unverified.' : [shownFrom, shownTo].some(c => c?.stops[0]?.name.includes('Hospital')) ? 'Hospital entrance and access to or from this stop are unverified.' : 'Access beyond this stop is unverified.'}</p>
      {warning && <p role="status" className="source-warning">{warning}</p>}
      <p className="results-heading">{options.length} scheduled {options.length === 1 ? 'option' : 'options'} · sorted by stop arrival</p>
      {!options.length && <div className="empty-state" role="status"><h2>No scheduled options found.</h2><p>Try another stop, departure time or transport mode. This search excludes walking between stops and does not prove no service exists.</p></div>}
      {(showAll ? options : options.slice(0, 6)).map(o => { const j = o.journey; return <article className="journey-card" key={`${o.query.from}|${o.query.to}|${j.id}`}><div className="card-label"><span>{j.changes ? `${j.changes} ${j.changes === 1 ? 'change' : 'changes'}` : 'Direct'}</span><span className="fixture-tag">NTA SCHEDULE</span></div><div className="card-main"><strong className="journey-times">{clock(j.departureAt)}{daySuffix(j.departureAt)} → {clock(j.arrivalAt)}{daySuffix(j.arrivalAt)}</strong><span>{minutes(j.arrivalAt - j.departureAt)} min</span></div><div className="card-bottom"><div><p>{j.rides.map(r => `${r.mode === 'rail' ? 'Train' : 'Bus'} ${r.route}`).join(' → ')}</p>{query?.from.startsWith('place:') && <p>Boards at {j.rides[0]!.from.name} · stop {j.rides[0]!.from.code || j.rides[0]!.from.id}</p>}<p>Arrives at {j.rides.at(-1)!.to.name} · stop {j.rides.at(-1)!.to.code || j.rides.at(-1)!.to.id}</p>{daySuffix(j.departureAt) && <p className="next-day-notice">Departs on a later day {daySuffix(j.departureAt)}</p>}{j.rides.slice(1).map((r, i) => <p key={`${r.from.id}-${i}`}>Via {r.from.name} · {r.from.code || r.from.id} · {minutes(r.boardAt - j.rides[i]!.alightAt)} min wait</p>)}<p>No walking directions</p></div><a className="button secondary" href={itineraryLink(o, query!)}>View itinerary →</a></div></article>; })}
      {options.length > 6 && <button className="button secondary" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer options' : `Show all ${options.length} options`}</button>}
    </div>}
    {!loading && !error && currentResults && detailId && (detail && query ? <article className="itinerary scheduled-itinerary"><a className="back-link" href={`#/plan?${encodeStopSearch(page.back ?? query)}`}>← Back to results</a><h2>{detail.rides[0]!.from.name} → {detail.rides.at(-1)!.to.name}</h2><p>{dateLabel(query.date)} · scheduled times</p><ol className="timeline">{detail.rides.map((r, i) => <li className="timeline-step ride" key={`${r.tripId}-${i}`}><div className="step-header"><strong>{r.mode === 'rail' ? 'Train' : 'Bus'} {r.route}</strong><span>{clock(r.boardAt)}{daySuffix(r.boardAt)} → {clock(r.alightAt)}{daySuffix(r.alightAt)}</span></div><p>Towards {r.destination || r.to.name}</p><p><strong>Get on:</strong> {r.from.name} · stop {r.from.code || r.from.id}</p><p><strong>Get off:</strong> {r.to.name} · stop {r.to.code || r.to.id}</p><p className="boarding-caveat">Official coordinates: {r.from.lat.toFixed(5)}, {r.from.lon.toFixed(5)}. Side of road, platform and accessibility unverified.</p>{i > 0 && <p>{minutes(r.boardAt - detail.rides[i - 1]!.alightAt)} min connection at the same stop ID; confirm the boarding bay.</p>}<details><summary>Service reference</summary><p>Trip {r.tripId} · GTFS service date {r.serviceDate}{r.boardSequence !== undefined && ` · sequences ${r.boardSequence}–${r.alightSequence}`} </p></details></li>)}</ol></article> : <div className="empty-state"><h2>Itinerary unavailable.</h2><a href={`#/plan?${search}`}>Refresh results</a></div>)}
    {catalog && !loading && <p className="results-footnote">NTA · CC BY 4.0 · feed {catalog.feedVersion.slice(0, 12)} · {catalog.stops.length} covered stops. Same-stop connections only; no fares or verified pedestrian paths.</p>}
  </section>;
}
