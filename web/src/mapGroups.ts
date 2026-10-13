import type { VehiclePosition } from './liveData';

export interface VehicleGroup { key: string; vehicles: VehiclePosition[]; lat: number; lon: number }
// Screen-space connected components. Neighbouring grid cells are compared,
// so markers on a cell boundary cannot obscure one another. No trip matching.
export function groupVehicles(vehicles: VehiclePosition[], project: (v: VehiclePosition) => { x: number; y: number }, spacing = 48): VehicleGroup[] {
  const ordered = [...vehicles].sort((a, b) => a.id.localeCompare(b.id));
  const points = ordered.map(project), parents = ordered.map((_, i) => i), cells = new Map<string, number[]>();
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]!]!; i = parents[i]!; } return i; };
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / spacing), cy = Math.floor(p.y / spacing);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const q = points[other]!;
        if (Math.hypot(p.x - q.x, p.y - q.y) <= spacing) parents[root(i)] = root(other);
      }
    }
    const key = `${cx},${cy}`; cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  const grouped = new Map<number, VehiclePosition[]>();
  ordered.forEach((v, i) => { const r = root(i); grouped.set(r, [...(grouped.get(r) ?? []), v]); });
  // A centroid could overlap a separate component (e.g. a ring around one bus).
  // A real member anchor keeps separate components at least spacing pixels apart.
  return [...grouped.values()].map(members => ({ key: JSON.stringify(members.map(v => v.id)), vehicles: members, lat: members[0]!.lat, lon: members[0]!.lon }));
}
