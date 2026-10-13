import React, { useEffect, useRef } from 'react';
import type { VehiclePosition } from './liveData';

const time = (date: string) => new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Dublin' }).format(new Date(date));
export const observationAge = (date: string, now: number) => Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
export function VehicleCard({ vehicle, cluster, now, snapshot, inView, onClose, onSelect, onZoom }: { vehicle?: VehiclePosition; cluster: VehiclePosition[]; now: number; snapshot: boolean; inView: boolean; onClose: () => void; onSelect: (v: VehiclePosition) => void; onZoom: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const identity = vehicle?.id ?? JSON.stringify(cluster.map(v => v.id));
  useEffect(() => {
    const panel = heading.current?.closest('.vehicle-card');
    const rect = panel?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, [identity]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return <section className="vehicle-card" role="region" aria-label={vehicle ? 'Selected vehicle' : 'Vehicles in this group'}>
    <div className="vehicle-card-heading"><div><span className="eyebrow">{vehicle ? vehicle.mode === 'bus' ? 'BUS LOCATION' : 'TRAIN LOCATION' : 'OVERLAPPING LOCATIONS'}</span><h2 ref={heading} tabIndex={-1}>{vehicle?.label || `${cluster.length} vehicles`}</h2></div><button type="button" className="vehicle-close" aria-label="Close vehicle details" onClick={onClose}>×</button></div>
    {vehicle ? <>
      <p className="vehicle-destination">{vehicle.destination ? `Reported direction: ${vehicle.destination}` : 'Direction not supplied'}</p>
      <p className={`vehicle-quality ${vehicle.mode === 'bus' ? 'quality-gps' : 'quality-reported'}`}>{vehicle.mode === 'bus' ? `${snapshot ? 'Captured GPS' : 'GPS observation'} · ${observationAge(vehicle.observedAt!, now)}s ago` : 'Reported train location · observation age unknown'}</p>
      {vehicle.mode === 'train' && <p className="vehicle-caveat">Position observation time and precision are not supplied.</p>}
      <dl className="vehicle-facts"><div><dt>Source</dt><dd>{vehicle.source === 'nta' ? 'NTA' : 'Irish Rail'}</dd></div><div><dt>Retrieved</dt><dd>{time(vehicle.retrievedAt)} · Ireland time</dd></div><div><dt>Coordinates</dt><dd>{vehicle.lat.toFixed(5)}, {vehicle.lon.toFixed(5)}</dd></div></dl>
      {!inView && <p className="vehicle-caveat">This location is outside the current map view.</p>}
      <button className="button secondary" type="button" onClick={onZoom}>Focus on map</button>
      <details className="vehicle-unavailable"><summary>Service details</summary><p>Operator, exact service, stops and route path are not supplied by this location feed. Times, delay and cancellation are unknown for this vehicle. Location reports do not confirm boarding or arrival.</p></details>
    </> : <><p>Select a vehicle, or zoom to separate its marker.</p><ul className="cluster-vehicles">{cluster.map(v => <li key={v.id}><button type="button" onClick={() => onSelect(v)}><strong>{v.label}</strong><span>{v.mode === 'bus' ? 'Bus · GPS observation' : 'Train · reported location'}{v.destination ? ` · ${v.destination}` : ''}</span></button></li>)}</ul><button className="button secondary" type="button" onClick={onZoom}>Zoom to group</button></>}
  </section>;
}
