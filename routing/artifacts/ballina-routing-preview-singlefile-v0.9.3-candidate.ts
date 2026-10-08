import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Generated locally from src/*.ts. Do not edit by hand.
// Module functions are compiled TypeScript, not runtime eval or dynamic imports.
const __ballinaModules = {
  './boarding': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boardingInstruction = boardingInstruction;
exports.proximityMeters = proximityMeters;
exports.routableStopCoordinate = routableStopCoordinate;
function boardingInstruction(stop) {
    const conf = stop.boarding?.confidence === 'verified' && !!stop.boarding.sourceUrl && !!stop.boarding.verifiedAt
        ? 'verified' : 'official_unverified';
    return {
        stopId: stop.id, stopCode: stop.code ?? null, stopName: stop.name,
        coordinate: { lat: stop.lat, lon: stop.lon }, locationConfidence: conf,
        sideOfStreet: conf === 'verified' ? stop.boarding?.sideOfStreet ?? null : null,
        platform: conf === 'verified' ? stop.boarding?.platform ?? null : null,
        notes: conf === 'verified' ? stop.boarding?.note ?? null : null,
        caveat: conf === 'verified' ? null : 'Stop coordinates from GTFS; correct sidewalk or boarding bay not independently verified.'
    };
}
function proximityMeters(a, b) {
    const r = 6371000;
    const dlat = (b.lat - a.lat) * Math.PI / 180;
    const dlon = (b.lon - a.lon) * Math.PI / 180;
    const t = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(t)));
}
/** Only a sourced, dated review may redirect the pedestrian route away from the official coordinate. */
function routableStopCoordinate(stop) {
    if (stop.boarding?.confidence === 'verified' && stop.boarding.sourceUrl && stop.boarding.verifiedAt && stop.boarding.boardingPoint) {
        return { lat: stop.boarding.boardingPoint.lat, lon: stop.boarding.boardingPoint.lon };
    }
    return { lat: stop.lat, lon: stop.lon };
}

  },
  './boardingEvidence': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyBoardingEvidence = applyBoardingEvidence;
exports.journeyBoardingDetails = journeyBoardingDetails;
const boarding_1 = require("./boarding");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validPoint = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
function validateEvidence(e) {
    const timestamp = datePattern.test(e.verifiedAt) ? Date.parse(e.verifiedAt + 'T00:00:00Z') : NaN;
    if (!e.stopId || !e.feedVersion || !e.reviewer?.trim() || !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== e.verifiedAt || timestamp > Date.now()) {
        throw new Error('boarding_invalid_evidence');
    }
    const url = (() => { try {
        return new URL(e.sourceUrl);
    }
    catch {
        return null;
    } })();
    if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password)
        throw new Error('boarding_invalid_source');
    if (e.boardingPoint && !validPoint(e.boardingPoint))
        throw new Error('boarding_invalid_coordinate');
}
/** A reviewed annotation is applied only to the GTFS version it was reviewed against. */
function applyBoardingEvidence(data, evidence) {
    const known = new Set(data.stops.map(s => s.id));
    const annotated = new Map();
    const byStop = new Map(data.stops.map(s => [s.id, s]));
    for (const e of evidence) {
        validateEvidence(e);
        if (e.feedVersion !== data.feedVersion)
            continue; // stale reviews cannot silently survive GTFS refresh
        if (!known.has(e.stopId))
            throw new Error('boarding_unknown_stop');
        if (annotated.has(e.stopId))
            throw new Error('boarding_duplicate_evidence');
        const stop = byStop.get(e.stopId);
        if (e.boardingPoint && (0, boarding_1.proximityMeters)(stop, e.boardingPoint) > 75)
            throw new Error('boarding_override_too_far_from_gtfs');
        annotated.set(e.stopId, e);
    }
    return { ...data, stops: data.stops.map(s => {
            const e = annotated.get(s.id);
            if (!e)
                return { ...s, boarding: { confidence: 'official_unverified' } };
            return { ...s, boarding: { confidence: 'verified',
                    sideOfStreet: e.sideOfStreet, platform: e.platform, note: e.accessNote,
                    boardingPoint: e.boardingPoint, sourceUrl: e.sourceUrl, verifiedAt: e.verifiedAt } };
        }) };
}
/** Keep the pedestrian arrival aligned with the separately verified boarding point. */
function verifiedBoardingPoint(stop) {
    return stop.boarding?.confidence === 'verified' && stop.boarding.sourceUrl && stop.boarding.verifiedAt && stop.boarding.boardingPoint
        ? stop.boarding.boardingPoint : { lat: stop.lat, lon: stop.lon };
}
/** These details drive the future "Where do I catch the bus?" card in the webapp. */
function journeyBoardingDetails(journey, stops) {
    const known = new Map(stops.map(s => [s.id, s]));
    const out = [];
    for (let i = 0; i < journey.legs.length; i++) {
        const leg = journey.legs[i];
        if (leg.type !== 'ride')
            continue;
        const stop = known.get(leg.boardStopId);
        if (!stop)
            throw new Error('boarding_stop_missing');
        const instruction = (0, boarding_1.boardingInstruction)(stop);
        const walk = journey.legs[i - 1];
        const relevantWalk = walk?.type === 'walk' && walk.purpose !== 'egress'
            && (0, boarding_1.proximityMeters)(walk.to, verifiedBoardingPoint(stop)) <= 25 ? walk : null;
        const verified = instruction.locationConfidence === 'verified' && !!stop.boarding?.sourceUrl;
        out.push({ ...instruction,
            boardingPoint: verified && stop.boarding?.boardingPoint ? stop.boarding.boardingPoint : { lat: stop.lat, lon: stop.lon },
            boardingPointSource: verified && stop.boarding?.boardingPoint ? 'verified_override' : 'official_gtfs',
            evidenceSourceUrl: verified ? stop.boarding?.sourceUrl ?? null : null,
            evidenceVerifiedAt: verified ? stop.boarding?.verifiedAt ?? null : null,
            walkingDistanceMeters: relevantWalk?.distanceMeters ?? null,
            walkingDurationSeconds: relevantWalk?.durationSeconds ?? null,
        });
    }
    return out;
}

  },
  './connections': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.journeyConnections = journeyConnections;
const boarding_1 = require("./boarding");
/** Explicit change instructions for the future map and step-by-step itinerary.
 * Uses only ride stops from the planner and pre-validated pedestrian leg geometry.
 * Never claims a particular platform without an independently sourced review. */
function journeyConnections(journey, stops) {
    const known = new Map(stops.map(s => [s.id, s]));
    const connections = [];
    let previous = null;
    for (const [index, leg] of journey.legs.entries()) {
        if (leg.type !== 'ride')
            continue;
        if (previous) {
            const prior = previous.ride;
            const from = known.get(prior.alightStopId);
            const to = known.get(leg.boardStopId);
            if (!from || !to)
                throw new Error('connection_unknown_stop');
            const middle = journey.legs.slice(previous.index + 1, index);
            if (middle.some(l => l.type !== 'walk' || l.purpose !== 'transfer') || middle.length > 1)
                throw new Error('connection_invalid_intermediate_legs');
            const walk = middle[0];
            if (from.id !== to.id && !walk)
                throw new Error('connection_missing_pedestrian_path');
            if (walk && (from.id === to.id ||
                (0, boarding_1.proximityMeters)(walk.from, (0, boarding_1.routableStopCoordinate)(from)) > 25 ||
                (0, boarding_1.proximityMeters)(walk.to, (0, boarding_1.routableStopCoordinate)(to)) > 25))
                throw new Error('connection_unexpected_walk');
            const walkSecs = walk?.durationSeconds ?? 0;
            const window = leg.boardAtSeconds - prior.alightAtSeconds;
            if (window < walkSecs)
                throw new Error('connection_impossible_schedule');
            connections.push({
                kind: walk ? 'walk_between_stops' : 'same_stop',
                fromRoute: prior.routeName, toRoute: leg.routeName,
                alightStopId: from.id, alightStopName: from.name, alightStopCode: from.code ?? null,
                boardStopId: to.id, boardStopName: to.name, boardStopCode: to.code ?? null,
                alightAtSeconds: prior.alightAtSeconds, boardAtSeconds: leg.boardAtSeconds,
                transferWalkSeconds: walkSecs, transferWalkMeters: walk?.distanceMeters ?? 0,
                scheduledWindowSeconds: window, waitingAfterWalkSeconds: window - walkSecs,
                boarding: (0, boarding_1.boardingInstruction)(to), guaranteed: false,
                note: walk ? 'Walk between the indicated stops using the provided pedestrian route. Connection is scheduled, not guaranteed.' : 'Remain at the same GTFS stop for the next bus. Physical bay/side is not confirmed unless independently verified.',
            });
        }
        previous = { ride: leg, index };
    }
    return connections;
}

  },
  './engine': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nonDominatedJourneys = nonDominatedJourneys;
exports.planJourneys = planJourneys;
const time_1 = require("./time");
const boarding_1 = require("./boarding");
const MAX_SCHEDULE_SECONDS = 72 * 3600;
function assertPath(path, from, to) {
    if (!Number.isFinite(path.durationSeconds) || path.durationSeconds < 0 || path.durationSeconds > 7200)
        return false;
    if (!Number.isFinite(path.distanceMeters) || path.distanceMeters < 0 || path.distanceMeters > 5000)
        return false;
    if (!Array.isArray(path.geometry) || path.geometry.length < 2 || !path.provider)
        return false;
    if (!path.geometry.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180))
        return false;
    const first = path.geometry[0], last = path.geometry[path.geometry.length - 1];
    // A valid path must end at the GTFS stop, not just somewhere nearby in the road.
    // This checks endpoints only; sidewalk/platform certainty requires independent verification.
    return (0, boarding_1.proximityMeters)(first, from) <= 25 && (0, boarding_1.proximityMeters)(last, to) <= 25;
}
function pathLeg(path, from, to, purpose) {
    return { type: 'walk', from, to, durationSeconds: path.durationSeconds, distanceMeters: path.distanceMeters,
        geometry: path.geometry, provider: path.provider, purpose };
}
/** Preserve arrival/walk/boarding trade-offs and future-trip eligibility.
 * The 24-label cap bounds work but is not a proof of globally optimal routing. */
const MAX_STATES_PER_STOP = 24;
function previousVehicle(state) {
    for (let i = state.legs.length - 1; i >= 0; i--) {
        const leg = state.legs[i];
        if (leg.type === 'ride')
            return leg.tripId;
    }
    return null;
}
/** State A must not prohibit any trip that state B could still board.
 * The planner forbids reusing trip IDs, so history is part of state identity. */
function usedVehicles(state) {
    const ids = new Set();
    for (const leg of state.legs) {
        if (leg.type === 'ride')
            ids.add(leg.tripId);
    }
    return ids;
}
function stateDominates(a, b) {
    if (previousVehicle(a) !== previousVehicle(b) ||
        a.at > b.at || a.walkingMeters > b.walkingMeters || a.rides > b.rides)
        return false;
    const otherUsed = usedVehicles(b);
    for (const tripId of usedVehicles(a)) {
        if (!otherUsed.has(tripId))
            return false;
    }
    return true;
}
function addBest(states, state) {
    const entries = states.get(state.stopId) ?? [];
    if (entries.some(x => stateDominates(x, state)))
        return;
    const viable = entries.filter(x => !stateDominates(state, x));
    viable.push(state);
    viable.sort((a, b) => a.at - b.at || a.walkingMeters - b.walkingMeters || a.rides - b.rides);
    states.set(state.stopId, viable.slice(0, MAX_STATES_PER_STOP));
}
function sortStopTimes(rows) { return [...rows].sort((a, b) => a.sequence - b.sequence); }
function scheduleIsValid(rows) {
    let previous = -1;
    for (const r of rows) {
        const a = r.arrivalSeconds, d = r.departureSeconds;
        if (a != null && (!Number.isInteger(a) || a < 0 || a > MAX_SCHEDULE_SECONDS || a < previous))
            return false;
        if (d != null && (!Number.isInteger(d) || d < 0 || d > MAX_SCHEDULE_SECONDS || (a != null && d < a) || d < previous))
            return false;
        if (a != null)
            previous = a;
        if (d != null)
            previous = d;
    }
    return true;
}
/** Pareto for completed journeys (not an exhaustive-route guarantee).
 * Later departure from origin is a benefit: otherwise every hourly bus after
 * the first disappears. departureAtSeconds is only the requested search time.
 * Legacy fixtures without the new field retain previous comparison behavior. */
function nonDominatedJourneys(journeys) {
    const leaveAt = (j) => Number.isFinite(j.latestLeaveAtSeconds) ? j.latestLeaveAtSeconds :
        Number.isFinite(j.departureAtSeconds) ? j.departureAtSeconds : 0;
    return journeys.filter((candidate, index) => !journeys.some((other, i) => i !== index &&
        other.arrivalAtSeconds <= candidate.arrivalAtSeconds &&
        other.walkingMeters <= candidate.walkingMeters &&
        other.transfers <= candidate.transfers &&
        leaveAt(other) >= leaveAt(candidate) &&
        (other.arrivalAtSeconds < candidate.arrivalAtSeconds ||
            other.walkingMeters < candidate.walkingMeters ||
            other.transfers < candidate.transfers ||
            leaveAt(other) > leaveAt(candidate))));
}
function planJourneys(data, paths, request) {
    if (data.timezone !== 'Europe/Dublin')
        throw new Error('unsupported_timezone');
    if (!(0, time_1.validDate)(request.serviceDate))
        throw new Error('invalid_service_date');
    if ((0, time_1.dstTransitionDay)(request.serviceDate))
        throw new Error('dst_transition_requires_timezone_aware_scheduling');
    if (!Number.isInteger(request.departAfterSeconds) || request.departAfterSeconds < 0 || request.departAfterSeconds >= 86400)
        throw new Error('invalid_departure_time');
    const maxTransfers = Math.max(0, Math.min(2, Math.floor(request.maxTransfers ?? 1)));
    const limit = Math.max(1, Math.min(5, Math.floor(request.limit ?? 3)));
    const minBoarding = Math.max(0, Math.floor(request.minBoardingSeconds ?? 60));
    const minTransfer = Math.max(0, Math.floor(request.minTransferSeconds ?? 120));
    const walkingCap = Math.max(0, Math.floor(request.maxWalkingMeters ?? 2500));
    if (![minBoarding, minTransfer, walkingCap].every(Number.isFinite))
        throw new Error('invalid_parameters');
    const stopMap = new Map(data.stops.map(s => [s.id, s]));
    const routeMap = new Map(data.routes.map(r => [r.id, r]));
    const rowsByTrip = new Map();
    for (const row of data.stopTimes) {
        const a = rowsByTrip.get(row.tripId) ?? [];
        a.push(row);
        rowsByTrip.set(row.tripId, a);
    }
    const validTrips = [];
    for (const trip of data.trips) {
        const route = routeMap.get(trip.routeId);
        if (!route || !(0, time_1.activeService)(trip.serviceId, request.serviceDate, data.calendars, data.exceptions))
            continue;
        const rows = sortStopTimes(rowsByTrip.get(trip.id) ?? []);
        if (rows.length < 2 || !scheduleIsValid(rows))
            continue;
        validTrips.push({ trip, route, rows });
    }
    const egressPaths = new Map();
    for (const p of paths.egress) {
        const s = stopMap.get(p.stopId);
        if (s && assertPath(p, (0, boarding_1.routableStopCoordinate)(s), paths.destination)) {
            const current = egressPaths.get(p.stopId);
            if (!current || p.durationSeconds < current.durationSeconds)
                egressPaths.set(p.stopId, p);
        }
    }
    const transferMap = new Map();
    for (const p of paths.transfers) {
        const from = stopMap.get(p.fromStopId), to = stopMap.get(p.toStopId);
        if (!from || !to || from.id === to.id || !assertPath(p, (0, boarding_1.routableStopCoordinate)(from), (0, boarding_1.routableStopCoordinate)(to)))
            continue;
        const old = transferMap.get(from.id) ?? [];
        old.push(p);
        transferMap.set(from.id, old);
    }
    const initial = new Map();
    for (const p of paths.access) {
        const stop = stopMap.get(p.stopId);
        if (!stop || !assertPath(p, paths.origin, (0, boarding_1.routableStopCoordinate)(stop)) || p.distanceMeters > walkingCap)
            continue;
        addBest(initial, { stopId: stop.id, at: request.departAfterSeconds + p.durationSeconds, rides: 0,
            walkingMeters: p.distanceMeters, legs: [pathLeg(p, paths.origin, (0, boarding_1.routableStopCoordinate)(stop), 'access')], boardings: [] });
    }
    const candidates = [];
    // Walk-only is a real alternative, never a fabricated road line. Requires
    // separately returned provider geometry, and no GTFS service to exist.
    if (paths.direct && assertPath(paths.direct, paths.origin, paths.destination) &&
        paths.direct.distanceMeters <= walkingCap) {
        candidates.push({ serviceDate: request.serviceDate, feedVersion: data.feedVersion,
            departureAtSeconds: request.departAfterSeconds,
            latestLeaveAtSeconds: request.departAfterSeconds,
            arrivalAtSeconds: request.departAfterSeconds + paths.direct.durationSeconds,
            transfers: 0, walkingMeters: paths.direct.distanceMeters,
            legs: [pathLeg(paths.direct, paths.origin, paths.destination, 'direct')],
            boardings: [], predictionType: 'walking_estimate' });
    }
    let frontier = initial;
    for (let round = 0; round <= maxTransfers; round++) {
        if (frontier.size === 0)
            break;
        const next = new Map();
        for (const { trip, route, rows } of validTrips) {
            const boardingCandidates = [];
            for (let i = 0; i < rows.length; i++) {
                const stopTime = rows[i];
                if ((stopTime.pickupType == null || stopTime.pickupType === 0) && stopTime.departureSeconds != null) {
                    for (const option of frontier.get(stopTime.stopId) ?? []) {
                        if (option.legs.some(leg => leg.type === 'ride' && leg.tripId === trip.id))
                            continue;
                        const requireBuffer = option.rides > 0 ? minTransfer : minBoarding;
                        if (option.at + requireBuffer > stopTime.departureSeconds)
                            continue;
                        // Keep multiple boarding labels: a shorter access walk may enable
                        // a later transfer even if another label is faster at this stop.
                        boardingCandidates.push({ state: option, index: i });
                    }
                    if (boardingCandidates.length > 36) {
                        boardingCandidates.sort((a, b) => a.state.walkingMeters - b.state.walkingMeters ||
                            a.state.at - b.state.at || a.index - b.index);
                        boardingCandidates.splice(36);
                    }
                }
                if (stopTime.dropOffType === 1 || !(stopTime.dropOffType == null || stopTime.dropOffType === 0) || stopTime.arrivalSeconds == null)
                    continue;
                const alightStop = stopMap.get(stopTime.stopId);
                if (!alightStop)
                    continue;
                for (const chosen of boardingCandidates) {
                    if (chosen.index >= i)
                        continue;
                    const b = rows[chosen.index];
                    const boardingStop = stopMap.get(b.stopId);
                    if (!boardingStop)
                        continue;
                    const ride = { type: 'ride', tripId: trip.id, routeId: trip.routeId, routeName: route.name,
                        mode: route.mode, headsign: trip.headsign ?? null, boardStopId: b.stopId, alightStopId: stopTime.stopId,
                        boardAtSeconds: b.departureSeconds, alightAtSeconds: stopTime.arrivalSeconds, serviceDate: request.serviceDate };
                    const base = chosen.state;
                    const result = { stopId: stopTime.stopId, at: stopTime.arrivalSeconds, rides: base.rides + 1,
                        legs: [...base.legs, ride], boardings: [...base.boardings, (0, boarding_1.boardingInstruction)(boardingStop)],
                        walkingMeters: base.walkingMeters };
                    addBest(next, result);
                }
            }
        }
        // Transfer walking only after arriving on a vehicle. Never assume opposite sidewalks connect.
        const expanded = new Map();
        for (const group of next.values())
            for (const entry of group)
                addBest(expanded, entry);
        for (const group of next.values())
            for (const origin of group) {
                for (const p of transferMap.get(origin.stopId) ?? []) {
                    if (origin.walkingMeters + p.distanceMeters > walkingCap)
                        continue;
                    const from = stopMap.get(p.fromStopId), to = stopMap.get(p.toStopId);
                    addBest(expanded, { ...origin, stopId: to.id, at: origin.at + p.durationSeconds,
                        walkingMeters: origin.walkingMeters + p.distanceMeters,
                        legs: [...origin.legs, pathLeg(p, (0, boarding_1.routableStopCoordinate)(from), (0, boarding_1.routableStopCoordinate)(to), 'transfer')] });
                }
            }
        for (const group of next.values())
            for (const result of group) {
                const egress = egressPaths.get(result.stopId);
                if (!egress || result.walkingMeters + egress.distanceMeters > walkingCap)
                    continue;
                const stop = stopMap.get(result.stopId);
                const firstRide = result.legs.find((leg) => leg.type === 'ride');
                const access = result.legs.find((leg) => leg.type === 'walk' && leg.purpose === 'access');
                // Include required boarding slack: later advertised departures must
                // remain physically reachable, not just convenient-looking timestamps.
                const latestLeaveAtSeconds = firstRide
                    ? firstRide.boardAtSeconds - (access?.durationSeconds ?? 0) - minBoarding
                    : request.departAfterSeconds;
                candidates.push({ serviceDate: request.serviceDate, feedVersion: data.feedVersion,
                    departureAtSeconds: request.departAfterSeconds, latestLeaveAtSeconds,
                    arrivalAtSeconds: result.at + egress.durationSeconds,
                    transfers: result.rides - 1, walkingMeters: result.walkingMeters + egress.distanceMeters,
                    boardings: result.boardings, legs: [...result.legs, pathLeg(egress, (0, boarding_1.routableStopCoordinate)(stop), paths.destination, 'egress')],
                    predictionType: 'scheduled' });
            }
        frontier = expanded;
    }
    // Preserve alternatives with different transit patterns, then rank by actual scheduled arrival.
    const journeys = new Map();
    for (const c of candidates) {
        const signature = c.legs.some(l => l.type === 'ride') ? c.legs.filter(l => l.type === 'ride').map(l => `${l.tripId}:${l.boardStopId}:${l.alightStopId}`).join('|') : 'walk_only';
        const previous = journeys.get(signature);
        if (!previous || c.arrivalAtSeconds < previous.arrivalAtSeconds)
            journeys.set(signature, c);
    }
    const rankBy = request.rankBy ?? 'fastest';
    return nonDominatedJourneys([...journeys.values()]).sort((a, b) => {
        if (rankBy === 'less_walking')
            return a.walkingMeters - b.walkingMeters || a.arrivalAtSeconds - b.arrivalAtSeconds || a.transfers - b.transfers;
        if (rankBy === 'fewest_transfers')
            return a.transfers - b.transfers || a.arrivalAtSeconds - b.arrivalAtSeconds || a.walkingMeters - b.walkingMeters;
        return a.arrivalAtSeconds - b.arrivalAtSeconds || a.transfers - b.transfers || a.walkingMeters - b.walkingMeters;
    }).slice(0, limit);
}

  },
  './gtfsSnapshot': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadActiveGtfsSnapshot = loadActiveGtfsSnapshot;
const supabaseAdapter_1 = require("./supabaseAdapter");
const TABLES = {
    stops: ['gtfs_stops', 'version,stop_id,stop_name,stop_lat,stop_lon,stop_code,stop_desc', 'stop_id.asc'],
    routes: ['gtfs_routes', 'version,route_id,route_short_name,route_long_name,route_type', 'route_id.asc'],
    trips: ['gtfs_trips', 'version,trip_id,route_id,service_id,trip_headsign', 'trip_id.asc'],
    stopTimes: ['gtfs_stop_times', 'version,trip_id,stop_id,stop_sequence,arrival_seconds,departure_seconds,pickup_type,drop_off_type', 'trip_id.asc,stop_sequence.asc'],
    calendars: ['gtfs_calendars', 'version,service_id,start_date,end_date,sunday,monday,tuesday,wednesday,thursday,friday,saturday', 'service_id.asc'],
    calendarDates: ['gtfs_calendar_dates', 'version,service_id,service_date,exception_type', 'service_id.asc,service_date.asc'],
};
async function loadActiveGtfsSnapshot(options) {
    const { supabaseUrl, privateKey } = options;
    if (!/^https:\/\//.test(supabaseUrl) || !privateKey || /\s/.test(privateKey))
        throw new Error('invalid_server_configuration');
    const pageSize = options.pageSize ?? 500;
    const maxRows = options.maxRowsPerTable ?? 100_000;
    const timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isInteger(maxRows) || maxRows < pageSize || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
        throw new Error('invalid_snapshot_options');
    }
    const fetcher = options.fetcher ?? fetch;
    const root = supabaseUrl.replace(/\/$/, '') + '/rest/v1/';
    const headers = { apikey: privateKey, Accept: 'application/json' };
    if (privateKey.startsWith('eyJ'))
        headers.Authorization = `Bearer ${privateKey}`;
    async function request(path) {
        // No database writes. On any failed page, fail closed rather than return a partial graph.
        const url = root + path;
        const response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok)
            throw new Error(`snapshot_http_${response.status}`);
        const rows = await response.json();
        if (!Array.isArray(rows) || !rows.every(x => x !== null && typeof x === 'object' && !Array.isArray(x)))
            throw new Error('invalid_snapshot_response');
        return rows;
    }
    async function activeVersion() {
        const rows = await request('gtfs_feed_versions?select=version&active=eq.true&label=eq.nta-realtime&limit=2');
        if (rows.length !== 1 || typeof rows[0]?.version !== 'string' || !rows[0].version)
            throw new Error('active_feed_unavailable_or_ambiguous');
        return rows[0].version;
    }
    const version = await activeVersion();
    const tables = {};
    for (const group of Object.keys(TABLES)) {
        const [table, select, order] = TABLES[group];
        const all = [];
        for (let offset = 0;; offset += pageSize) {
            if (offset > maxRows)
                throw new Error(`snapshot_limit_exceeded_${table}`);
            const rows = await request(`${table}?select=${select}&version=eq.${encodeURIComponent(version)}&order=${order}&limit=${pageSize}&offset=${offset}`);
            if (rows.length > pageSize)
                throw new Error(`snapshot_page_overflow_${table}`);
            if (rows.some(r => r.version !== version))
                throw new Error(`mixed_gtfs_version_${table}`);
            all.push(...rows);
            if (all.length > maxRows)
                throw new Error(`snapshot_limit_exceeded_${table}`);
            if (rows.length < pageSize)
                break;
        }
        tables[group] = all;
    }
    // Detect a new feed activation while pages were being fetched, instead of mixing datasets.
    if (await activeVersion() !== version)
        throw new Error('active_feed_switched_during_snapshot');
    if (!tables.stops.length || !tables.routes.length || !tables.trips.length || !tables.stopTimes.length)
        throw new Error('incomplete_snapshot');
    const timetable = (0, supabaseAdapter_1.fromSupabaseTables)({ feedVersion: version, ...tables });
    const knownStops = new Set(timetable.stops.map(s => s.id));
    const knownRoutes = new Set(timetable.routes.map(r => r.id));
    if (timetable.trips.some(t => !knownRoutes.has(t.routeId)) || timetable.stopTimes.some(st => !knownStops.has(st.stopId))) {
        throw new Error('snapshot_broken_references');
    }
    return timetable;
}

  },
  './httpApi': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankItineraries = rankItineraries;
exports.createRoutingApi = createRoutingApi;
exports.createMemoryRateLimiter = createMemoryRateLimiter;
exports.createSnapshotCache = createSnapshotCache;
const time_1 = require("./time");
const planner_1 = require("./planner");
const engine_1 = require("./engine");
const boardingEvidence_1 = require("./boardingEvidence");
const connections_1 = require("./connections");
const nearbyStops_1 = require("./nearbyStops");
const BODY_LIMIT = 4096;
const IRELAND = { minLat: 51.3, maxLat: 55.8, minLon: -11.1, maxLon: -5.2 };
const hardenHeaders = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
};
function json(value, status = 200, extra = {}) {
    return new Response(JSON.stringify(value), { status, headers: { ...hardenHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function inIreland(value) {
    if (!isObject(value) || Object.keys(value).some(k => k !== 'lat' && k !== 'lon'))
        return false;
    const { lat, lon } = value;
    return typeof lat === 'number' && Number.isFinite(lat) && lat >= IRELAND.minLat && lat <= IRELAND.maxLat &&
        typeof lon === 'number' && Number.isFinite(lon) && lon >= IRELAND.minLon && lon <= IRELAND.maxLon;
}
function calendarDays(a, b) {
    return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
function parseInput(raw, now) {
    if (!isObject(raw))
        return null;
    const keys = ['serviceDate', 'departAt', 'origin', 'destination', 'maxTransfers', 'maxWalkingMeters', 'limit', 'prioritize'];
    if (Object.keys(raw).some(k => !keys.includes(k)))
        return null;
    const serviceDate = raw.serviceDate;
    const departAt = raw.departAt;
    if (typeof serviceDate !== 'string' || !(0, time_1.validDate)(serviceDate))
        return null;
    // Protect against arbitrary historic browsing and long-range provider consumption.
    const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const getDate = (name) => dateParts.find(part => part.type === name)?.value ?? '';
    const localToday = `${getDate('year')}-${getDate('month')}-${getDate('day')}`;
    const delta = calendarDays(serviceDate, localToday);
    if (!Number.isFinite(delta) || delta < 0 || delta > 14)
        return null;
    if (typeof departAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(departAt))
        return null;
    if (!inIreland(raw.origin) || !inIreland(raw.destination))
        return null;
    const maxTransfers = raw.maxTransfers ?? 1, maxWalkingMeters = raw.maxWalkingMeters ?? 2000, limit = raw.limit ?? 3;
    const prioritize = raw.prioritize ?? 'fastest';
    if (prioritize !== 'fastest' && prioritize !== 'less_walking' && prioritize !== 'fewest_transfers')
        return null;
    if (typeof maxTransfers !== 'number' || typeof maxWalkingMeters !== 'number' || typeof limit !== 'number' ||
        !Number.isInteger(maxTransfers) || maxTransfers < 0 || maxTransfers > 2 ||
        !Number.isInteger(maxWalkingMeters) || maxWalkingMeters < 100 || maxWalkingMeters > 2500 ||
        !Number.isInteger(limit) || limit < 1 || limit > 3)
        return null;
    return { serviceDate, departAt, origin: raw.origin, destination: raw.destination, maxTransfers, maxWalkingMeters, limit, prioritize };
}
async function readLimitedJson(req) {
    if (!req.body)
        throw new Error('missing_body');
    const header = req.headers.get('content-length');
    if (header && (!/^\d+$/.test(header) || Number(header) > BODY_LIMIT))
        throw new Error('payload_too_large');
    const reader = req.body.getReader();
    let count = 0;
    const chunks = [];
    try {
        for (;;) {
            const result = await reader.read();
            if (result.done)
                break;
            count += result.value.byteLength;
            if (count > BODY_LIMIT)
                throw new Error('payload_too_large');
            chunks.push(result.value);
        }
    }
    catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
/** Bounded stop discovery is a geographic lookup, not proof of walking access. */
function parseNearby(url) {
    const keys = [];
    url.searchParams.forEach((_value, key) => { keys.push(key); });
    if (keys.some(k => !['lat', 'lon', 'radiusMeters', 'limit'].includes(k)))
        return null;
    if (new Set(keys).size !== keys.length)
        return null;
    const latString = url.searchParams.get('lat'), lonString = url.searchParams.get('lon');
    if (!latString || !lonString || !/^-?\d{1,2}(?:\.\d{1,7})?$/.test(latString) || !/^-?\d{1,3}(?:\.\d{1,7})?$/.test(lonString))
        return null;
    const origin = { lat: Number(latString), lon: Number(lonString) };
    if (!inIreland(origin))
        return null;
    const radiusText = url.searchParams.get('radiusMeters') ?? '1200', limitText = url.searchParams.get('limit') ?? '8';
    if (!/^\d{1,4}$/.test(radiusText) || !/^\d{1,2}$/.test(limitText))
        return null;
    const radiusMeters = Number(radiusText), limit = Number(limitText);
    if (radiusMeters < 100 || radiusMeters > 2500 || limit < 1 || limit > 15)
        return null;
    return { origin, radiusMeters, limit };
}
function rankItineraries(journeys, preference, limit) {
    const copy = (0, engine_1.nonDominatedJourneys)(journeys);
    copy.sort((a, b) => {
        if (preference === 'less_walking')
            return a.walkingMeters - b.walkingMeters || a.arrivalAtSeconds - b.arrivalAtSeconds || a.transfers - b.transfers;
        if (preference === 'fewest_transfers')
            return a.transfers - b.transfers || a.arrivalAtSeconds - b.arrivalAtSeconds || a.walkingMeters - b.walkingMeters;
        return a.arrivalAtSeconds - b.arrivalAtSeconds || a.transfers - b.transfers || a.walkingMeters - b.walkingMeters;
    });
    return copy.slice(0, limit);
}
function createRoutingApi(deps) {
    if (!deps.loadTimetable || !deps.router || !deps.clientIdentity || !deps.consumeRateLimit)
        throw new Error('missing_routing_api_dependencies');
    const permitted = new Set(deps.allowedOrigins ?? []);
    return async (req) => {
        const origin = req.headers.get('origin');
        const cors = origin && permitted.has(origin) ? {
            'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
        } : {};
        if (origin && !permitted.has(origin))
            return json({ error: 'origin_not_allowed' }, 403);
        if (req.method === 'OPTIONS')
            return new Response(null, { status: 204, headers: { ...hardenHeaders, ...cors } });
        const pathname = new URL(req.url).pathname;
        if (pathname === '/health' && req.method === 'GET')
            return json({ status: 'available', service: 'ballina-routing-api', realtime: false }, 200, cors);
        const isNearby = pathname === '/v1/nearby-stops';
        if (pathname !== '/v1/journeys' && !isNearby)
            return json({ error: 'not_found' }, 404, cors);
        if (isNearby ? req.method !== 'GET' : req.method !== 'POST')
            return json({ error: 'method_not_allowed' }, 405, cors);
        if (!isNearby) {
            const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
            if (mediaType !== 'application/json')
                return json({ error: 'unsupported_media_type' }, 415, cors);
        }
        try {
            // Two independent limits. All unauthenticated clients share a global ceiling.
            if (!await deps.consumeRateLimit('routing|global', 200, 60))
                return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
            const identity = deps.clientIdentity(req) || 'unidentified';
            // Protect limiter storage from unlimited arbitrary caller-controlled bucket strings.
            const safeIdentity = identity.slice(0, 120);
            if (!await deps.consumeRateLimit(`routing|client|${safeIdentity}`, 10, 60))
                return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
        }
        catch {
            return json({ error: 'temporarily_unavailable' }, 503, cors);
        }
        if (isNearby) {
            const input = parseNearby(new URL(req.url));
            if (!input)
                return json({ error: 'invalid_nearby_request' }, 400, cors);
            try {
                const timetable = await deps.loadTimetable();
                return json({ feedVersion: timetable.feedVersion, stops: (0, nearbyStops_1.nearbyStops)(timetable, input.origin, input.radiusMeters, input.limit),
                    distanceType: 'straight_line_approximation_not_walking_route',
                    boardingNote: 'Stop pole, correct sidewalk or bay remain unverified without independent evidence.',
                    realtime: false, attribution: 'National Transport Authority (NTA) / GTFS timetable data' }, 200, cors);
            }
            catch {
                return json({ error: 'temporarily_unavailable' }, 503, cors);
            }
        }
        let raw;
        try {
            raw = await readLimitedJson(req);
        }
        catch (e) {
            return json({ error: e instanceof Error && e.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json' }, 400, cors);
        }
        const input = parseInput(raw, (deps.now ?? (() => new Date()))());
        if (!input)
            return json({ error: 'invalid_route_request' }, 400, cors);
        if ((0, time_1.dstTransitionDay)(input.serviceDate))
            return json({ error: 'dst_transition_not_supported_yet' }, 422, cors);
        // The walking provider is metered. Restrict paid itinerary queries across all
        // function instances, independent of the short-minute abuse limiter above.
        try {
            if (!await deps.consumeRateLimit('routing|paid-global|hourly', 12, 3600))
                return json({ error: 'pilot_hourly_budget_exhausted' }, 429, { ...cors, 'Retry-After': '3600' });
        }
        catch {
            return json({ error: 'temporarily_unavailable' }, 503, cors);
        }
        try {
            const timetable = await deps.loadTimetable();
            const result = await (0, planner_1.planDoorToDoor)(timetable, deps.router, {
                serviceDate: input.serviceDate, departAfterSeconds: Number(input.departAt.slice(0, 2)) * 3600 + Number(input.departAt.slice(3, 5)) * 60,
                origin: input.origin, destination: input.destination, maxTransfers: input.maxTransfers,
                maxWalkingMeters: input.maxWalkingMeters, limit: input.limit, rankBy: input.prioritize,
                minTransferSeconds: 180, minBoardingSeconds: 90,
            }, {
                maxRequestCount: 12, maxOriginStops: 4, maxDestinationStops: 4, maxTransferPairs: 4,
                maxPedestrianDistanceMeters: input.maxWalkingMeters,
                includeRail: false,
            });
            const journeys = rankItineraries(result.journeys, input.prioritize, input.limit).map((journey) => ({
                ...journey,
                boardingDetails: (0, boardingEvidence_1.journeyBoardingDetails)(journey, timetable.stops),
                connections: (0, connections_1.journeyConnections)(journey, timetable.stops),
            }));
            return json({ serviceDate: input.serviceDate, feedVersion: result.feedVersion, prioritize: input.prioritize, journeys,
                realtime: false, status: 'scheduled_only',
                coverageNote: 'Regional GTFS subset: no result does not prove no public transport exists.',
                boardingNote: 'Official GTFS stop coordinates do not independently verify the side of the street or bay.',
                attribution: 'National Transport Authority (NTA) / GTFS timetable data',
            }, 200, cors);
        }
        catch {
            // Do not send database/provider failures, stack traces or API keys to the caller.
            return json({ error: 'temporarily_unavailable' }, 503, cors);
        }
    };
}
/** Development/testing only. Production MUST use a shared, atomic rate limiter. */
function createMemoryRateLimiter(now = () => Date.now()) {
    const buckets = new Map();
    return async (key, limit, seconds) => {
        const tick = now();
        if (buckets.size > 2000) {
            for (const [k, v] of buckets) {
                if (v.endsAt <= tick)
                    buckets.delete(k);
            }
        }
        const previous = buckets.get(key);
        const entry = !previous || previous.endsAt <= tick ? { count: 0, endsAt: tick + seconds * 1000 } : previous;
        entry.count++;
        buckets.set(key, entry);
        return entry.count <= limit;
    };
}
/** One expensive paginated GTFS load per TTL, with concurrent-call deduplication. */
function createSnapshotCache(loader, ttlMs = 300000, clock = () => Date.now()) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000)
        throw new Error('invalid_cache_ttl');
    let current;
    let expires = 0;
    let pending;
    return async () => {
        if (current && clock() < expires)
            return current;
        if (!pending) {
            pending = loader().then(result => {
                if (!result.feedVersion || !result.stops.length || !result.trips.length)
                    throw new Error('invalid_snapshot');
                current = result;
                expires = clock() + ttlMs;
                return result;
            }).finally(() => { pending = undefined; });
        }
        return pending;
    };
}

  },
  './index': function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nearbyStops = void 0;
__exportStar(require("./types"), exports);
__exportStar(require("./time"), exports);
__exportStar(require("./boarding"), exports);
__exportStar(require("./engine"), exports);
__exportStar(require("./pedestrian"), exports);
__exportStar(require("./map"), exports);
__exportStar(require("./supabaseAdapter"), exports);
__exportStar(require("./gtfsSnapshot"), exports);
__exportStar(require("./boardingEvidence"), exports);
__exportStar(require("./connections"), exports);
__exportStar(require("./planner"), exports);
__exportStar(require("./httpApi"), exports);
__exportStar(require("./supabaseLimiter"), exports);
var nearbyStops_1 = require("./nearbyStops");
Object.defineProperty(exports, "nearbyStops", { enumerable: true, get: function () { return nearbyStops_1.nearbyStops; } });

  },
  './map': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.journeyOverlay = journeyOverlay;
const boarding_1 = require("./boarding");
/** No invented bus shape: walking paths and boarding/alighting point markers only. */
function journeyOverlay(journey, stops) {
    const stopMap = new Map(stops.map(s => [s.id, s]));
    const points = (p) => p.map(x => [x.lon, x.lat]);
    const features = [];
    for (const [i, leg] of journey.legs.entries()) {
        if (leg.type === 'walk') {
            features.push({ type: 'Feature', properties: { kind: 'walk', purpose: leg.purpose, step: i }, geometry: { type: 'LineString', coordinates: points(leg.geometry) } });
        }
        else {
            for (const [type, id] of [['board', leg.boardStopId], ['alight', leg.alightStopId]]) {
                const stop = stopMap.get(id);
                if (!stop)
                    continue;
                features.push({ type: 'Feature', properties: { kind: type, stopId: id, stopCode: stop.code ?? null, tripId: leg.tripId, route: leg.routeName }, geometry: { type: 'Point', coordinates: [(0, boarding_1.routableStopCoordinate)(stop).lon, (0, boarding_1.routableStopCoordinate)(stop).lat] } });
            }
        }
    }
    return { type: 'FeatureCollection', features };
}

  },
  './nearbyStops': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nearbyStops = nearbyStops;
const boarding_1 = require("./boarding");
/** Uses only stops served by known GTFS trips; never calls this walking distance. */
function nearbyStops(timetable, origin, radiusMeters = 1200, limit = 8) {
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) ||
        !Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 2500 ||
        !Number.isInteger(limit) || limit < 1 || limit > 15)
        throw new Error('invalid_nearby_params');
    const trips = new Map(timetable.trips.map(t => [t.id, t]));
    const routes = new Map(timetable.routes.map(r => [r.id, r]));
    const used = new Map();
    for (const st of timetable.stopTimes) {
        const trip = trips.get(st.tripId);
        // Arrival-only and special-arrangement stops must NOT advertise a bus as boardable.
        if (!trip || !routes.has(trip.routeId) || st.departureSeconds === null ||
            !(st.pickupType == null || st.pickupType === 0))
            continue;
        const set = used.get(st.stopId) ?? new Set();
        set.add(trip.routeId);
        used.set(st.stopId, set);
    }
    return timetable.stops.flatMap(stop => {
        const routeIds = used.get(stop.id);
        if (!routeIds || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon))
            return [];
        const meters = (0, boarding_1.proximityMeters)(origin, stop);
        if (meters > radiusMeters)
            return [];
        const routeNames = [...routeIds].map(id => routes.get(id))
            .filter(route => route.mode === 'bus').map(route => route.name).sort((a, b) => a.localeCompare(b));
        if (!routeNames.length)
            return [];
        return [{ ...(0, boarding_1.boardingInstruction)(stop), distanceStraightLineMeters: Math.round(meters), routeNames }];
    }).sort((a, b) => a.distanceStraightLineMeters - b.distanceStraightLineMeters || a.stopId.localeCompare(b.stopId)).slice(0, limit);
}

  },
  './pedestrian': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StadiaWalkingRouter = void 0;
exports.decodePolyline6 = decodePolyline6;
exports.buildPedestrianPaths = buildPedestrianPaths;
const boarding_1 = require("./boarding");
/** Valhalla returns polyline6, NOT Google polyline5. */
function decodePolyline6(polyline) {
    const out = [];
    let index = 0, lat = 0, lon = 0;
    function read() {
        let shift = 0, result = 0;
        for (let steps = 0; steps < 10; steps++) {
            if (index >= polyline.length)
                throw new Error('invalid_polyline');
            const code = polyline.charCodeAt(index++) - 63;
            if (code < 0 || code > 63)
                throw new Error('invalid_polyline');
            result |= (code & 31) << shift;
            shift += 5;
            if (code < 32)
                return (result & 1) ? ~(result >> 1) : (result >> 1);
        }
        throw new Error('invalid_polyline');
    }
    while (index < polyline.length) {
        lat += read();
        lon += read();
        out.push({ lat: lat / 1e6, lon: lon / 1e6 });
    }
    return out;
}
/** Server-side adapter. Key stays on the backend. No API call occurs unless walk() is invoked. */
class StadiaWalkingRouter {
    apiKey;
    http;
    baseUrl;
    constructor(apiKey, http = fetch, baseUrl = 'https://api-eu.stadiamaps.com') {
        this.apiKey = apiKey;
        this.http = http;
        this.baseUrl = baseUrl;
        if (!apiKey)
            throw new Error('missing_stadia_api_key');
        if (!/^https:\/\/api(-eu)?\.stadiamaps\.com$/.test(baseUrl))
            throw new Error('unapproved_stadia_endpoint');
    }
    async walk(from, to) {
        if (!validCoordinate(from) || !validCoordinate(to))
            throw new Error('invalid_coordinates');
        const url = `${this.baseUrl}/route/v1`;
        const response = await this.http(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Stadia-Auth ${this.apiKey}` },
            body: JSON.stringify({ locations: [from, to], costing: 'pedestrian', units: 'kilometers', shape_format: 'polyline6' }),
            signal: AbortSignal.timeout(12000),
        });
        if (response.status === 400 || response.status === 404)
            return null; // no routable path or invalid request, reject.
        if (!response.ok)
            throw new Error(`walking_api_failed_${response.status}`);
        const result = await response.json();
        const time = result.trip?.summary?.time;
        const distanceKm = result.trip?.summary?.length;
        const shape = result.trip?.legs?.[0]?.shape;
        if (typeof time !== 'number' || typeof distanceKm !== 'number' || typeof shape !== 'string')
            return null;
        const geometry = decodePolyline6(shape);
        if (geometry.length < 2 || !Number.isFinite(time) || time < 0 || !Number.isFinite(distanceKm) || distanceKm < 0)
            return null;
        if ((0, boarding_1.proximityMeters)(geometry[0], from) > 25 || (0, boarding_1.proximityMeters)(geometry[geometry.length - 1], to) > 25)
            return null;
        return { durationSeconds: Math.ceil(time), distanceMeters: Math.round(distanceKm * 1000), geometry, provider: 'stadia-valhalla-pedestrian' };
    }
}
exports.StadiaWalkingRouter = StadiaWalkingRouter;
function validCoordinate(c) { return Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180; }
/** Candidate discovery MAY use straight-line proximity, but every accepted leg requires a real walking-route response. */
async function buildPedestrianPaths(router, stops, origin, destination, opts = {}) {
    if (!validCoordinate(origin) || !validCoordinate(destination))
        throw new Error('invalid_coordinates');
    const originCap = Math.max(0, Math.min(opts.maxOriginStops ?? 8, 20));
    const destCap = Math.max(0, Math.min(opts.maxDestinationStops ?? 8, 20));
    const radius = Math.max(0, opts.candidateRadiusMeters ?? 1500);
    const maxTransfers = Math.max(0, Math.min(opts.maxTransferPairs ?? 32, 100));
    const budget = Math.max(0, Math.min(opts.maxRequestCount ?? 50, 200));
    const walkCap = Math.max(0, opts.maxPedestrianDistanceMeters ?? 2500);
    let used = 0;
    const requestWalk = async (a, b) => {
        // Boarding directly at a known stop must not depend on providers accepting
        // zero-length requests (many routers reject identical endpoints).
        if ((0, boarding_1.proximityMeters)(a, b) < 0.01) {
            return { durationSeconds: 0, distanceMeters: 0, geometry: [a, b], provider: 'identical-endpoints-no-walk' };
        }
        if (used >= budget)
            return null;
        used++;
        const r = await router.walk(a, b);
        return r && r.distanceMeters <= walkCap ? r : null;
    };
    const unique = [...new Map(stops.map(s => [s.id, s])).values()].filter(s => validCoordinate(s));
    const near = (p, max) => unique.map(s => ({ s, d: (0, boarding_1.proximityMeters)(p, s) }))
        .filter(x => x.d <= radius).sort((a, b) => a.d - b.d).slice(0, max).map(x => x.s);
    const origins = near(origin, originCap), destinations = near(destination, destCap);
    const access = [], egress = [], transfers = [];
    let direct;
    const directCap = Math.max(0, Math.min(opts.maxDirectWalkMeters ?? 0, walkCap));
    if (directCap > 0 && (0, boarding_1.proximityMeters)(origin, destination) <= directCap) {
        const proposed = await requestWalk(origin, destination);
        if (proposed && proposed.distanceMeters <= directCap)
            direct = proposed;
    }
    for (const s of origins) {
        const route = await requestWalk(origin, (0, boarding_1.routableStopCoordinate)(s));
        if (route)
            access.push({ ...route, stopId: s.id });
    }
    for (const s of destinations) {
        const route = await requestWalk((0, boarding_1.routableStopCoordinate)(s), destination);
        if (route)
            egress.push({ ...route, stopId: s.id });
    }
    // Discover short transfers deterministically, independent of the GTFS stop import order.
    // Spread candidates across geographic cells instead of exhausting the budget in one town.
    const known = new Map(unique.map(s => [s.id, s]));
    const pairs = [];
    const seen = new Set();
    const addPair = (a, b) => {
        if (a.id === b.id)
            return;
        const k = JSON.stringify([a.id, b.id]);
        if (seen.has(k))
            return;
        seen.add(k);
        const distance = (0, boarding_1.proximityMeters)((0, boarding_1.routableStopCoordinate)(a), (0, boarding_1.routableStopCoordinate)(b));
        if (distance <= 650)
            pairs.push({ a, b, distance });
    };
    if (opts.transferPairs) {
        for (const pair of opts.transferPairs) {
            const a = known.get(pair.fromStopId), b = known.get(pair.toStopId);
            if (a && b)
                addPair(a, b);
        }
    }
    else {
        for (const a of unique)
            for (const b of unique)
                addPair(a, b);
    }
    const groups = new Map();
    for (const pair of pairs) {
        const key = [Math.floor(pair.a.lat * 50), Math.floor(pair.a.lon * 50)].join(':');
        const group = groups.get(key) ?? [];
        group.push(pair);
        groups.set(key, group);
    }
    const cells = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, group] of cells)
        group.sort((a, b) => a.distance - b.distance || a.a.id.localeCompare(b.a.id) || a.b.id.localeCompare(b.b.id));
    let attempted = 0;
    for (let depth = 0; attempted < maxTransfers && used < budget; depth++) {
        let found = false;
        for (const [, group] of cells) {
            if (attempted >= maxTransfers || used >= budget)
                break;
            const pair = group[depth];
            if (!pair)
                continue;
            found = true;
            attempted++;
            // Directional road/crossing access. Never assume reverse direction is safe.
            const route = await requestWalk((0, boarding_1.routableStopCoordinate)(pair.a), (0, boarding_1.routableStopCoordinate)(pair.b));
            if (route)
                transfers.push({ ...route, fromStopId: pair.a.id, toStopId: pair.b.id });
        }
        if (!found)
            break;
    }
    return { origin, destination, access, egress, transfers, direct };
}

  },
  './planner': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planDoorToDoor = planDoorToDoor;
const engine_1 = require("./engine");
const pedestrian_1 = require("./pedestrian");
/**
 * A controlled, server-side integration seam. No provider key or database secret
 * is ever serialized into the response. Missing pedestrian routes mean no itinerary.
 */
async function planDoorToDoor(timetable, router, req, opts = {}) {
    // Use the current GTFS graph only. Never silently include unsupported rail services.
    const allowedRoutes = new Set(timetable.routes.filter(r => r.mode === 'bus' || opts.includeRail).map(r => r.id));
    const eligibleTrips = timetable.trips.filter(t => allowedRoutes.has(t.routeId));
    const eligibleTripIds = new Set(eligibleTrips.map(t => t.id));
    const times = timetable.stopTimes.filter(st => eligibleTripIds.has(st.tripId));
    const usedStopIds = new Set(times.map(st => st.stopId));
    const routes = timetable.routes.filter(r => allowedRoutes.has(r.id));
    const stops = timetable.stops.filter(s => usedStopIds.has(s.id));
    const data = { ...timetable, stops, routes, trips: eligibleTrips, stopTimes: times };
    // Transfer candidates only where a route permits alighting and another permits boarding.
    const routeForTrip = new Map(eligibleTrips.map(t => [t.id, t.routeId]));
    const boardingRoutes = new Map(), alightingRoutes = new Map();
    for (const st of times) {
        const route = routeForTrip.get(st.tripId);
        if (!route)
            continue;
        if (st.departureSeconds != null && (st.pickupType == null || st.pickupType === 0)) {
            const s = boardingRoutes.get(st.stopId) ?? new Set();
            s.add(route);
            boardingRoutes.set(st.stopId, s);
        }
        if (st.arrivalSeconds != null && (st.dropOffType == null || st.dropOffType === 0)) {
            const s = alightingRoutes.get(st.stopId) ?? new Set();
            s.add(route);
            alightingRoutes.set(st.stopId, s);
        }
    }
    const stopMap = new Map(stops.map(s => [s.id, s]));
    const transferPairs = [];
    const ids = [...stopMap.keys()];
    if ((req.maxTransfers ?? 1) > 0) {
        for (const a of ids) {
            const from = alightingRoutes.get(a);
            if (!from)
                continue;
            for (const b of ids) {
                if (a === b)
                    continue;
                const to = boardingRoutes.get(b);
                if (!to)
                    continue;
                if (![...from].some(fr => [...to].some(tr => fr !== tr)))
                    continue;
                transferPairs.push({ fromStopId: a, toStopId: b });
            }
        }
    }
    // Bound provider billing per user search. Expand only after measuring real Mayo results.
    const budget = Math.max(0, Math.min(opts.maxRequestCount ?? 24, 200));
    const paths = await (0, pedestrian_1.buildPedestrianPaths)(router, stops, req.origin, req.destination, {
        ...opts, maxRequestCount: budget, transferPairs,
        maxDirectWalkMeters: Math.min(opts.maxDirectWalkMeters ?? 1400, req.maxWalkingMeters ?? 2500),
        maxOriginStops: opts.maxOriginStops ?? 5,
        maxDestinationStops: opts.maxDestinationStops ?? 5,
        maxTransferPairs: (req.maxTransfers ?? 1) > 0 ? (opts.maxTransferPairs ?? 12) : 0,
    });
    const journeys = (0, engine_1.planJourneys)(data, paths, req);
    return { journeys, walkingRequestsBudget: budget, feedVersion: data.feedVersion };
}

  },
  './supabaseAdapter': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromSupabaseTables = fromSupabaseTables;
function str(v) { return v == null ? '' : String(v); }
function num(v) { return v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null; }
function normalDate(v) { return str(v).slice(0, 10); }
;
/** Call only with rows loaded for ONE active feed version by a trusted server-side repository. */
function fromSupabaseTables(t) {
    if (!t.feedVersion)
        throw new Error('missing_gtfs_version');
    for (const [table, rows] of Object.entries({ stops: t.stops, routes: t.routes, trips: t.trips, stopTimes: t.stopTimes, calendars: t.calendars, calendarDates: t.calendarDates })) {
        if (!Array.isArray(rows) || rows.some(row => row.version !== t.feedVersion))
            throw new Error(`mixed_gtfs_version_${table}`);
    }
    const stops = t.stops.filter(s => num(s.stop_lat) !== null && num(s.stop_lon) !== null).map(s => ({ id: str(s.stop_id), name: str(s.stop_name), lat: num(s.stop_lat), lon: num(s.stop_lon), code: str(s.stop_code) || null, description: str(s.stop_desc) || null, boarding: { confidence: 'official_unverified' } }));
    const routes = t.routes.map(r => ({ id: str(r.route_id), name: str(r.route_short_name) || str(r.route_long_name) || str(r.route_id), mode: num(r.route_type) === 2 ? 'rail' : 'bus' }));
    const trips = t.trips.map(x => ({ id: str(x.trip_id), routeId: str(x.route_id), serviceId: str(x.service_id), headsign: str(x.trip_headsign) || null }));
    const stopTimes = t.stopTimes.map(s => ({ tripId: str(s.trip_id), stopId: str(s.stop_id), sequence: num(s.stop_sequence) ?? -1, arrivalSeconds: num(s.arrival_seconds), departureSeconds: num(s.departure_seconds), pickupType: num(s.pickup_type), dropOffType: num(s.drop_off_type) }));
    const calendars = t.calendars.map(c => ({ serviceId: str(c.service_id), startDate: normalDate(c.start_date), endDate: normalDate(c.end_date), weekdays: [c.sunday === true, c.monday === true, c.tuesday === true, c.wednesday === true, c.thursday === true, c.friday === true, c.saturday === true] }));
    const exceptions = t.calendarDates.map(c => ({ serviceId: str(c.service_id), date: normalDate(c.service_date), type: num(c.exception_type) === 1 ? 1 : 2 }));
    return { feedVersion: t.feedVersion, timezone: 'Europe/Dublin', stops, routes, trips, stopTimes, calendars, exceptions };
}

  },
  './supabaseLimiter': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseRateLimiter = createSupabaseRateLimiter;
function createSupabaseRateLimiter(options) {
    const { supabaseUrl, privateKey } = options;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl) || !privateKey || /\s/.test(privateKey)) {
        throw new Error('invalid_rate_limiter_configuration');
    }
    const fetcher = options.fetcher ?? fetch;
    const timeout = options.timeoutMs ?? 6000;
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 20000)
        throw new Error('invalid_rate_limiter_timeout');
    const endpoint = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/consume_transport_api_rate_limit';
    const headers = { 'Content-Type': 'application/json', apikey: privateKey };
    if (privateKey.startsWith('eyJ'))
        headers.Authorization = `Bearer ${privateKey}`;
    return async (bucket, limit, windowSeconds) => {
        if (!bucket || bucket.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 1000 || ![60, 3600].includes(windowSeconds)) {
            throw new Error('invalid_rate_limit_args');
        }
        // Do not store literal remote IP in the database rate-limit key.
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ballina-routing-v1|' + bucket));
        const key = Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, '0')).join('');
        const response = await fetcher(endpoint, {
            method: 'POST', headers,
            body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds }),
            signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok)
            throw new Error('rate_limiter_unavailable');
        const result = await response.json();
        if (!Array.isArray(result) || result.length !== 1 || !result[0] || typeof result[0] !== 'object' || typeof result[0].allowed !== 'boolean') {
            throw new Error('invalid_rate_limiter_response');
        }
        return result[0].allowed;
    };
}

  },
  './time': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validDate = validDate;
exports.activeService = activeService;
exports.parseGtfsTime = parseGtfsTime;
exports.displayServiceTime = displayServiceTime;
exports.dstTransitionDay = dstTransitionDay;
const dateRx = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value) {
    if (!dateRx.test(value))
        return false;
    const dt = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}
function activeService(serviceId, date, calendars, exceptions) {
    if (!validDate(date))
        throw new Error('invalid_service_date');
    const exception = exceptions.find(x => x.serviceId === serviceId && x.date === date);
    if (exception)
        return exception.type === 1;
    const rule = calendars.find(x => x.serviceId === serviceId);
    if (!rule || date < rule.startDate || date > rule.endDate)
        return false;
    return rule.weekdays[new Date(date + 'T00:00:00Z').getUTCDay()] === true;
}
function parseGtfsTime(time) {
    const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(time);
    if (!match)
        throw new Error('invalid_gtfs_time');
    const h = Number(match[1]), m = Number(match[2]), s = Number(match[3]);
    if (h > 99 || m > 59 || s > 59)
        throw new Error('invalid_gtfs_time');
    return h * 3600 + m * 60 + s;
}
function displayServiceTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0)
        throw new Error('invalid_service_seconds');
    const whole = Math.floor(seconds);
    const d = Math.floor(whole / 86400);
    const h = Math.floor(whole % 86400 / 3600);
    const m = Math.floor(whole % 3600 / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${d ? ` (+${d}d)` : ''}`;
}
/** Used only to WARN on transition dates: this prototype never claims timezone-safe UTC ETAs on DST boundaries. */
function dstTransitionDay(date) {
    if (!validDate(date))
        throw new Error('invalid_service_date');
    const [yy, mm, dd] = date.split('-').map(Number);
    if (mm !== 3 && mm !== 10)
        return false;
    const dayOfWeek = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return dayOfWeek === 0 && dd + 7 > daysInMonth;
}

  },
  './types': function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

  },
};
const __ballinaCache = {};
function __ballinaRequire(moduleId) {
  const cached = __ballinaCache[moduleId];
  if (cached) return cached.exports;
  const factory = __ballinaModules[moduleId];
  if (!factory) throw new Error('unknown_module');
  const module = {exports: {}};
  __ballinaCache[moduleId] = module;
  factory(module, module.exports, __ballinaRequire);
  return module.exports;
}
const {createRoutingApi,createSnapshotCache}=__ballinaRequire('./httpApi');
const {loadActiveGtfsSnapshot}=__ballinaRequire('./gtfsSnapshot');
const {StadiaWalkingRouter}=__ballinaRequire('./pedestrian');
const {createSupabaseRateLimiter}=__ballinaRequire('./supabaseLimiter');

// Private integration preview. GET health is a configuration check;
// POST journeys is restricted to the backend secret key, never browser clients.
function readNamedKey(jsonEnv:string, envNames:string[]):string {
  const raw=Deno.env.get(jsonEnv);
  if(raw){try{const named=JSON.parse(raw);if(named&&typeof named.default==='string')return named.default;}catch{ /* fallback */ }}
  for(const name of envNames){const key=Deno.env.get(name);if(key)return key;}
  return '';
}
const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
const secret=readNamedKey('SUPABASE_SECRET_KEYS',['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SB_SERVICE_ROLE_KEY']);
const publishable=readNamedKey('SUPABASE_PUBLISHABLE_KEYS',['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY']);
const stadiaKey=Deno.env.get('STADIA_API_KEY')??'';
const ready=Boolean(supabaseUrl&&secret&&publishable&&stadiaKey);
const limiter=ready?createSupabaseRateLimiter({supabaseUrl,privateKey:secret}):null;
const routeHandler=ready?createRoutingApi({
  loadTimetable:createSnapshotCache(()=>loadActiveGtfsSnapshot({supabaseUrl,privateKey:secret}),300_000),
  router:new StadiaWalkingRouter(stadiaKey),
  clientIdentity:(_req)=>'private-preview',
  consumeRateLimit:limiter!,
  allowedOrigins:[],
}):null;
function answer(value:unknown,status=200):Response {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
Deno.serve(async(req:Request)=>{
  const path=new URL(req.url).pathname;
  const isHealth=path.endsWith('/health');
  const isJourney=path.endsWith('/v1/journeys');
  const isNearby=path.endsWith('/v1/nearby-stops');
  if(isHealth&&req.method==='GET'){
    if(!publishable||req.headers.get('apikey')!==publishable)return answer({error:'unauthorized'},401);
    return answer({service:'ballina-routing-preview',status:ready?'ready_for_private_testing':'missing_configuration',stadia_configured:Boolean(stadiaKey),public_planning_enabled:false});
  }
  if(!isJourney&&!isNearby)return answer({error:'not_found'},404);
  if(isJourney?req.method!=='POST':req.method!=='GET')return answer({error:'method_not_allowed'},405);
  if(!secret||req.headers.get('apikey')!==secret)return answer({error:'unauthorized'},401);
  if(!routeHandler)return answer({error:'preview_unavailable'},503);
  // The transport-neutral planner accepts its own fixed internal API pathname.
  const parsed=new URL(req.url);parsed.pathname=isJourney?'/v1/journeys':'/v1/nearby-stops';
  if(isJourney)parsed.search='';
  // Cloning the incoming request retains its streaming-body protocol semantics.
  return routeHandler(new Request(parsed,req));
});
