import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  clock,
  dateLabel,
  daySuffix,
  decodeQuery,
  defaultQuery,
  encodeQuery,
  fixtureService,
  minutes,
  place,
  places,
  validDate,
  validTime,
  type DemoJourney,
  type SearchQuery,
} from "./fixtures";
import { LiveMap } from "./LiveMap";
import { RealJourneys } from "./RealJourneys";
import "./styles.css";

type IconName =
  | "arrow"
  | "bus"
  | "walk"
  | "pin"
  | "swap"
  | "clock"
  | "check"
  | "leaf"
  | "info";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M4 12h16M14 6l6 6-6 6" />,
    bus: (
      <>
        <rect x="5" y="3" width="14" height="16" rx="3" />
        <path d="M5 11h14M8 19v2m8-2v2M8 15h.01M16 15h.01M9 6h6" />
      </>
    ),
    walk: (
      <>
        <circle cx="14" cy="4" r="2" />
        <path d="m7 12 4-4 4 2 4 1m-8-3-1 7-4 6m4-6 5 2 2 4" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    swap: <path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    leaf: (
      <>
        <path d="M20 3C8 2 3 8 5 15s15 5 15-12Z" />
        <path d="m4 21 11-11" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function CountyIllustration() {
  return (
    <svg
      className="county-art"
      viewBox="0 0 600 340"
      role="img"
      aria-label="Illustration of Ballina by the river with a bus; not a navigation map"
    >
      <rect width="600" height="340" rx="24" fill="#e8ebd7" />
      <circle cx="451" cy="72" r="36" fill="#e4b16c" />
      <path d="M0 168Q90 74 185 140T370 135T600 126V340H0" fill="#c5d1b4" />
      <path d="M0 225Q140 126 267 190T600 190V340H0" fill="#98b49c" />
      <path
        d="M338 340q-92-71-12-102t-12-71q36-5 65 0c77 34-38 51-21 78s76 50 105 95"
        fill="#b9d8d3"
      />
      <path
        d="M0 289q143-54 318-47t282 13v26q-130-25-280-16T0 319Z"
        fill="#f2eddf"
      />
      <path
        d="M252 248q66-23 128-3v21q-22-27-39 0-22-27-40 0-22-25-49 2Z"
        fill="#527664"
      />
      <g fill="#f3eddd" stroke="#527664" strokeWidth="2">
        <path d="M120 205v-65h31v65m-26-65v-37h21v37m-16-37V81h11v22" />
        <path d="m110 150 62 1v54h-62Z" />
        <path d="M173 207v-47h49v47m-54-48 30-21 29 21" />
      </g>
      <g fill="#527664">
        <path d="M135 83V70m-5 7h10" stroke="#527664" strokeWidth="2" />
        <rect x="130" y="120" width="10" height="16" rx="5" />
        <rect x="124" y="166" width="10" height="16" rx="5" />
        <rect x="145" y="166" width="10" height="16" rx="5" />
        <rect x="185" y="172" width="9" height="12" />
        <rect x="204" y="172" width="9" height="12" />
      </g>
      <g transform="translate(390 229)">
        <rect width="108" height="43" rx="10" fill="#254e43" />
        <rect x="8" y="7" width="67" height="17" rx="3" fill="#d3e6d9" />
        <rect x="81" y="7" width="18" height="29" rx="2" fill="#d3e6d9" />
        <path d="M30 7v17m22-17v17" stroke="#254e43" strokeWidth="3" />
        <circle cx="21" cy="43" r="8" fill="#203f38" />
        <circle cx="87" cy="43" r="8" fill="#203f38" />
      </g>
      <text
        x="27"
        y="315"
        fill="#254e43"
        fontSize="11"
        letterSpacing="3"
        fontFamily="sans-serif"
      >
        BALLINA · COUNTY MAYO
      </text>
    </svg>
  );
}
function DemoNotice() {
  return (
    <div className="demo-note">
      <Icon name="info" size={18} />
      <span>
        <strong>Demo data.</strong> Illustrative times and routes. Do not use for travel.
      </span>
    </div>
  );
}
function SearchForm({
  initial,
  compact = false,
}: {
  initial: SearchQuery;
  compact?: boolean;
}) {
  const [q, setQ] = useState(initial),
    [error, setError] = useState("");
  useEffect(() => {
    setQ(initial);
    setError("");
  }, [initial]);
  const update = <K extends keyof SearchQuery>(key: K, value: SearchQuery[K]) =>
    setQ((old) => ({ ...old, [key]: value }));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validDate(q.serviceDate) || !validTime(q.departAt)) {
      setError("Enter a valid date and time.");
      return;
    }
    if (q.origin === q.destination) {
      setError("Choose different start and destination points.");
      return;
    }
    if (q.modes.length === 0) {
      setError("Select at least one transport mode.");
      return;
    }
    setError("");
    window.location.hash = `/search?${encodeQuery(q)}`;
  }
  return (
    <form
      className={`search-form ${compact ? "search-compact" : ""}`}
      onSubmit={submit}
    >
      {!compact && (
        <>
          <div className="eyebrow">PLAN A JOURNEY</div>
          <h2>Plan your trip</h2>
          <p className="form-intro">Choose your destination.</p>
        </>
      )}
      <div className="places-grid">
        <label className="field">
          <span>
            <Icon name="pin" size={15} /> From
          </span>
          <select
            aria-label="From — Origin"
            value={q.origin}
            onChange={(e) =>
              update("origin", e.target.value as SearchQuery["origin"])
            }
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="swap-button"
          type="button"
          aria-label="Swap start and destination"
          onClick={() =>
            setQ((old) => ({
              ...old,
              origin: old.destination,
              destination: old.origin,
            }))
          }
        >
          <Icon name="swap" />
        </button>
        <label className="field">
          <span>
            <Icon name="pin" size={15} /> To
          </span>
          <select
            aria-label="To — Destination"
            value={q.destination}
            onChange={(e) =>
              update(
                "destination",
                e.target.value as SearchQuery["destination"],
              )
            }
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-pair">
        <label className="field">
          <span>Travel date</span>
          <input
            aria-label="Travel date"
            type="date"
            required
            value={q.serviceDate}
            onChange={(e) => update("serviceDate", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Leave after</span>
          <input
            aria-label="Leave after — Departure time"
            type="time"
            required
            value={q.departAt}
            onChange={(e) => update("departAt", e.target.value)}
          />
        </label>
      </div>
      <details className="search-options">
        <summary>
          <span>Filters</span>
          <span className="filter-summary">
            {q.prioritize === "fastest" ? "Arrive sooner" : q.prioritize === "less_walking" ? "Less walking" : "Fewer changes"}
            {" · "}{q.maxWalkingMeters >= 1000 ? `${q.maxWalkingMeters / 1000} km` : `${q.maxWalkingMeters} m`}
          </span>
        </summary>
        <div className="field-pair">
          <label className="field">
            <span>Priority</span>
            <select
              aria-label="Priority"
              value={q.prioritize}
              onChange={(e) =>
                update("prioritize", e.target.value as SearchQuery["prioritize"])
              }
            >
              <option value="fastest">Arrive sooner</option>
              <option value="less_walking">Less walking</option>
              <option value="fewest_transfers">Fewer changes</option>
            </select>
          </label>
          <label className="field">
            <span>Walking limit</span>
            <select
              aria-label="Walking limit"
              value={q.maxWalkingMeters}
              onChange={(e) => update("maxWalkingMeters", Number(e.target.value))}
            >
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={1500}>1.5 km</option>
              <option value={2500}>2.5 km</option>
            </select>
          </label>
        </div>
        <fieldset className="transport-modes">
          <legend>Transport</legend>
          {(["bus", "rail"] as const).map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={q.modes.includes(mode)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setQ((old) => ({
                    ...old,
                    modes: (["bus", "rail"] as const).filter((candidate) =>
                      candidate === mode ? checked : old.modes.includes(candidate),
                    ),
                  }));
                }}
              />
              {mode === "bus" ? "Bus" : "Train"}
            </label>
          ))}
          <p>Demo routes are bus-only.</p>
        </fieldset>
        <details className="demo-controls">
          <summary>Demo states</summary>
          <label>
            Demo response
            <select
              aria-label="Demo response"
              value={q.demoState}
              onChange={(e) =>
                update("demoState", e.target.value as SearchQuery["demoState"])
              }
            >
              <option value="normal">Example results</option>
              <option value="empty">No journeys</option>
              <option value="error">Service error</option>
            </select>
          </label>
          <p>Local simulation. No external requests.</p>
        </details>
      </details>
      <p className="timezone">
        <Icon name="clock" size={14} /> Ireland time · Europe/Dublin
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary search-submit" type="submit">
        Find journeys <Icon name="arrow" />
      </button>
    </form>
  );
}
function Home({ query }: { query: SearchQuery }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" /> BALLINA & MAYO
          </div>
          <h1>Your next <em>journey.</em></h1>
          <a className="live-entry" href="#/live">Track buses &amp; trains <Icon name="arrow" size={16} /></a>
          <a className="schedule-entry" href="#/plan">Search official timetables →</a>
          <p className="hero-description">
            Explore journeys around Ballina and County Mayo.
          </p>
          <div className="hero-tags">
            <span>
              <Icon name="bus" size={17} /> Bus
            </span>
            <span>
              <Icon name="walk" size={17} /> Walking
            </span>
            <span>
              <Icon name="leaf" size={17} /> At your pace
            </span>
          </div>
          <CountyIllustration />
        </div>
        <div className="search-panel">
          <SearchForm initial={query} />
          <div className="panel-foot">
            <span className="status-dot" /> Demo only · no live services
          </div>
        </div>
      </section>
      <DemoNotice />
      <section className="discover">
        <div className="section-heading">
          <div>
            <div className="eyebrow">EXPLORE MAYO</div>
            <h2>Quick trips</h2>
          </div>
          <span className="muted">Try a demo journey</span>
        </div>
        <div className="destination-grid">
          {(["foxford", "castlebar", "hospital"] as const).map((id, index) => (
            <a
              className={`destination destination-${index}`}
              key={id}
              href={`#/search?${encodeQuery({ ...query, origin: "ballina", destination: id, demoState: "normal" })}`}
            >
              <span className="destination-number">0{index + 1}</span>
              <Icon name={id === "hospital" ? "pin" : "bus"} size={28} />
              <h3>{place(id).name}</h3>
              <p>
                {
                  [
                    "By the River Moy",
                    "Explore Mayo",
                    "Mayo University Hospital",
                  ][index]
                }
              </p>
              <span className="destination-link">
                Try route <Icon name="arrow" size={18} />
              </span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
function RideBadges({ journey }: { journey: DemoJourney }) {
  return (
    <div className="ride-badges">
      <span className="walk-badge">
        <Icon name="walk" size={16} />
      </span>
      {journey.legs
        .filter((l) => l.type === "ride")
        .map((leg, i) => (
          <React.Fragment key={`${leg.tripId}-${i}`}>
            <span className="route-arrow">›</span>
            <span className="route-badge">
              <Icon name="bus" size={15} /> {leg.routeName}
            </span>
          </React.Fragment>
        ))}
      <span className="route-arrow">›</span>
      <span className="walk-badge">
        <Icon name="walk" size={16} />
      </span>
    </div>
  );
}
function JourneyCard({
  journey: j,
  query,
  index,
}: {
  journey: DemoJourney;
  query: SearchQuery;
  index: number;
}) {
  const leave = j.latestLeaveAtSeconds ?? j.departureAtSeconds;
  return (
    <article className={`journey-card ${index === 0 ? "recommended" : ""}`}>
      <div className="card-label">
        <span>
          {index === 0 ? "TOP PICK · " : ""}
          {j.label.toUpperCase()}
        </span>
        <span className="fixture-tag">FIXTURE</span>
      </div>
      <div className="card-main">
        <div>
          <div className="journey-times">
            <strong>{clock(leave)}</strong>
            <span className="time-line" />
            <strong>{clock(j.arrivalAtSeconds)}</strong>
          </div>
          <div className="time-captions">
            <span>Leave{daySuffix(leave)}</span>
            <span>Arrival{daySuffix(j.arrivalAtSeconds)}</span>
          </div>
        </div>
        <div className="journey-duration">
          <strong>
            {minutes(j.arrivalAtSeconds - leave)} <small>min</small>
          </strong>
          <span>estimated duration</span>
        </div>
      </div>
      <div className="card-bottom">
        <div>
          <RideBadges journey={j} />
          <p>
            {j.transfers === 0 ? "Direct" : `${j.transfers} change`}
            <span>·</span>
            {j.walkingMeters} m walking
          </p>
        </div>
        <a
          className="button secondary"
          href={`#/journey/${j.id}?${encodeQuery(query)}`}
          aria-label={`View details: ${j.label}`}
        >
          View details <Icon name="arrow" size={16} />
        </a>
      </div>
    </article>
  );
}
function CoverageAside() {
  return (
    <aside className="coverage-aside">
      <div className="eyebrow">KNOW YOUR JOURNEY</div>
      <h3>
        A journey is more
        <br />
        than a timetable.
      </h3>
      <div className="aside-art">
        <Icon name="leaf" size={56} />
        <span>
          Ballina
          <br />
          <em>& nearby</em>
        </span>
      </div>
      <ul>
        <li>
          <Icon name="check" size={18} /> Compare time and walking.
        </li>
        <li>
          <Icon name="check" size={18} /> See every journey step.
        </li>
        <li>
          <Icon name="info" size={18} /> Stops and accessibility are unverified.
        </li>
      </ul>
      <p>
        This version uses demo data. Real journeys need validated transport and walking information.
      </p>
      <a href="#/about">
        About <Icon name="arrow" size={16} />
      </a>
    </aside>
  );
}
function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-heading">
        <span className="spinner" /> Finding demo journeys…
      </div>
      {[0, 1, 2].map((n) => (
        <div className="skeleton" key={n}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
function EmptyState({ error, retry, railOnly = false }: {
  error: boolean;
  retry: () => void;
  railOnly?: boolean;
}) {
  return (
    <div className="empty-state" role={error ? "alert" : "status"}>
      <div className="empty-icon">
        <Icon name={error ? "info" : "bus"} size={36} />
      </div>
      <h2>
        {error ? "Unable to load journeys." : "No demo journeys found."}
      </h2>
      <p>
        {error
          ? "This is a simulated error. Retry or choose Example results in the form."
          : railOnly
            ? "This demo has no train examples."
            : "No demo options match. Try different places or a higher walking limit."}
      </p>
      {error && (
        <button className="button primary" onClick={retry}>
          Try again <Icon name="arrow" size={18} />
        </button>
      )}
      <a className="text-link" href="#/">
        Back to home
      </a>
    </div>
  );
}
function JourneyDetails({
  journey: j,
  query,
}: {
  journey: DemoJourney;
  query: SearchQuery;
}) {
  const leave = j.latestLeaveAtSeconds ?? j.departureAtSeconds;
  let cursor = leave;
  return (
    <>
      <a className="back-link" href={`#/search?${encodeQuery(query)}`}>
        <span>←</span> Back to results
      </a>
      <div className="detail-layout">
        <article className="itinerary">
          <div className="eyebrow">YOUR JOURNEY · DEMO DATA</div>
          <h1>
            {place(query.origin).name} <span className="title-arrow">→</span>{" "}
            {place(query.destination).name}
          </h1>
          <p className="muted">
            {dateLabel(query.serviceDate)} · Ireland time
          </p>
          <div className="itinerary-summary">
            <div>
              <strong>
                {clock(leave)}
                {daySuffix(leave)} → {clock(j.arrivalAtSeconds)}
                {daySuffix(j.arrivalAtSeconds)}
              </strong>
              <span>Illustrative departure and arrival</span>
            </div>
            <div>
              <strong>{minutes(j.arrivalAtSeconds - leave)} min</strong>
              <span>
                {j.walkingMeters} m walking ·{" "}
                {j.transfers ? "1 change" : "direct"}
              </span>
            </div>
          </div>
          <DemoNotice />
          <ol className="timeline">
            {j.legs.map((leg, i) => {
              const start = leg.type === "ride" ? leg.boardAtSeconds : cursor;
              const end =
                leg.type === "ride"
                  ? leg.alightAtSeconds
                  : start + leg.durationSeconds;
              const wait = start - cursor;
              cursor = end;
              const boarding =
                leg.type === "ride"
                  ? j.boardings.find((b) => b.stopId === leg.boardStopId)
                  : undefined;
              const destination =
                leg.type === "ride"
                  ? places.find((p) => p.code === leg.alightStopId)?.stop
                  : null;
              return (
                <li className={`timeline-step ${leg.type}`} key={i}>
                  {wait > 0 && (
                    <p className="wait-note">
                      <Icon name="clock" size={14} /> {minutes(wait)} min wait / boarding buffer
                    </p>
                  )}
                  <div className="step-header">
                    <span className="step-symbol">
                      <Icon
                        name={leg.type === "ride" ? "bus" : "walk"}
                        size={21}
                      />
                    </span>
                    <span className="step-time">
                      {clock(start)}
                      {daySuffix(start)}
                    </span>
                    <h3>
                      {leg.type === "ride"
                        ? `Bus ${leg.routeName}`
                        : leg.purpose === "access"
                          ? "Walk to the stop"
                          : "Walk to your destination"}
                    </h3>
                    <span className="step-duration">
                      {minutes(end - start)} min
                    </span>
                  </div>
                  {leg.type === "ride" ? (
                    <div className="step-body">
                      <p className="direction">
                        Towards {leg.headsign} · demo route
                      </p>
                      <div className="stop-line">
                        <span className="stop-dot" />
                        <div>
                          <strong>{boarding?.stopName}</strong>
                          <span>
                            {clock(start)} · Get on · stop code{" "}
                            {boarding?.stopCode}
                          </span>
                        </div>
                      </div>
                      <div className="stop-line">
                        <span className="stop-dot hollow" />
                        <div>
                          <strong>{destination}</strong>
                          <span>
                            {clock(end)}
                            {daySuffix(end)} · Get off
                          </span>
                        </div>
                      </div>
                      <p className="boarding-caveat">
                        <Icon name="info" size={15} /> {boarding?.caveat}
                      </p>
                    </div>
                  ) : (
                    <div className="step-body">
                      <p>
                        {leg.distanceMeters} m · demo walk, no verified path.
                      </p>
                      <p className="muted">
                        {leg.purpose === "access"
                          ? `From ${place(query.origin).name} to ${place(query.origin).stop}.`
                          : `From the arrival stop to ${place(query.destination).name}.`}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
            <li className="timeline-arrival">
              <span className="step-symbol">
                <Icon name="pin" size={20} />
              </span>
              <strong>
                {clock(j.arrivalAtSeconds)}
                {daySuffix(j.arrivalAtSeconds)} ·{" "}
                {place(query.destination).name}
              </strong>
              <span>Illustrative arrival</span>
            </li>
          </ol>
          <div className="detail-bottom">
            <Icon name="info" />
            <p>
              No live predictions, fares or verified walking directions.
            </p>
          </div>
        </article>
        <CoverageAside />
      </div>
    </>
  );
}
function SearchPage({
  query,
  journeyId,
}: {
  query: SearchQuery;
  journeyId?: string;
}) {
  const [state, setState] = useState<"loading" | "success" | "error">(
      "loading",
    ),
    [journeys, setJourneys] = useState<DemoJourney[]>([]),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setJourneys([]);
    fixtureService
      .search(query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setJourneys(result);
          setState("success");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [query, attempt]);
  const journey = journeys.find((j) => j.id === journeyId);
  if (journeyId)
    return state === "loading" ? (
      <Loading />
    ) : state === "error" ? (
      <EmptyState error retry={() => setAttempt((n) => n + 1)} />
    ) : journey ? (
      <JourneyDetails journey={journey} query={query} />
    ) : (
      <div className="empty-state">
        <h1>Journey not found.</h1>
        <p>This option is unavailable for these search filters.</p>
        <a className="button primary" href={`#/search?${encodeQuery(query)}`}>
          View results
        </a>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR JOURNEY</div>
          <h1>
            {place(query.origin).name} <span className="title-arrow">→</span>{" "}
            {place(query.destination).name}
          </h1>
          <p>
            {dateLabel(query.serviceDate)} · from {query.departAt} ·
            Ireland time
          </p>
        </div>
        <a className="text-link" href="#/">
          New search <Icon name="arrow" size={18} />
        </a>
      </div>
      <DemoNotice />
      <details className="edit-search">
        <summary>
          Edit search <Icon name="swap" size={17} />
        </summary>
        <SearchForm initial={query} compact />
      </details>
      <div className="results-layout">
        <section
          aria-label="Journey results"
          aria-busy={state === "loading"}
        >
          {state === "loading" ? (
            <Loading />
          ) : state === "error" ? (
            <EmptyState error retry={() => setAttempt((n) => n + 1)} />
          ) : journeys.length === 0 ? (
            <EmptyState
              error={false}
              retry={() => {}}
              railOnly={!query.modes.includes("bus")}
            />
          ) : (
            <>
              <div className="results-heading">
                <span>{journeys.length} demo options</span>
                <span>
                  Sorted by{" "}
                  {query.prioritize === "fastest"
                    ? "arrival"
                    : query.prioritize === "less_walking"
                      ? "walking"
                      : "changes"}
                </span>
              </div>
              {journeys.map((j, i) => (
                <JourneyCard key={j.id} journey={j} query={query} index={i} />
              ))}
              <p className="results-footnote">
                Demo times. No live predictions or fare comparison.
              </p>
            </>
          )}
        </section>
        <CoverageAside />
      </div>
    </>
  );
}
function About() {
  return (
    <article className="about-page">
      <div className="eyebrow">BALLINA MOVE</div>
      <h1>
        Local journeys.
        <br />
        <em>Clear information.</em>
      </h1>
      <p className="about-lead">
        Plan local journeys with clear, useful information.
      </p>
      <p className="schedule-note">Independent technical preview, not an official NTA or Irish Rail service. Walking, physical boarding access and accessibility are unverified. The free preview host may sleep when idle.</p>
      <div className="about-grid">
        <section>
          <span>01</span>
          <h2>Plan a journey</h2>
          <p>
            Choose covered stops, a date and time. Compare scheduled arrival and changes, then view each step. Coverage is limited to selected routes, not all of Mayo or Ireland.
          </p>
        </section>
        <section>
          <span>02</span>
          <h2>Know your data</h2>
          <p>
            Official schedules use the NTA timetable between covered stops. Delays, cancellations and walking directions are not applied to these itineraries. Demo routes remain explicitly synthetic. The Live map shows official observations separately.
          </p>
        </section>
        <section>
          <span>03</span>
          <h2>Vehicle locations</h2>
          <p>
            Bus locations include observation times. Irish Rail reports locations without their observation age or precision. A published snapshot is clearly labelled; continuous updates require the server gateway.
          </p>
        </section>
        <section>
          <span>04</span>
          <h2>Sources &amp; privacy</h2>
          <p>NTA timetable data is attributed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY 4.0</a>. Irish Rail reported positions and OpenStreetMap tiles have separate source policies.</p>
          <p>Your chosen stop IDs, date, time and transport filters are sent to the server and remain in the search URL and browser history. We do not offer accounts or request device geolocation. Hosting and data providers may process IP addresses and requests; OpenStreetMap receives your IP and the map area requested.</p>
          <p><a href="https://github.com/japxiav/ballina-move-gtfs-importer./issues/new" rel="noreferrer">Report a timetable issue</a>. Reports are public: include stop codes and the timetable date, without personal details or private locations.</p>
        </section>
      </div>
      <a className="button primary" href="#/demo">
        Explore the demo <Icon name="arrow" />
      </a>
    </article>
  );
}
function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  const main = useRef<HTMLElement>(null),
    previousHash = useRef(hash);
  useEffect(() => {
    const change = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (previousHash.current !== hash) main.current?.focus();
    previousHash.current = hash;
  }, [hash]);
  const fragment = hash.slice(1), question = fragment.indexOf("?");
  const path = question < 0 ? fragment : fragment.slice(0, question),
    search = question < 0 ? "" : fragment.slice(question + 1),
    isSearch = path === "/search",
    journeyMatch = /^\/journey\/([^/]+)$/.exec(path ?? ""),
    isJourney = journeyMatch !== null;
  const query = React.useMemo(() => decodeQuery(search), [search]),
    defaults = React.useMemo(defaultQuery, []);
  const scheduledMatch = /^\/scheduled\/([1-6]|j-[a-f0-9]{64})$/.exec(path);
  const isHome = !path || path === "/", isLive = path === "/live", isDemo = path === "/demo", isPlan = isHome || path === "/plan" || !!scheduledMatch;
  useEffect(() => {
    document.title = `${isLive ? "Live map" : isPlan ? "Official journeys" : isDemo ? "Your next journey" : isJourney ? "Journey" : isSearch ? "Journeys" : "About"} · Ballina Move`;
  }, [isHome, isJourney, isSearch, isLive, isPlan, isDemo]);
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Ballina Move, home">
          <span className="brand-mark">
            b<span>m</span>
            <i />
          </span>
          <span>
            ballina<span>move</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a
            className={isHome ? "active" : ""}
            href="#/"
            aria-current={isHome ? "page" : undefined}
          >
            Home
          </a>
          <a
            className={isSearch || isJourney || isPlan ? "active" : ""}
            href="#/plan"
            aria-current={isSearch || isJourney || isPlan ? "page" : undefined}
          >
            Journeys
          </a>
          <a className={isLive ? "active" : ""} href="#/live" aria-current={isLive ? "page" : undefined}>Live map</a>
          <a
            className={path === "/about" ? "active" : ""}
            href="#/about"
            aria-current={path === "/about" ? "page" : undefined}
          >
            About
          </a>
        </nav>
        <span className="header-demo">
          <span className="status-dot" /> {isLive ? "MAP" : isPlan ? "SCHEDULE" : "DEMO"}
        </span>
      </header>
      <main id="main-content" ref={main} tabIndex={-1}>
        {isHome ? (
          <RealJourneys search="" />
        ) : isDemo ? (
          <Home query={defaults} />
        ) : isLive ? (
          <LiveMap />
        ) : isPlan ? (
          <RealJourneys search={search} detailId={scheduledMatch?.[1]} />
        ) : isSearch || isJourney ? (
          query ? (
            <SearchPage
              key={encodeQuery(query)}
              query={query}
              journeyId={journeyMatch?.[1]}
            />
          ) : (
            <div className="empty-state" role="alert">
              <h1>Invalid search.</h1>
              <p>
                This link has invalid places, a date or filters.
              </p>
              <a className="button primary" href="#/">
                Start a new search
              </a>
            </div>
          )
        ) : path === "/about" ? (
          <About />
        ) : (
          <div className="empty-state">
            <h1>Page not found.</h1>
            <a className="button primary" href="#/">
              Back to home
            </a>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-brand">
          ballina move<span>Your next journey in Mayo.</span>
        </span>
        <span>
          {isLive || isPlan ? "Official transport sources" : "Demo prototype · Fixtures v1"}
          <br />
          {isLive || isPlan ? "Source timestamps shown. No paid requests." : "No live data. No paid requests."}
        </span>
        <a href="#/about">
          {isLive || isPlan ? "About Ballina Move" : "About this demo"} <Icon name="arrow" size={16} />
        </a>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
