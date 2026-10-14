export interface VehiclePosition {
  id: string;
  mode: "bus" | "train";
  label: string;
  destination: string;
  lat: number;
  lon: number;
  observedAt: string | null;
  retrievedAt: string;
  quality: "gps_observation" | "reported_location";
  source: "nta" | "irish_rail";
  service?: { routeId: string | null; tripId: string | null; operator: string | null; directionId: 0 | 1 | null; mappingStatus: 'exact_trip' | 'route_only' | 'unmapped' | 'unknown'; linkage: 'source_reported_unverified'; source: 'get_live_vehicles' };
}
export interface Departure {
  id: string;
  stop: string;
  route: string;
  destination: string;
  scheduledAt: string;
  expectedAt: string | null;
  predictionObservedAt: string | null;
  predictionState?: "none" | "fresh" | "expired" | "unconfirmed";
  cancellationObservedAt?: string | null;
  skippingObservedAt?: string | null;
  stopId?: string | null;
  tripId?: string | null;
  status: "scheduled" | "predicted" | "cancelled" | "cancellation_unconfirmed" | "skipped" | "skipping_unconfirmed" | "no_data";
}
export interface LiveData {
  version: 1 | 2;
  mode: "live" | "snapshot";
  generatedAt: string;
  collectorHealthy: boolean;
  sources: Record<"bus" | "rail" | "departures", { status: "ready" | "empty" | "unavailable"; retrievedAt: string | null }>;
  vehicles: VehiclePosition[];
  departures: Departure[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string" && v.length <= 200;
const date = (v: unknown): v is string => string(v) && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const includes = (values: string[], v: unknown) => typeof v === "string" && values.includes(v);

export function decodeLiveData(value: unknown): LiveData {
  if (!object(value) || ![1, 2].includes(value.version as number) || !includes(["live", "snapshot"], value.mode) || !date(value.generatedAt) || typeof value.collectorHealthy !== "boolean" || !object(value.sources) || !Array.isArray(value.vehicles) || value.vehicles.length > 550 || !Array.isArray(value.departures) || value.departures.length > 30)
    throw Error("Invalid live-data response.");
  for (const key of ["bus", "rail", "departures"]) {
    const source = value.sources[key];
    if (!object(source) || !includes(["ready", "empty", "unavailable"], source.status) || !nullableDate(source.retrievedAt)) throw Error("Invalid source status.");
  }
  const ids = new Set<string>();
  for (const v of value.vehicles) {
    if (!object(v) || !string(v.id) || !v.id || ids.has(v.id) || !string(v.label) || !string(v.destination) || typeof v.lat !== "number" || typeof v.lon !== "number" || !Number.isFinite(v.lat) || !Number.isFinite(v.lon) || v.lat < 51 || v.lat > 55.7 || v.lon < -11 || v.lon > -5 || !date(v.retrievedAt) || !nullableDate(v.observedAt)) throw Error("Invalid vehicle position.");
    if (!(v.mode === "bus" && v.source === "nta" && v.quality === "gps_observation" && date(v.observedAt)) && !(v.mode === "train" && v.source === "irish_rail" && v.quality === "reported_location" && v.observedAt === null)) throw Error("Invalid position provenance.");
    ids.add(v.id);
    if (v.service !== undefined) {
      const s = v.service, identifier = (id: unknown) => id === null || typeof id === 'string' && /^[A-Za-z0-9_ .:-]{1,120}$/.test(id);
      if (value.version !== 2 || v.mode !== 'bus' || !object(s) || !identifier(s.routeId) || !identifier(s.tripId) || !(s.operator === null || typeof s.operator === 'string' && s.operator.length >= 1 && s.operator.length <= 160 && !/[\x00-\x1f\x7f]/.test(s.operator)) || ![null, 0, 1].includes(s.directionId as null | number) || !includes(['exact_trip', 'route_only', 'unmapped', 'unknown'], s.mappingStatus) || s.mappingStatus !== 'exact_trip' && s.tripId !== null || s.linkage !== 'source_reported_unverified' || s.source !== 'get_live_vehicles') throw Error('Invalid reported service reference.');
    }
  }
  const departureIds = new Set<string>();
  for (const d of value.departures) {
    if (!object(d) || !string(d.id) || !string(d.stop) || !string(d.route) || !string(d.destination) || !date(d.scheduledAt) || !nullableDate(d.expectedAt) || !nullableDate(d.predictionObservedAt) || !includes(value.version === 2 ? ["scheduled", "predicted", "cancelled", "skipped", "no_data"] : ["scheduled", "predicted", "cancelled"], d.status) || d.status === "predicted" && (!date(d.expectedAt) || !date(d.predictionObservedAt))) throw Error("Invalid departure.");
    if (d.cancellationObservedAt !== undefined && !nullableDate(d.cancellationObservedAt) || d.status === "cancelled" && (d.expectedAt !== null || d.predictionObservedAt !== null) || d.status !== "cancelled" && d.cancellationObservedAt != null) throw Error("Invalid departure.");
    if (d.skippingObservedAt !== undefined && !nullableDate(d.skippingObservedAt) || d.status !== "skipped" && d.skippingObservedAt != null || ["skipped", "no_data"].includes(d.status as string) && (d.expectedAt !== null || d.predictionObservedAt !== null)) throw Error("Invalid departure state.");
    if (departureIds.has(d.id as string)) throw Error('Duplicate departure identity.');
    departureIds.add(d.id as string);
    if (value.version === 2 && (!/^departure:[a-f0-9]{64}$/.test(d.id as string) || [d.stopId, d.tripId].some(id => !(typeof id === "string" && /^[A-Za-z0-9_ .:-]{1,120}$/.test(id))))) throw Error("Invalid departure identity.");
    if (value.version === 2 && (!includes(['none', 'fresh', 'expired', 'unconfirmed'], d.predictionState) || (d.status === 'predicted') !== (d.predictionState === 'fresh') || ['cancelled', 'skipped', 'no_data'].includes(d.status as string) && d.predictionState !== 'none')) throw Error('Invalid prediction freshness.');
  }
  return value as unknown as LiveData;
}

export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw Error("Live data is unavailable.");
  const reader = response.body.getReader(), body = new Uint8Array(1_048_576);
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.byteLength > body.length) throw Error("Live-data response too large.");
      body.set(next.value, size);
      size += next.value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, size)));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function fetchLiveData(signal: AbortSignal): Promise<LiveData> {
  // Same origin only. No apikey, JWT, private endpoint, cookies or user location.
  const gateway = new URL("api/live", window.location.href);
  const response = await fetch(gateway, { signal, credentials: "omit", cache: "no-store", redirect: "error" });
  if (response.status !== 404) return decodeLiveData(await boundedJson(response));
  // Static Pages can show a real published capture, explicitly marked snapshot.
  const snapshot = new URL("live-data.json", window.location.href);
  snapshot.searchParams.set("v", String(Math.floor(Date.now() / 30000)));
  const captured = decodeLiveData(await boundedJson(await fetch(snapshot, { signal, credentials: "omit", cache: "no-store", redirect: "error" })));
  if (captured.mode !== "snapshot") throw Error("Invalid published snapshot.");
  return captured;
}

export function visibleVehicles(data: LiveData, now: number): VehiclePosition[] {
  return data.vehicles.filter(v => {
    if (data.sources[v.mode === "bus" ? "bus" : "rail"].status !== "ready") return false;
    const age = (now - Date.parse(v.observedAt ?? v.retrievedAt)) / 1000;
    // Reported rail locations have unknown observation age; this only bounds
    // how long we retain the retrieved report, not a claim about GPS freshness.
    return age >= -15 && age <= (v.mode === "bus" ? 180 : data.mode === "snapshot" ? 3600 : 90);
  });
}

export function visibleDepartures(data: LiveData, now: number): Departure[] {
  if (data.sources.departures.status !== "ready") return [];
  return data.departures.map(d => {
    if (d.status === "cancelled") {
      const age = d.cancellationObservedAt ? (now - Date.parse(d.cancellationObservedAt)) / 1000 : Infinity;
      if (age < -15 || age > 180) return { ...d, status: "cancellation_unconfirmed" as const, expectedAt: null, predictionObservedAt: null };
    }
    if (d.status === "skipped") {
      const age = d.skippingObservedAt ? (now - Date.parse(d.skippingObservedAt)) / 1000 : Infinity;
      if (age < -15 || age > 180) return { ...d, status: "skipping_unconfirmed" as const, expectedAt: null, predictionObservedAt: null };
    }
    const age = d.predictionObservedAt ? (now - Date.parse(d.predictionObservedAt)) / 1000 : Infinity;
    // A captured prediction must expire even when a static snapshot is unchanged.
    if (d.status === "predicted" && (age < -15 || age > 180))
      return { ...d, status: "scheduled" as const, predictionState: age > 180 ? 'expired' as const : 'unconfirmed' as const, expectedAt: null, predictionObservedAt: null };
    return d;
  }).filter(d => Date.parse(d.status === "predicted" ? d.expectedAt! : d.scheduledAt) >= now - 120000);
}

export function departureStatusLabel(departure: Departure): string {
  if (departure.status === 'scheduled' && departure.predictionState === 'expired') return 'Scheduled · prediction expired';
  if (departure.status === 'scheduled' && departure.predictionState === 'unconfirmed') return 'Scheduled · prediction unconfirmed';
  return { scheduled: 'Scheduled', predicted: 'Prediction', cancelled: 'Cancelled', cancellation_unconfirmed: 'Cancellation unconfirmed · check operator', skipped: 'Stop skipped · do not board here', skipping_unconfirmed: 'Stop skip unconfirmed · check operator', no_data: 'Scheduled · no realtime data' }[departure.status];
}
