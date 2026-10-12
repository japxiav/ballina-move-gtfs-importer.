import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchLiveData, visibleVehicles, visibleDepartures, type LiveData, type VehiclePosition } from "./liveData";

const time = (date: string) => new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).format(new Date(date));
const age = (date: string, now: number) => Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
const mayo = L.latLngBounds([[53.7, -9.95], [54.4, -8.5]]);
const ireland = L.latLngBounds([[51.35, -10.7], [55.45, -5.4]]);

export function LiveMap() {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), markers = useRef(new Map<string, L.Marker>());
  const tiles = useRef<L.TileLayer | null>(null);
  const [tilesLoading, setTilesLoading] = useState(true), [tileError, setTileError] = useState(false);
  const [data, setData] = useState<LiveData | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState<"all" | "bus" | "train">("all"), [selectedId, setSelectedId] = useState<string | null>(null);
  const active = useMemo(() => data ? visibleVehicles(data, now).filter(v => mode === "all" || v.mode === mode) : [], [data, now, mode]);
  const selected = active.find(v => v.id === selectedId);
  const departures = data ? visibleDepartures(data, now) : [];
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    let controller: AbortController | null = null, pending = false, stopped = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true; controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 12000);
      try {
        const value = await fetchLiveData(controller.signal);
        if (!stopped) { setData(value); setError(""); setNow(Date.now()); }
      } catch {
        if (!stopped) setError("Unable to refresh transport data. Please try again.");
      } finally { window.clearTimeout(timeout); pending = false; if (!stopped) setLoading(false); }
    };
    void load();
    const poll = window.setInterval(() => { void load(); }, 30000);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; controller?.abort(); window.clearInterval(poll); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false, attributionControl: true }).fitBounds(mayo);
    const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, referrerPolicy: "strict-origin-when-cross-origin", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' });
    layer.on("loading", () => { setTilesLoading(true); setTileError(false); });
    layer.on("load", () => setTilesLoading(false));
    layer.on("tileerror", () => setTileError(true));
    layer.addTo(instance); tiles.current = layer;
    map.current = instance;
    return () => { markers.current.clear(); map.current = null; tiles.current = null; layer.off(); instance.remove(); };
  }, []);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    const ids = new Set(active.map(v => v.id));
    for (const [id, marker] of markers.current) if (!ids.has(id)) { marker.remove(); markers.current.delete(id); }
    for (const vehicle of active) {
      let marker = markers.current.get(vehicle.id);
      if (!marker) {
        // Icon HTML is a fixed enum; upstream text is never inserted as HTML.
        const icon = L.divIcon({ className: `vehicle-marker vehicle-${vehicle.mode}`, html: vehicle.mode === "bus" ? "B" : "T", iconSize: [44, 44], iconAnchor: [22, 22] });
        marker = L.marker([vehicle.lat, vehicle.lon], { icon, keyboard: true, title: vehicle.label, alt: vehicle.label });
        marker.on("click", () => setSelectedId(vehicle.id)).addTo(instance);
        markers.current.set(vehicle.id, marker);
      } else marker.setLatLng([vehicle.lat, vehicle.lon]);
      const element = marker.getElement();
      element?.setAttribute("aria-label", `${vehicle.label}, ${vehicle.mode === "bus" ? "GPS observation" : "reported train location"}`);
      if (element) element.title = vehicle.label;
    }
  }, [active]);
  const locate = (vehicle: VehiclePosition) => { setSelectedId(vehicle.id); map.current?.setView([vehicle.lat, vehicle.lon], 13); };
  return <article className="live-page">
    <div className="live-heading"><div><div className="eyebrow">OFFICIAL TRANSPORT SOURCES</div><h1>Buses &amp; trains.</h1></div><button className="button secondary" onClick={() => { setLoading(true); setRefresh(v => v + 1); tiles.current?.redraw(); }} disabled={loading}>Refresh</button></div>
    <div className="live-status" role="status">
      {loading && !data ? "Loading official transport data…" : data?.mode === "snapshot" ? `Published snapshot · retrieved ${time(data.generatedAt)}` : data ? `Auto-refresh every 30s · retrieved ${time(data.generatedAt)}` : "Transport feeds unavailable."}
    </div>
    {data?.mode === "snapshot" && <p className="source-warning">These are captured official locations. Continuous live updates require the server gateway; this page does not simulate movement.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && Object.values(data.sources).some(s => s.status === "unavailable") && <p className="source-warning" role="status">Some official feeds are unavailable. No example vehicles are substituted.</p>}
    <div className="map-toolbar"><fieldset aria-label="Vehicle filter"><legend className="sr-only">Vehicle filter</legend>{(["all", "bus", "train"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "all" ? "All" : value === "bus" ? "Buses" : "Trains"}</button>)}</fieldset><div><button onClick={() => map.current?.fitBounds(mayo)}>Mayo</button><button onClick={() => map.current?.fitBounds(ireland)}>Ireland</button></div></div>
    <div ref={container} className="live-map" role="region" aria-label="Map of reported bus and train locations" />
    {(tilesLoading || tileError) && <p className="live-status" role="status">{tileError ? "Some map tiles could not load. Use the vehicle list or refresh to retry." : "Loading map…"}</p>}
    <div className="map-legend"><span><b className="bus-dot" /> Buses: timestamped observations</span><span><b className="train-dot" /> Trains: reported locations, age unknown</span></div>
    {selected && <section className="position-detail" aria-label="Selected vehicle"><div><strong>{selected.label}</strong><span>{selected.destination}</span></div><p>{selected.mode === "bus" ? `Observed ${age(selected.observedAt!, now)}s ago · ${data?.mode === "snapshot" ? "captured GPS" : "GPS observation"}` : "Reported by Irish Rail. Position observation time and precision are not supplied."}</p><small>{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)} · retrieved {time(selected.retrievedAt)}</small></section>}
    <details className="live-list"><summary>{active.length} available locations · vehicle list</summary>{active.length ? <ul>{active.map(v => <li key={v.id}><button onClick={() => locate(v)}><strong>{v.label}</strong><span>{v.destination || (v.mode === "bus" ? "Bus" : "Train")} · {v.mode === "bus" ? `${age(v.observedAt!, now)}s ago` : "observation age unknown"}</span></button></li>)}</ul> : <p>No recent locations match this filter. Vehicles are shown only when the source provides valid coordinates.</p>}</details>
    <details className="live-list"><summary>Next departures · Ballina</summary>{departures.length ? <ul>{departures.slice(0, 12).map(d => <li key={d.id} className="departure-row"><div><strong>{d.route} · {d.destination}</strong><span>{d.stop}</span></div><div><strong>{time(d.status === "predicted" && d.expectedAt ? d.expectedAt : d.scheduledAt)}</strong><span>{d.status === "cancelled" ? "Cancelled" : d.status === "predicted" ? "Prediction" : "Scheduled"}</span></div></li>)}</ul> : <p>No departures are available from this source right now.</p>}</details>
    <p className="live-attribution">Bus observations and departures: <a href="https://developer.nationaltransport.ie/">NTA · CC BY 4.0</a>. Train locations: <a href="https://api.irishrail.ie/realtime/">Irish Rail</a>. Reported positions may be imprecise. Train codes are not matched to GTFS trips; location reports do not confirm boarding or arrivals.</p>
    <a className="text-link" href="#/">Journey search demo</a>
  </article>;
}
