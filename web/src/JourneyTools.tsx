import React, { useEffect, useRef, useState } from 'react';
import { routeKey, type RouteShortcut, type usePassengerPrefs } from './passengerPrefs';
import { expandSearch, type SearchChoice } from './passengerSearch';
import type { OfficialStop, StopSearch } from './scheduleData';

export function nearbyStops(stops: OfficialStop[], lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw Error('Invalid device coordinates');
  const rad = (n: number) => n * Math.PI / 180;
  return stops.map(stop => {
    const a = Math.sin(rad(stop.lat - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(stop.lat)) * Math.sin(rad(stop.lon - lon) / 2) ** 2;
    return { stop, metres: 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) };
  }).sort((a, b) => a.metres - b.metres || a.stop.id.localeCompare(b.stop.id)).slice(0, 3);
}
export function JourneyTools({ form, choices, prefs, onRecall, onFrom }: { form: StopSearch; choices: SearchChoice[]; prefs: ReturnType<typeof usePassengerPrefs>; onRecall: (q: RouteShortcut) => void; onFrom: (id: string) => void }) {
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [nearby, setNearby] = useState<ReturnType<typeof nearbyStops>>([]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const valid = (q: RouteShortcut) => { try { expandSearch({ ...form, ...q }, choices); return true; } catch { return false; } };
  const favorite = prefs.value.favorites.some(q => routeKey(q) === routeKey(form));
  function locate() {
    if (!navigator.geolocation) { setStatus('Device location is unavailable in this browser. Choose a stop by name.'); return; }
    const request = ++generation.current;
    setBusy(true); setNearby([]); setStatus('Waiting for your device location…');
    try { navigator.geolocation.getCurrentPosition(position => {
      if (request !== generation.current) return;
      setBusy(false);
      try {
        // Device coordinates remain only in this callback: no fetch, URL or storage.
        const found = nearbyStops(choices.filter(c => c.kind === 'stop').flatMap(c => c.stops), position.coords.latitude, position.coords.longitude);
        setNearby(found); setStatus('Closest covered stops · straight-line distances, not walking routes. Coverage is incomplete.');
      } catch { setStatus('Your device did not return a usable location. Choose a stop by name.'); }
    }, error => {
      if (request !== generation.current) return;
      setBusy(false); setStatus(error.code === 1 ? 'Location permission was declined. Choose a stop by name.' : 'Device location could not be obtained. Choose a stop by name.');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }); }
    catch { setBusy(false); setStatus('Device location is unavailable here. Choose a stop by name.'); }
  }
  return <details className="journey-tools"><summary>Saved &amp; nearby stops</summary>
    <p>Routes saved in this browser only. Dates, times and device coordinates are never saved here.</p>
    {!prefs.persistent && <p role="status">Browser storage unavailable; shortcuts last until this tab closes.</p>}
    <div className="tools-actions"><button type="button" className="button secondary" disabled={!valid(form)} onClick={() => { const persisted = prefs.toggleFavorite(form); setStatus(favorite ? persisted ? 'Favorite removed.' : 'Favorite removed for this tab only.' : persisted ? 'Favorite saved in this browser.' : 'Favorite saved for this tab only.'); }}>{favorite ? 'Remove favorite' : 'Save favorite'}</button><button type="button" className="button secondary" disabled={prefs.persistent && !prefs.value.recent.length && !prefs.value.favorites.length} onClick={() => { const cleared = prefs.clear(); setStatus(cleared ? 'Saved routes cleared from this browser.' : 'This tab is empty, but browser storage could not be cleared. Stored routes may reappear after this tab closes.'); }}>Clear saved routes</button></div>
    {(['favorites', 'recent'] as const).map(kind => <div key={kind}><h2>{kind === 'favorites' ? 'Favorites' : 'Recent searches'}</h2>{prefs.value[kind].length ? <ul>{prefs.value[kind].map(q => <li key={routeKey(q)}><button type="button" disabled={!valid(q)} onClick={() => { onRecall(q); setStatus('Route restored with a new departure time. Check the date and time before searching.'); }}>{choices.find(c => c.id === q.from)?.title ?? 'Stop no longer covered'} → {choices.find(c => c.id === q.to)?.title ?? 'Stop no longer covered'}<small>{q.modes === 'rail' ? 'Train' : q.modes === 'bus' ? 'Bus' : 'Bus & train'} · {q.changes === '0' ? 'direct only' : `up to ${q.changes} changes`}</small></button></li>)}</ul> : <p>{kind === 'favorites' ? 'Save a route to find it again.' : 'Your submitted searches will appear here.'}</p>}</div>)}
    <h2>Near you</h2><p>Use location only if you choose. Your browser asks for permission. This app processes returned coordinates locally and does not send them to our server or map providers. Choosing a stop sends its ID when you search.</p><button type="button" className="button secondary" onClick={locate} disabled={busy}>Use my location</button>{busy && <button type="button" className="button secondary" onClick={() => { generation.current++; setBusy(false); setStatus('Location request cancelled. Choose a stop by name.'); }}>Cancel location</button>}
    {nearby.length > 0 && <ul className="nearby-stops">{nearby.map(({ stop, metres }) => <li key={stop.id}><button type="button" onClick={() => { onFrom(stop.id); setNearby([]); setStatus(`Start set to ${stop.name} · stop ${stop.code || stop.id}. Walking access is unverified.`); }}>{stop.name.replace(/\bStn\b/g, 'Station')} · stop {stop.code || stop.id}<small>About {metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`} straight-line distance</small></button></li>)}</ul>}
    {status && <p className="tools-status" role="status">{status}</p>}
  </details>;
}
