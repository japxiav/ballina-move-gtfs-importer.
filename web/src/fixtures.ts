import type {
  Journey,
  Leg,
  BoardingInstruction,
} from "../../routing/src/types";

// Type-only imports keep server adapters and credentials outside the browser bundle.
// Every time, walk and route below is synthetic. This is NOT an active GTFS snapshot.
export const places = [
  {
    id: "ballina",
    name: "Ballina",
    stop: "Ballina Bus Station",
    code: "DEMO-BAL",
    lat: 54.111,
    lon: -9.1599,
  },
  {
    id: "foxford",
    name: "Foxford",
    stop: "Foxford · centro",
    code: "DEMO-FOX",
    lat: 53.9815,
    lon: -9.1114,
  },
  {
    id: "castlebar",
    name: "Castlebar",
    stop: "Castlebar · centro",
    code: "DEMO-CAS",
    lat: 53.856,
    lon: -9.298,
  },
  {
    id: "hospital",
    name: "Mayo Hospital",
    stop: "Mayo University Hospital",
    code: "DEMO-HOS",
    lat: 53.849,
    lon: -9.302,
  },
] as const;
export type PlaceId = (typeof places)[number]["id"];
export type Preference = "fastest" | "less_walking" | "fewest_transfers";
export type DemoState = "normal" | "empty" | "error";
export interface SearchQuery {
  origin: PlaceId;
  destination: PlaceId;
  serviceDate: string;
  departAt: string;
  prioritize: Preference;
  maxWalkingMeters: number;
  demoState: DemoState;
}
export interface DemoJourney extends Journey {
  id: string;
  label: string;
  demo: true; // Mandatory explicit provenance for the view model.
}
export const place = (id: PlaceId) => places.find((p) => p.id === id)!;
export const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
export const validTime = (time: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export function dublinToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const defaultQuery = (): SearchQuery => ({
  origin: "ballina",
  destination: "foxford",
  serviceDate: dublinToday(),
  departAt: "09:15",
  prioritize: "fastest",
  maxWalkingMeters: 1500,
  demoState: "normal",
});
export function encodeQuery(query: SearchQuery): string {
  return new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  ).toString();
}
export function decodeQuery(search: string): SearchQuery | null {
  const p = new URLSearchParams(search),
    origin = p.get("origin"),
    destination = p.get("destination");
  const serviceDate = p.get("serviceDate") ?? "",
    departAt = p.get("departAt") ?? "";
  const prioritize = p.get("prioritize"),
    demoState = p.get("demoState"),
    maxWalkingMeters = Number(p.get("maxWalkingMeters"));
  if (
    !places.some((p) => p.id === origin) ||
    !places.some((p) => p.id === destination) ||
    !validDate(serviceDate) ||
    !validTime(departAt) ||
    !["fastest", "less_walking", "fewest_transfers"].includes(
      prioritize ?? "",
    ) ||
    !["normal", "empty", "error"].includes(demoState ?? "") ||
    ![500, 1000, 1500, 2500].includes(maxWalkingMeters)
  )
    return null;
  return {
    origin: origin as PlaceId,
    destination: destination as PlaceId,
    serviceDate,
    departAt,
    prioritize: prioritize as Preference,
    maxWalkingMeters,
    demoState: demoState as DemoState,
  };
}
export function clock(seconds: number): string {
  const s = ((seconds % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
}
export const daySuffix = (seconds: number) =>
  seconds >= 86400 ? ` (+${Math.floor(seconds / 86400)} dia)` : "";
export const minutes = (seconds: number) => Math.ceil(seconds / 60);
export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
function boarding(id: PlaceId): BoardingInstruction {
  const p = place(id);
  return {
    stopId: p.code,
    stopCode: p.code,
    stopName: p.stop,
    coordinate: { lat: p.lat, lon: p.lon },
    locationConfidence: "official_unverified",
    sideOfStreet: null,
    platform: null,
    notes: "Parada ilustrativa da demonstração.",
    caveat: "Ponto de embarque, acessibilidade e lado da rua não verificados.",
  };
}
function walk(
  purpose: "access" | "egress",
  distance: number,
  seconds: number,
): Leg {
  // No fictional path geometry; demo distances are labels, never navigable roads.
  return {
    type: "walk",
    purpose,
    from: { lat: 0, lon: 0 },
    to: { lat: 0, lon: 0 },
    durationSeconds: seconds,
    distanceMeters: distance,
    geometry: [],
    provider: "synthetic_web_fixture_only",
  };
}
export function fixtureJourneys(q: SearchQuery): DemoJourney[] {
  if (q.origin === q.destination || q.demoState === "empty") return [];
  const departure =
    Number(q.departAt.slice(0, 2)) * 3600 + Number(q.departAt.slice(3)) * 60;
  const rideMinutes =
    q.destination === "foxford" || q.origin === "foxford" ? 18 : 48;
  const variants = [
    {
      id: "direct",
      label: "Chegue mais cedo",
      wait: 10,
      ride: rideMinutes,
      access: 260,
      egress: 180,
      transfers: 0,
      route: "22",
    },
    {
      id: "less-walking",
      label: "Menos caminhada",
      wait: 22,
      ride: rideMinutes + 6,
      access: 80,
      egress: 60,
      transfers: 0,
      route: "420",
    },
    {
      id: "connection",
      label: "Outra possibilidade",
      wait: 28,
      ride: rideMinutes + 18,
      access: 380,
      egress: 240,
      transfers: 1,
      route: "445",
    },
  ];
  const journeys: DemoJourney[] = variants.map((v) => {
    const accessSeconds = Math.ceil(v.access / 70) * 60,
      egressSeconds = Math.ceil(v.egress / 70) * 60;
    const board = departure + v.wait * 60,
      alight = board + v.ride * 60;
    const ride = (
      routeName: string,
      from: PlaceId,
      to: PlaceId,
      start: number,
      end: number,
    ): Leg => ({
      type: "ride",
      mode: "bus",
      tripId: `DEMO-${v.id}-${routeName}`,
      routeId: `DEMO-${routeName}`,
      routeName,
      headsign: place(to).name,
      boardStopId: place(from).code,
      alightStopId: place(to).code,
      boardAtSeconds: start,
      alightAtSeconds: end,
      boardAtServiceSeconds: start,
      alightAtServiceSeconds: end,
      boardDayOffset: Math.floor(start / 86400),
      alightDayOffset: Math.floor(end / 86400),
      serviceDate: q.serviceDate,
    });
    // A different demo interchange ensures the transfer doesn't repeat the origin/destination.
    const interchange: PlaceId = places.find(
      (p) => p.id !== q.origin && p.id !== q.destination,
    )!.id;
    const legs: Leg[] = [walk("access", v.access, accessSeconds)];
    if (v.transfers) {
      const midpoint = board + Math.floor(v.ride / 2) * 60;
      legs.push(
        ride(v.route, q.origin, interchange, board, midpoint - 6 * 60),
        ride("420", interchange, q.destination, midpoint, alight),
      );
    } else legs.push(ride(v.route, q.origin, q.destination, board, alight));
    legs.push(walk("egress", v.egress, egressSeconds));
    return {
      id: v.id,
      label: v.label,
      demo: true,
      feedVersion: "synthetic-web-demo-v1",
      serviceDate: q.serviceDate,
      departureAtSeconds: departure,
      latestLeaveAtSeconds: board - accessSeconds - 120,
      arrivalAtSeconds: alight + egressSeconds,
      transfers: v.transfers,
      walkingMeters: v.access + v.egress,
      predictionType: "scheduled",
      legs,
      boardings: v.transfers
        ? [boarding(q.origin), boarding(interchange)]
        : [boarding(q.origin)],
    };
  });
  return journeys
    .filter((j) => j.walkingMeters <= q.maxWalkingMeters)
    .sort((a, b) =>
      q.prioritize === "less_walking"
        ? a.walkingMeters - b.walkingMeters
        : q.prioritize === "fewest_transfers"
          ? a.transfers - b.transfers || a.arrivalAtSeconds - b.arrivalAtSeconds
          : a.arrivalAtSeconds - b.arrivalAtSeconds,
    );
}
export interface JourneyService {
  search(query: SearchQuery, signal: AbortSignal): Promise<DemoJourney[]>;
}
// Replace this boundary with a safe gateway client only after its public contract is reviewed.
// Never import routing's Supabase/Stadia server adapters into the frontend.
export const fixtureService: JourneyService = {
  async search(query, signal) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 650);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    if (query.demoState === "error")
      throw new Error("fixture_service_unavailable");
    return fixtureJourneys(query);
  },
};
