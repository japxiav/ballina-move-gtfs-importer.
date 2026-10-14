import { visibleVehicles, type LiveData, type VehiclePosition } from './liveData';
export function mapSourceStates(data: LiveData, now: number, inView: VehiclePosition[], filter: 'all' | 'bus' | 'train') {
  const current = visibleVehicles(data, now);
  return (['bus', 'train'] as const).filter(mode => filter === 'all' || mode === filter).map(mode => {
    const source = data.sources[mode === 'bus' ? 'bus' : 'rail'];
    const label = mode === 'bus' ? 'Bus GPS' : 'Train reports';
    const national = current.filter(v => v.mode === mode).length, local = inView.filter(v => v.mode === mode).length;
    const expired = data.vehicles.some(v => v.mode === mode) && !national;
    const future = data.vehicles.some(v => v.mode === mode && Date.parse(v.observedAt ?? v.retrievedAt) > now + 15000);
    const message = source.status === 'unavailable' ? `${label} feed unavailable.` : source.status === 'empty' ? `No ${mode === 'bus' ? 'recent bus GPS' : 'train reports'} supplied by the source.` : expired ? mode === 'bus' ? 'Bus GPS expired; waiting for a fresh source observation.' : 'Train report retrieval expired; waiting for a fresh retrieval. Observation age is unknown.' : !national ? `No ${mode === 'bus' ? 'recent bus GPS' : 'train reports'} supplied by the source.` : !local ? `No ${mode === 'bus' ? 'recent bus GPS' : 'train reports'} in this view · ${national} available across Ireland.` : `${local} ${mode === 'bus' ? 'bus GPS observations' : 'train reports'} in this view · ${national} across Ireland.`;
    return { mode, message: source.status === 'ready' && !national && future ? `${label} timestamp is unconfirmed; waiting for a valid source timestamp.` : message, retrievedAt: source.retrievedAt, showIreland: national > 0 && local === 0 };
  });
}
