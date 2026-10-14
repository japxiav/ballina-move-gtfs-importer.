import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { groupVehicles } from "./mapGroups";
import { VehicleCard } from "./VehicleCard";
import { mapSourceStates } from './mapSourceState';
import { fetchLiveData, visibleVehicles, visibleDepartures, departureStatusLabel, type LiveData, type VehiclePosition } from "./liveData";

const time = (date: string) => new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).format(new Date(date));
const age = (date: string, now: number) => Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
const mayo = L.latLngBounds([[53.7, -9.95], [54.4, -8.5]]);
const ireland = L.latLngBounds([[51.35, -10.7], [55.45, -5.4]]);

export function LiveMap() {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), markers = useRef(new Map<string, L.Marker>());
  const returnFocus = useRef<HTMLElement | null>(null), filterFallback = useRef<HTMLButtonElement>(null);
  const [viewVersion, setViewVersion] = useState(0), [clusterIds, setClusterIds] = useState<string[]>([]), [selectionNotice, setSelectionNotice] = useState("");
  const tiles = useRef<L.TileLayer | null>(null);
  const resetTileCycle = useRef<() => void>(() => {});
  const [tilesLoading, setTilesLoading] = useState(true), [tileError, setTileError] = useState(false);
  const [tilesDelayed, setTilesDelayed] = useState(false);
  const [data, setData] = useState<LiveData | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState<"all" | "bus" | "train">("all"), [selectedId, setSelectedId] = useState<string | null>(null);
  const active = useMemo(() => data ? visibleVehicles(data, now).filter(v => mode === "all" || v.mode === mode) : [], [data, now, mode]);
  const selected = active.find(v => v.id === selectedId);
  const inView = useMemo(() => active.filter(v => map.current?.getBounds().contains([v.lat, v.lon])), [active, viewVersion]);
  const groups = useMemo(() => map.current ? groupVehicles(inView, v => map.current!.latLngToContainerPoint([v.lat, v.lon])) : [], [inView, viewVersion]);
  const cluster = active.filter(v => clusterIds.includes(v.id));
  const closeSelection = (preserveOutsideFocus = false) => { setSelectedId(null); setClusterIds([]); requestAnimationFrame(() => { if (preserveOutsideFocus && document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest(".vehicle-card")) return; const target = returnFocus.current; (target?.isConnected ? target : filterFallback.current)?.focus(); }); };
  const select = (id: string, target: HTMLElement | null) => { returnFocus.current = target; setClusterIds([]); setSelectedId(id); setSelectionNotice(""); };
  useEffect(() => {
    if (selectedId && !active.some(v => v.id === selectedId) || clusterIds.length && !clusterIds.every(id => active.some(v => v.id === id))) {
      setSelectionNotice("Selection closed: the location expired, is unavailable or no longer matches this filter.");
      closeSelection(true);
    } else if (clusterIds.length && !groups.some(g => g.vehicles.length === clusterIds.length && g.vehicles.every(v => clusterIds.includes(v.id)))) {
      setSelectionNotice('Selection closed: map locations regrouped in this view.');
      closeSelection(true);
    }
  }, [selectedId, clusterIds, active, groups]);
  const departures = data ? visibleDepartures(data, now) : [];
  const sourceStates = data ? mapSourceStates(data, now, inView, mode) : [];
  const [nextAttempt, setNextAttempt] = useState<number | null>(null);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    let controller: AbortController | null = null, pending = false, stopped = false, nextPoll = Date.now() + 30000;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true; controller = new AbortController();
      setNextAttempt(null);
      const timeout = window.setTimeout(() => controller?.abort(), 12000);
      try {
        const value = await fetchLiveData(controller.signal);
        if (!stopped) { setData(value); setError(""); setNow(Date.now()); }
      } catch {
        if (!stopped) setError("Unable to refresh transport data. Please try again.");
      } finally { window.clearTimeout(timeout); pending = false; if (!stopped) { setLoading(false); setNextAttempt(nextPoll); } }
    };
    void load();
    const poll = window.setInterval(() => { nextPoll = Date.now() + 30000; if (!pending) setNextAttempt(nextPoll); void load(); }, 30000);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; controller?.abort(); window.clearInterval(poll); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).fitBounds(mayo);
    const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, referrerPolicy: "strict-origin-when-cross-origin", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' });
    let tileTimeout: number | undefined;
    let cycleHadError = false;
    const beginTileCycle = () => {
      window.clearTimeout(tileTimeout); setTilesLoading(true); setTileError(false); setTilesDelayed(false);
      cycleHadError = false;
      tileTimeout = window.setTimeout(() => setTilesDelayed(true), 15000);
    };
    resetTileCycle.current = () => {
      window.clearTimeout(tileTimeout); cycleHadError = false;
      setTilesLoading(false); setTileError(false); setTilesDelayed(false);
      layer.redraw();
      // Public layer DOM: completed/error images are not pending network work.
      // A redraw with an empty range emits neither loading nor load.
      const pending = [...(layer.getContainer()?.querySelectorAll<HTMLImageElement>('img.leaflet-tile') ?? [])].some(tile => !tile.complete);
      if (pending) beginTileCycle();
    };
    layer.on("loading", beginTileCycle);
    layer.on("load", () => { window.clearTimeout(tileTimeout); setTilesLoading(false); setTilesDelayed(false); setTileError(cycleHadError); });
    layer.on("tileerror", () => { cycleHadError = true; setTileError(true); });
    layer.addTo(instance); tiles.current = layer;
    map.current = instance;
    const moved = () => setViewVersion(n => n + 1);
    instance.on("moveend zoomend resize", moved); moved();
    const resizeObserver = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
    resizeObserver.observe(container.current);
    return () => { resetTileCycle.current = () => {}; window.clearTimeout(tileTimeout); resizeObserver.disconnect(); markers.current.clear(); map.current = null; tiles.current = null; layer.off(); instance.remove(); };
  }, []);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    const ids = new Set(groups.map(g => g.key));
    for (const [id, marker] of markers.current) if (!ids.has(id)) { marker.remove(); markers.current.delete(id); }
    for (const group of groups) {
      const vehicle = group.vehicles[0]!, multiple = group.vehicles.length > 1;
      const label = multiple ? `${group.vehicles.length} overlapping vehicles. Select to view the list.` : `${vehicle.label}, ${vehicle.mode === "bus" ? "GPS observation" : "reported train location"}`;
      let marker = markers.current.get(group.key);
      if (!marker) {
        // Numeric counts and fixed mode enums only; upstream labels are text attributes.
        const icon = L.divIcon({ className: `transport-marker ${multiple ? "vehicle-cluster" : `vehicle-marker vehicle-${vehicle.mode}`}`, html: multiple ? String(group.vehicles.length) : vehicle.mode === "bus" ? "B" : "T", iconSize: [44, 44], iconAnchor: [22, 22] });
        marker = L.marker([group.lat, group.lon], { icon, keyboard: true, title: label, alt: label });
        const clicked = marker;
        marker.on("keydown", event => {
          const key = (event as L.LeafletKeyboardEvent).originalEvent;
          if (key.key === "Enter" || key.key === " ") { key.preventDefault(); key.stopPropagation(); clicked.fire("click"); }
        });
        marker.on("click", () => {
          returnFocus.current = clicked.getElement() ?? null; setSelectionNotice("");
          if (multiple) { setSelectedId(null); setClusterIds(group.vehicles.map(v => v.id)); }
          else select(vehicle.id, clicked.getElement() ?? null);
        }).addTo(instance);
        markers.current.set(group.key, marker);
      } else marker.setLatLng([group.lat, group.lon]);
      const element = marker.getElement();
      element?.setAttribute("aria-label", label);
      element?.setAttribute("data-vehicle-count", String(group.vehicles.length));
      element?.setAttribute("aria-pressed", String(selectedId === vehicle.id && !multiple));
      if (element) element.title = label;
    }
  }, [groups, selectedId]);
  const locate = (vehicle: VehiclePosition, target: HTMLElement | null) => { select(vehicle.id, target); map.current?.setView([vehicle.lat, vehicle.lon], 13, { animate: false }); };
  const focusSelection = () => {
    if (selected) map.current?.setView([selected.lat, selected.lon], 13, { animate: false });
    else if (cluster.length) map.current?.fitBounds(L.latLngBounds(cluster.map(v => [v.lat, v.lon])), { padding: [48, 48], maxZoom: 17, animate: false });
  };
  return <article className="live-page">
    <div className="live-heading"><div><div className="eyebrow">OFFICIAL TRANSPORT SOURCES</div><h1>Buses &amp; trains.</h1></div><button className="button secondary" onClick={() => { setLoading(true); setRefresh(v => v + 1); resetTileCycle.current(); }} disabled={loading}>Refresh</button></div>
    <div className="live-status" role="status">
      {loading && !data ? "Loading official transport data…" : data?.mode === "snapshot" ? `Published snapshot · retrieved ${time(data.generatedAt)}` : data ? `Auto-refresh every 30s · retrieved ${time(data.generatedAt)}` : "Transport feeds unavailable."}
    </div>
    {data?.mode === "snapshot" && <p className="source-warning">These are captured official locations. Continuous live updates require the server gateway; this page does not simulate movement.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && Object.values(data.sources).some(s => s.status === "unavailable") && <p className="source-warning" role="status">Some official feeds are unavailable. No example vehicles are substituted.</p>}
    <div className="map-toolbar"><fieldset aria-label="Vehicle filter"><legend className="sr-only">Vehicle filter</legend>{(["all", "bus", "train"] as const).map(value => <button ref={value === "all" ? filterFallback : undefined} key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "all" ? "All" : value === "bus" ? "Buses" : "Trains"}</button>)}</fieldset><div><button onClick={() => map.current?.fitBounds(mayo, { animate: false })}>Mayo</button><button onClick={() => map.current?.fitBounds(ireland, { animate: false })}>Ireland</button></div></div>
    <p className="map-count" role="status">{inView.length} locations in this view · {active.length} available with this filter</p>
    {sourceStates.some(s => s.showIreland) && <button className="button secondary" onClick={() => map.current?.fitBounds(ireland, { animate: false })}>Show Ireland</button>}
    <details className="source-details"><summary>Transport source status</summary>{sourceStates.map(s => <p key={s.mode}>{s.message} Retrieved: {s.retrievedAt ? `${time(s.retrievedAt)} Ireland time` : 'no successful retrieval'}.</p>)}<p>{document.hidden ? 'Auto-refresh paused while this page is hidden.' : nextAttempt ? `Next automatic attempt: ${time(new Date(nextAttempt).toISOString())} Ireland time.` : 'Refresh in progress.'} Train observation age is unknown. Map tile loading is separate from transport feeds.</p></details>
    {selectionNotice && <p className="selection-notice" role="status">{selectionNotice}</p>}
    <div className="map-stage"><div ref={container} className="live-map" role="region" aria-label="Map of reported bus and train locations" />
    {(selected || cluster.length > 0) && <VehicleCard vehicle={selected} cluster={cluster} now={now} snapshot={data?.mode === "snapshot"} inView={!!selected && inView.some(v => v.id === selected.id)} onClose={() => closeSelection()} onSelect={v => { setSelectedId(v.id); setClusterIds([]); }} onZoom={focusSelection} />}
    </div>
    {(tilesLoading || tileError) && <p className="live-status" role="status">{tileError ? "Some map tiles could not load. Use the vehicle list or refresh to retry." : tilesDelayed ? "Map tiles are taking too long. Use the vehicle list or refresh to retry." : "Loading map…"}</p>}
    <div className="map-legend"><span><b className="bus-dot" /> Buses: timestamped observations</span><span><b className="train-dot" /> Trains: reported locations, age unknown</span></div>
    <details className="live-list"><summary>{inView.length} locations in this view · vehicle list</summary>{inView.length ? <ul>{inView.map(v => <li key={v.id}><button onClick={e => locate(v, e.currentTarget)}><strong>{v.label}</strong><span>{v.destination || (v.mode === "bus" ? "Bus" : "Train")} · {v.mode === "bus" ? `${age(v.observedAt!, now)}s ago` : "observation age unknown"}</span></button></li>)}</ul> : <p>No recent locations in this view. Try Ireland or another filter. Vehicles appear only when the source supplies valid coordinates.</p>}</details>
    <details className="live-list"><summary>Next departures · Ballina</summary>{departures.length ? <ul>{departures.slice(0, 12).map(d => <li key={d.id} className="departure-row" data-stop-id={d.stopId ?? undefined} data-trip-id={d.tripId ?? undefined}><div><strong>{d.route} · {d.destination}</strong><span>{d.stop}</span></div><div><strong>{time(d.status === "predicted" && d.expectedAt ? d.expectedAt : d.scheduledAt)}</strong><span>{departureStatusLabel(d)}</span></div></li>)}</ul> : <p>No departures are available from this source right now.</p>}</details>
    <p className="live-attribution">Bus observations and departures: <a href="https://developer.nationaltransport.ie/">NTA · CC BY 4.0</a>. Train locations: <a href="https://api.irishrail.ie/realtime/">Irish Rail</a>. Reported positions may be imprecise. Train codes are not matched to GTFS trips; location reports do not confirm boarding or arrivals.</p>
    <a className="text-link" href="#/plan">Find scheduled journeys</a>
  </article>;
}
