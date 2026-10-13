import { useEffect, useState } from 'react';
import type { StopSearch } from './scheduleData';

export type RouteShortcut = Pick<StopSearch, 'from' | 'to' | 'modes' | 'changes'>;
export interface PassengerPrefs { version: 1; recent: RouteShortcut[]; favorites: RouteShortcut[] }
export const PREFS_MAX_CHARS = 8192;
export const PREFS_KEY = 'ballina-move:routes:v1';
const empty = (): PassengerPrefs => ({ version: 1, recent: [], favorites: [] });
let memory = empty();
let memoryMode = false;
export const routeKey = (q: RouteShortcut) => JSON.stringify([q.from, q.to, q.modes, q.changes]);
export const routeOnly = (q: RouteShortcut): RouteShortcut => ({ from: q.from, to: q.to, modes: q.modes, changes: q.changes });
const identifier = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_ .:-]{1,120}$/.test(s) && (!s.startsWith('place:') || s === 'place:mayo-hospital');
const route = (q: unknown): q is RouteShortcut => !!q && typeof q === 'object' && !Array.isArray(q) && Object.keys(q).length === 4 && identifier((q as RouteShortcut).from) && identifier((q as RouteShortcut).to) && (q as RouteShortcut).from !== (q as RouteShortcut).to && ['bus', 'rail', 'bus,rail'].includes((q as RouteShortcut).modes) && ['0', '1', '2'].includes((q as RouteShortcut).changes);
export function decodePrefs(raw: string | null): PassengerPrefs {
  if (!raw || raw.length > PREFS_MAX_CHARS) return empty();
  try {
    const v = JSON.parse(raw);
    if (!v || Object.keys(v).length !== 3 || v.version !== 1 || !Array.isArray(v.recent) || v.recent.length > 8 || !Array.isArray(v.favorites) || v.favorites.length > 6 || ![...v.recent, ...v.favorites].every(route)) return empty();
    const unique = (items: RouteShortcut[]) => [...new Map(items.map(r => [routeKey(r), routeOnly(r)])).values()];
    return { version: 1, recent: unique(v.recent), favorites: unique(v.favorites) };
  } catch { return empty(); }
}
function read() {
  if (memoryMode) return { value: memory, persistent: false };
  try { return { value: decodePrefs(localStorage.getItem(PREFS_KEY)), persistent: true }; }
  catch { memoryMode = true; return { value: memory, persistent: false }; }
}
export function usePassengerPrefs() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== PREFS_KEY && event.key !== null) return;
      if (event.key === null || event.newValue === null) memory = empty();
      setState(read());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const update = (fn: (p: PassengerPrefs) => PassengerPrefs) => {
    const next = fn(state.value); memory = next;
    try { const raw = JSON.stringify(next); if (raw.length > PREFS_MAX_CHARS) throw Error("preferences too large"); localStorage.setItem(PREFS_KEY, raw); memoryMode = false; setState({ value: next, persistent: true }); return true; }
    catch { memoryMode = true; setState({ value: next, persistent: false }); return false; }
  };
  return { ...state,
    recent: (q: RouteShortcut) => { if (route(routeOnly(q))) update(p => ({ ...p, recent: [routeOnly(q), ...p.recent.filter(r => routeKey(r) !== routeKey(q))].slice(0, 8) })); },
    toggleFavorite: (q: RouteShortcut) => { if (route(routeOnly(q))) return update(p => ({ ...p, favorites: p.favorites.some(r => routeKey(r) === routeKey(q)) ? p.favorites.filter(r => routeKey(r) !== routeKey(q)) : [routeOnly(q), ...p.favorites].slice(0, 6) })); },
    clear: () => { memory = empty(); try { localStorage.removeItem(PREFS_KEY); memoryMode = false; setState({ value: memory, persistent: true }); return true; } catch { memoryMode = true; setState({ value: memory, persistent: false }); return false; } }
  };
}
