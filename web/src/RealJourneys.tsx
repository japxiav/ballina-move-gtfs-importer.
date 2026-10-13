import React, { useEffect, useState } from 'react';
import { clock, dateLabel, daySuffix, dublinToday, minutes } from './fixtures';
const lastSearchDate = () => new Date(Date.parse(dublinToday() + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
function upcomingDeparture() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + 5 * 60000));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
import { decodeStopSearch, encodeStopSearch, fetchCatalog, fetchSchedules, type StopCatalog, type StopSearch, type ScheduleResult } from './scheduleData';
function ScheduleNotice() {
  return <p className="schedule-note">Official scheduled times. Delays and cancellations are not applied to these itineraries. Check <a href="#/live">live departures</a> before travel. Walking, bays and accessibility are unverified.</p>;
}
export function RealJourneys({ search, detailId }: { search: string; detailId?: string }) {
  const query = React.useMemo(() => search ? decodeStopSearch(search) : null, [search]);
  const [catalog, setCatalog] = useState<StopCatalog | null>(null), [result, setResult] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<StopSearch>(() => ({ from: '', to: '', ...upcomingDeparture(), modes: 'bus,rail', changes: '1' }));
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); setLoading(false); setError('Schedules took too long to respond. Please try again.'); }, 23000);
    setLoading(true); setError(''); setResult(null); setCatalog(null);
    if (search && !query) { clearTimeout(timer); setLoading(false); setError('This search link is invalid. Start a new search.'); return () => controller.abort(); }
    (async () => {
      const [c, requestedResult] = await Promise.all([
        fetchCatalog(controller.signal),
        query ? fetchSchedules(query, controller.signal) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      setCatalog(c);
      const defaults = { ...form, from: c.stops.find(s => s.name.includes('Ballina Bus'))?.id ?? c.stops[0]!.id, to: c.stops.find(s => s.name.includes('Mayo Hospital'))?.id ?? c.stops.find(s => s.id !== c.stops[0]!.id)?.id ?? '' };
      if (query) {
        if (!c.stops.some(s => s.id === query.from) || !c.stops.some(s => s.id === query.to) || query.date < c.validFrom || query.date > c.validUntil || query.date < dublinToday() || query.date > lastSearchDate()) throw Error('Choose covered stops and a date within the next 14 days.');
        setForm(query); const r = requestedResult!;
        if (controller.signal.aborted) return;
        if (r.feedVersion !== c.feedVersion) throw Error('The timetable changed during this search. Please refresh.');
        setResult(r);
      } else setForm(defaults);
      setLoading(false);
    })().catch(e => { if (!controller.signal.aborted && !timedOut) { setLoading(false); setError(e instanceof Error ? e.message : 'Schedules are unavailable.'); } }).finally(() => { clearTimeout(timer); controller.abort(); });
    return () => { clearTimeout(timer); controller.abort(); };
    // The URL owns searches; editing the form never starts an upstream request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query, attempt]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!catalog || !decodeStopSearch(encodeStopSearch(form))) { setError('Choose different stops and a valid date and time.'); return; }
    setError(''); window.location.hash = `/plan?${encodeStopSearch(form)}`;
    if (query && encodeStopSearch(query) === encodeStopSearch(form)) setAttempt(n => n + 1);
  }
  const detail = detailId ? result?.journeys.find(j => j.id === detailId) : null;
  const shownSearch = query ?? form;
  const shownFrom = catalog?.stops.find(s => s.id === shownSearch.from), shownTo = catalog?.stops.find(s => s.id === shownSearch.to);
  return <section className="official-planner" aria-label="Official journey planner">
    <div className="page-heading"><div><div className="eyebrow">OFFICIAL TIMETABLES</div><h1>Find your journey.</h1><p>Between stops · Ireland time</p></div><a className="button secondary" href="#/live">Live map</a></div>
    <ScheduleNotice />
    {!detailId && catalog && <details className="search-editor" key={search || 'home'} open={!result}>
      <summary hidden={!result}>Edit search · {shownFrom?.name} · {shownFrom?.code || shownSearch.from} → {shownTo?.name} · {shownTo?.code || shownSearch.to}<br />{shownSearch.date} · after {shownSearch.time}</summary>
      <form className="search-form official-form" onSubmit={submit}>
      <div className="places-grid">
        <label className="field"><span>From stop</span><select aria-label="From stop" value={form.from} onChange={e => setForm(q => ({ ...q, from: e.target.value }))}>{catalog.stops.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` · ${s.code}` : ''}</option>)}</select></label>
        <button className="swap-button" type="button" aria-label="Swap stops" onClick={() => setForm(q => ({ ...q, from: q.to, to: q.from }))}>⇄</button>
        <label className="field"><span>To stop</span><select aria-label="To stop" value={form.to} onChange={e => setForm(q => ({ ...q, to: e.target.value }))}>{catalog.stops.map(s => <option key={s.id} value={s.id}>{s.name}{s.code ? ` · ${s.code}` : ''}</option>)}</select></label>
      </div>
      <div className="date-grid"><label className="field"><span>Date</span><input aria-label="Schedule date" type="date" required min={dublinToday()} max={catalog.validUntil < lastSearchDate() ? catalog.validUntil : lastSearchDate()} value={form.date} onChange={e => setForm(q => ({ ...q, date: e.target.value }))} /></label><label className="field"><span>After</span><input aria-label="Schedule time" type="time" required value={form.time} onChange={e => setForm(q => ({ ...q, time: e.target.value }))} /></label></div>
      <details className="search-options"><summary>Transport &amp; changes</summary><div className="options-grid"><label className="field"><span>Transport</span><select aria-label="Scheduled transport" value={form.modes} onChange={e => setForm(q => ({ ...q, modes: e.target.value }))}><option value="bus,rail">Bus &amp; train</option><option value="bus">Bus</option><option value="rail">Train</option></select></label><label className="field"><span>Maximum changes</span><select aria-label="Maximum changes" value={form.changes} onChange={e => setForm(q => ({ ...q, changes: e.target.value }))}><option value="0">Direct only</option><option value="1">One</option><option value="2">Two</option></select></label></div><p>Connections use the same official stop ID and at least two minutes. Check platforms and boarding bays.</p></details>
      <button className="button primary search-submit" disabled={loading} type="submit">Find scheduled journeys →</button>
    </form></details>}
    {loading && <p className="loading-heading" role="status"><span className="spinner" /> Loading official schedules…</p>}
    {error && <div className="empty-state" role="alert"><h2>Schedules unavailable.</h2><p>{error}</p><button className="button primary" onClick={() => setAttempt(n => n + 1)}>Try again</button><a className="text-link" href="#/plan">New search</a></div>}
    {!loading && !error && result && !detailId && <div className="scheduled-results" aria-label="Scheduled results">
      <p className="results-heading">{result.journeys.length} scheduled {result.journeys.length === 1 ? 'option' : 'options'} · sorted by arrival</p>
      {!result.journeys.length && <div className="empty-state" role="status"><h2>No scheduled options found.</h2><p>Try another stop, departure time or transport mode. This search excludes walking between stops and does not prove no service exists.</p></div>}
      {result.journeys.map(j => <article className="journey-card" key={j.id}><div className="card-label"><span>{j.changes ? `${j.changes} ${j.changes === 1 ? 'change' : 'changes'}` : 'Direct'}</span><span className="fixture-tag">NTA SCHEDULE</span></div><div className="card-main"><strong className="journey-times">{clock(j.departureAt)}{daySuffix(j.departureAt)} → {clock(j.arrivalAt)}{daySuffix(j.arrivalAt)}</strong><span>{minutes(j.arrivalAt - j.departureAt)} min</span></div><div className="card-bottom"><div><p>{j.rides.map(r => `${r.mode === 'rail' ? 'Train' : 'Bus'} ${r.route}`).join(' → ')}</p><p>No walking directions</p></div><a className="button secondary" href={`#/scheduled/${j.id}?${encodeStopSearch(query!)}`}>View itinerary →</a></div></article>)}
    </div>}
    {!loading && !error && detailId && (detail && query ? <article className="itinerary scheduled-itinerary"><a className="back-link" href={`#/plan?${encodeStopSearch(query)}`}>← Back to results</a><h2>{detail.rides[0]!.from.name} → {detail.rides.at(-1)!.to.name}</h2><p>{dateLabel(query.date)} · scheduled times</p><ol className="timeline">{detail.rides.map((r, i) => <li className="timeline-step ride" key={`${r.tripId}-${i}`}><div className="step-header"><strong>{r.mode === 'rail' ? 'Train' : 'Bus'} {r.route}</strong><span>{clock(r.boardAt)}{daySuffix(r.boardAt)} → {clock(r.alightAt)}{daySuffix(r.alightAt)}</span></div><p>Towards {r.destination || r.to.name}</p><p><strong>Get on:</strong> {r.from.name} · stop {r.from.code || r.from.id}</p><p><strong>Get off:</strong> {r.to.name} · stop {r.to.code || r.to.id}</p><p className="boarding-caveat">Official coordinates: {r.from.lat.toFixed(5)}, {r.from.lon.toFixed(5)}. Side of road, platform and accessibility unverified.</p>{i > 0 && <p>{minutes(r.boardAt - detail.rides[i - 1]!.alightAt)} min connection at the same stop ID; confirm the boarding bay.</p>}<details><summary>Service reference</summary><p>Trip {r.tripId} · GTFS service date {r.serviceDate}</p></details></li>)}</ol></article> : <div className="empty-state"><h2>Itinerary unavailable.</h2><a href={`#/plan?${search}`}>Refresh results</a></div>)}
    {catalog && !loading && <p className="results-footnote">NTA · CC BY 4.0 · feed {catalog.feedVersion.slice(0, 12)} · {catalog.stops.length} covered stops. Same-stop connections only; no fares or verified pedestrian paths.</p>}
  </section>;
}
