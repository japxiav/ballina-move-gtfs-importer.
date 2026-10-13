/** Offline open-data inspection only. No HTTP, public gateway or safety claim. */
type Point = { lat: number; lon: number };
type Tags = Record<string, string>;
type Node = Point & { id: string; tags: Tags };
type Way = { id: string; nodes: string[]; tags: Tags };
type Graph = { source: { kind: 'osm_open_data' | 'offline_fixture'; retrievedAt: string; licence: string }; nodes: Node[]; ways: Way[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v);
function point(v: unknown): v is Point & Record<string, unknown> {
  return object(v) && typeof v.lat === 'number' && typeof v.lon === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.lat >= 51 && v.lat <= 55.7 && v.lon >= -11 && v.lon <= -5;
}
const tags = (v: unknown): v is Tags => object(v) && Object.keys(v).length <= 32 && Object.entries(v).every(([k, value]) => /^[a-z_:]{1,40}$/.test(k) && typeof value === 'string' && value.length <= 120);
export function distanceMeters(a: Point, b: Point): number {
  if (!point(a) || !point(b)) throw Error('invalid_walking_coordinate');
  const rad = Math.PI / 180, lat = (b.lat - a.lat) * rad, lon = (b.lon - a.lon) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function graph(value: unknown): Graph {
  if (!object(value) || !object(value.source) || typeof value.source.kind !== 'string' || !['osm_open_data', 'offline_fixture'].includes(value.source.kind) || typeof value.source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.source.retrievedAt)) || value.source.licence !== (value.source.kind === 'osm_open_data' ? 'ODbL-1.0' : 'fixture') || !Array.isArray(value.nodes) || !Array.isArray(value.ways) || value.nodes.length > 5000 || value.ways.length > 3000) throw Error('invalid_walking_graph');
  const nodes = new Set<string>(), ways = new Set<string>(); let references = 0;
  for (const n of value.nodes) {
    if (!object(n) || !point(n) || !id(n.id) || nodes.has(n.id) || !tags(n.tags)) throw Error('invalid_walking_node');
    nodes.add(n.id);
  }
  for (const w of value.ways) {
    if (!object(w) || !id(w.id) || ways.has(w.id) || !tags(w.tags) || !Array.isArray(w.nodes) || w.nodes.length < 2) throw Error('invalid_walking_way');
    references += w.nodes.length; if (references > 15000) throw Error('walking_graph_capacity');
    if (w.nodes.some(n => !id(n) || !nodes.has(n))) throw Error('invalid_walking_way'); ways.add(w.id);
  }
  return value as unknown as Graph;
}
const allowed = (t: Tags) => (!t.access || ['yes', 'public', 'permissive', 'designated'].includes(t.access)) && !['no', 'private'].includes(t.foot ?? '');
const conditional = (t: Tags) => !!(t['access:conditional'] || t['foot:conditional']);
const passable = (n: Node) => allowed(n.tags) && !conditional(n.tags) && (!n.tags.barrier || ['entrance', 'bollard', 'cycle_barrier'].includes(n.tags.barrier) || ['yes', 'designated'].includes(n.tags.foot ?? ''));
// Directional/conditional ways stay excluded until directional routing is
// explicitly supported; never silently turn them into bidirectional paths.
const walkable = (w: Way) => allowed(w.tags) && ['footway', 'pedestrian', 'path', 'steps'].includes(w.tags.highway ?? '') && !conditional(w.tags) && (!w.tags.oneway || ['no', '0', 'false'].includes(w.tags.oneway)) && (!w.tags['oneway:foot'] || ['no', '0', 'false'].includes(w.tags['oneway:foot'])) && !w.tags['oneway:conditional'] && !w.tags['oneway:foot:conditional'] && !w.tags['foot:forward'] && !w.tags['foot:backward'];

class Heap {
  items: { id: string; at: number }[] = [];
  push(item: { id: string; at: number }) {
    let i = this.items.length; this.items.push(item);
    while (i > 0) { const p = (i - 1) >>> 1; if (this.items[p]!.at <= item.at) break; this.items[i] = this.items[p]!; i = p; }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop(); if (!first || !last || !this.items.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) { let k = i * 2 + 1; if (k + 1 < this.items.length && this.items[k + 1]!.at < this.items[k]!.at) k++; if (this.items[k]!.at >= last.at) break; this.items[i] = this.items[k]!; i = k; }
    this.items[i] = last; return first;
  }
}

export function inspectWalkingConnection(raw: unknown, from: Point, to: Point) {
  const data = graph(raw), geodesicMeters = distanceMeters(from, to);
  const base = { walkingSafe: false as const, publicEligible: false as const, physicalCrossingsVerified: false as const,
    physicalEntranceVerified: false as const, accessibilityVerified: false as const, geodesicMeters,
    sourceKind: data.source.kind, sourceRetrievedAt: data.source.retrievedAt,
    licence: data.source.licence, attribution: data.source.kind === 'osm_open_data' ? 'OpenStreetMap contributors · ODbL' : 'Offline synthetic topology fixture',
    warnings: ['Open-data topology is not a physical-access audit.', 'Stop-to-path connectors, crossings and hospital entrances are unverified.'] };
  if (geodesicMeters > 2000) return { ...base, status: 'outside_last_mile_scope' as const };
  const nodes = new Map(data.nodes.map(n => [n.id, n]));
  const edges = new Map<string, { to: string; meters: number; way: Way }[]>();
  for (const w of data.ways) if (walkable(w)) for (let i = 1; i < w.nodes.length; i++) {
    const a = nodes.get(w.nodes[i - 1]!)!, b = nodes.get(w.nodes[i]!)!;
    if (!passable(a) || !passable(b)) continue;
    const meters = distanceMeters(a, b);
    for (const [x, y] of [[a, b], [b, a]]) { const list = edges.get(x!.id) ?? []; list.push({ to: y!.id, meters, way: w }); edges.set(x!.id, list); }
  }
  const nearest = (p: Point) => {
    let best: { node: Node; meters: number } | null = null;
    for (const key of edges.keys()) { const node = nodes.get(key)!, meters = distanceMeters(p, node); if (!best || meters < best.meters || meters === best.meters && node.id < best.node.id) best = { node, meters }; }
    return best && best.meters <= 35 ? best : null;
  };
  const start = nearest(from), end = nearest(to);
  if (!start || !end) return { ...base, status: 'no_verified_connector' as const };
  const queue = new Heap(), distances = new Map([[start.node.id, 0]]), previous = new Map<string, { id: string; way: Way }>();
  queue.push({ id: start.node.id, at: 0 }); let work = 0;
  while (queue.items.length) {
    const current = queue.pop()!; if (current.at !== distances.get(current.id)) continue;
    if (current.id === end.node.id) break;
    for (const edge of edges.get(current.id) ?? []) {
      if (++work > 50000) throw Error('walking_search_capacity');
      const at = current.at + edge.meters;
      if (at > 2000 || at >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, at); previous.set(edge.to, { id: current.id, way: edge.way }); queue.push({ id: edge.to, at });
    }
  }
  const pathMeters = distances.get(end.node.id);
  if (pathMeters === undefined) return { ...base, status: 'no_open_data_path' as const };
  const route = [end.node], usedWays: Way[] = []; let current = end.node.id;
  while (current !== start.node.id) { const before = previous.get(current); if (!before) throw Error('invalid_walking_path'); usedWays.push(before.way); current = before.id; route.push(nodes.get(current)!); }
  route.reverse(); const totalMeters = pathMeters + start.meters + end.meters;
  if (totalMeters > 2000) return { ...base, status: 'outside_last_mile_scope' as const };
  return { ...base, status: 'unverified_geometry' as const, totalMeters, pathMeters,
    pathGeometry: route.map(n => ({ lat: n.lat, lon: n.lon })),
    connectors: [{ from: { lat: from.lat, lon: from.lon }, to: { lat: start.node.lat, lon: start.node.lon }, meters: start.meters, verified: false }, { from: { lat: end.node.lat, lon: end.node.lon }, to: { lat: to.lat, lon: to.lon }, meters: end.meters, verified: false }],
    mappedCrossingNodes: route.filter(n => n.tags.highway === 'crossing').length,
    mappedCrossingSegments: usedWays.filter(w => w.tags.footway === 'crossing').length,
    physicalCrossingCount: null,
    mappedSteps: usedWays.some(w => w.tags.highway === 'steps'),
    lengthOnlySecondsAt1To1point5Mps: [Math.ceil(totalMeters / 1.5), Math.ceil(totalMeters)],
    nearbyMappedEntrances: data.nodes.filter(n => n.tags.entrance && distanceMeters(n, to) <= 150).map(n => ({ id: n.id, distanceMeters: distanceMeters(n, to), hospitalAssociationVerified: false })),
    waitingAndCrossingDelaySeconds: null };
}
