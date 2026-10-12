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
      aria-label="Ilustração de Ballina junto ao rio, com ônibus; não é um mapa de navegação"
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
        <strong>Modo demonstração.</strong> Horários, linhas e caminhadas são
        fixtures ilustrativas. Não use estes resultados para viajar.
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
      setError("Informe uma data e um horário válidos.");
      return;
    }
    if (q.origin === q.destination) {
      setError("Escolha uma origem e um destino diferentes.");
      return;
    }
    if (q.modes.length === 0) {
      setError("Selecione pelo menos um meio de transporte.");
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
          <div className="eyebrow">SEU PRÓXIMO CAMINHO</div>
          <h2>Para onde vamos?</h2>
          <p className="form-intro">Uma viagem começa com uma boa escolha.</p>
        </>
      )}
      <div className="places-grid">
        <label className="field">
          <span>
            <Icon name="pin" size={15} /> De onde
          </span>
          <select
            aria-label="De onde — Origem"
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
          aria-label="Trocar origem e destino"
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
            <Icon name="pin" size={15} /> Para onde
          </span>
          <select
            aria-label="Para onde — Destino"
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
          <span>Data da viagem</span>
          <input
            aria-label="Data da viagem"
            type="date"
            required
            value={q.serviceDate}
            onChange={(e) => update("serviceDate", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Partir a partir de</span>
          <input
            aria-label="Partir a partir de — Horário de partida"
            type="time"
            required
            value={q.departAt}
            onChange={(e) => update("departAt", e.target.value)}
          />
        </label>
      </div>
      <div className="field-pair">
        <label className="field">
          <span>Minha prioridade</span>
          <select
            aria-label="Minha prioridade"
            value={q.prioritize}
            onChange={(e) =>
              update("prioritize", e.target.value as SearchQuery["prioritize"])
            }
          >
            <option value="fastest">Chegar mais cedo</option>
            <option value="less_walking">Caminhar menos</option>
            <option value="fewest_transfers">Menos conexões</option>
          </select>
        </label>
        <label className="field">
          <span>Caminhada máxima</span>
          <select
            aria-label="Caminhada máxima"
            value={q.maxWalkingMeters}
            onChange={(e) => update("maxWalkingMeters", Number(e.target.value))}
          >
            <option value={500}>500 m</option>
            <option value={1000}>1 km</option>
            <option value={1500}>1,5 km</option>
            <option value={2500}>2,5 km</option>
          </select>
        </label>
      </div>
      <fieldset className="transport-modes">
        <legend>Meios de transporte</legend>
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
            {mode === "bus" ? "Ônibus" : "Trem"}
          </label>
        ))}
        <p>Fixtures disponíveis: somente ônibus. O filtro não comprova cobertura real.</p>
      </fieldset>
      <p className="timezone">
        <Icon name="clock" size={14} /> Horário local da Irlanda · Europe/Dublin
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary search-submit" type="submit">
        Buscar viagens <Icon name="arrow" />
      </button>
      <details className="demo-controls">
        <summary>Explorar estados da demonstração</summary>
        <label>
          Resposta das fixtures
          <select
            aria-label="Resposta das fixtures"
            value={q.demoState}
            onChange={(e) =>
              update("demoState", e.target.value as SearchQuery["demoState"])
            }
          >
            <option value="normal">Resultados ilustrativos</option>
            <option value="empty">Nenhuma viagem</option>
            <option value="error">Erro de serviço</option>
          </select>
        </label>
        <p>Simulação local, sem chamadas externas.</p>
      </details>
    </form>
  );
}
function Home({ query }: { query: SearchQuery }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" /> FEITO PARA BALLINA E MAYO
          </div>
          <h1>
            Mais perto.
            <br />
            <em>Mais simples.</em>
            <br />
            Seu próximo caminho.
          </h1>
          <p className="hero-description">
            Da rotina a uma nova descoberta, explore conexões por Ballina e
            County Mayo, em um só lugar.
          </p>
          <div className="hero-tags">
            <span>
              <Icon name="bus" size={17} /> Ônibus
            </span>
            <span>
              <Icon name="walk" size={17} /> A pé
            </span>
            <span>
              <Icon name="leaf" size={17} /> No seu ritmo
            </span>
          </div>
          <CountyIllustration />
        </div>
        <div className="search-panel">
          <SearchForm initial={query} />
          <div className="panel-foot">
            <span className="status-dot" /> Demonstração local · sem consultas
            pagas
          </div>
        </div>
      </section>
      <DemoNotice />
      <section className="discover">
        <div className="section-heading">
          <div>
            <div className="eyebrow">UM LUGAR, MUITAS POSSIBILIDADES</div>
            <h2>Comece por aqui.</h2>
          </div>
          <span className="muted">Explore uma viagem de exemplo</span>
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
                    "Uma pausa junto ao River Moy",
                    "Uma nova conexão em Mayo",
                    "Um caminho para o cuidado",
                  ][index]
                }
              </p>
              <span className="destination-link">
                Ver exemplo <Icon name="arrow" size={18} />
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
          {index === 0 ? "PRIMEIRA OPÇÃO · " : ""}
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
            <span>Saída sugerida{daySuffix(leave)}</span>
            <span>Chegada{daySuffix(j.arrivalAtSeconds)}</span>
          </div>
        </div>
        <div className="journey-duration">
          <strong>
            {minutes(j.arrivalAtSeconds - leave)} <small>min</small>
          </strong>
          <span>duração estimada</span>
        </div>
      </div>
      <div className="card-bottom">
        <div>
          <RideBadges journey={j} />
          <p>
            {j.transfers === 0 ? "Sem conexão" : `${j.transfers} conexão`}
            <span>·</span>
            {j.walkingMeters} m a pé
          </p>
        </div>
        <a
          className="button secondary"
          href={`#/journey/${j.id}?${encodeQuery(query)}`}
          aria-label={`Ver detalhes: ${j.label}`}
        >
          Ver detalhes <Icon name="arrow" size={16} />
        </a>
      </div>
    </article>
  );
}
function CoverageAside() {
  return (
    <aside className="coverage-aside">
      <div className="eyebrow">VIAJE COM CONTEXTO</div>
      <h3>
        O caminho é mais
        <br />
        que um horário.
      </h3>
      <div className="aside-art">
        <Icon name="leaf" size={56} />
        <span>
          Ballina
          <br />
          <em>& arredores</em>
        </span>
      </div>
      <ul>
        <li>
          <Icon name="check" size={18} /> Compare tempo e caminhada.
        </li>
        <li>
          <Icon name="check" size={18} /> Veja cada etapa da viagem.
        </li>
        <li>
          <Icon name="info" size={18} /> Paradas e acessibilidade ainda não
          verificadas.
        </li>
      </ul>
      <p>
        Esta versão usa apenas exemplos. Uma integração segura com dados reais
        será necessária antes do uso em viagens.
      </p>
      <a href="#/about">
        Como funciona <Icon name="arrow" size={16} />
      </a>
    </aside>
  );
}
function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-heading">
        <span className="spinner" /> Buscando viagens de demonstração…
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
        {error ? "Uma pausa no caminho." : "Nenhuma viagem neste exemplo."}
      </h2>
      <p>
        {error
          ? "Simulamos uma falha no serviço. Você pode tentar novamente ou escolher “Resultados ilustrativos” no formulário."
          : railOnly
            ? "Esta demonstração não contém exemplos de trem."
            : "As fixtures não têm opções para esta combinação. Tente outros locais ou ajuste a caminhada máxima."}
      </p>
      {error && (
        <button className="button primary" onClick={retry}>
          Tentar novamente <Icon name="arrow" size={18} />
        </button>
      )}
      <a className="text-link" href="#/">
        Voltar ao início
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
        <span>←</span> Voltar aos resultados
      </a>
      <div className="detail-layout">
        <article className="itinerary">
          <div className="eyebrow">SEU ITINERÁRIO · FIXTURE ILUSTRATIVA</div>
          <h1>
            {place(query.origin).name} <span className="title-arrow">→</span>{" "}
            {place(query.destination).name}
          </h1>
          <p className="muted">
            {dateLabel(query.serviceDate)} · horário local da Irlanda
          </p>
          <div className="itinerary-summary">
            <div>
              <strong>
                {clock(leave)}
                {daySuffix(leave)} → {clock(j.arrivalAtSeconds)}
                {daySuffix(j.arrivalAtSeconds)}
              </strong>
              <span>Saída sugerida e chegada ilustrativas</span>
            </div>
            <div>
              <strong>{minutes(j.arrivalAtSeconds - leave)} min</strong>
              <span>
                {j.walkingMeters} m a pé ·{" "}
                {j.transfers ? "1 conexão" : "sem conexão"}
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
                      <Icon name="clock" size={14} /> {minutes(wait)} min de
                      espera / margem de embarque
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
                        ? `Ônibus ${leg.routeName}`
                        : leg.purpose === "access"
                          ? "Caminhe até a parada"
                          : "Caminhe até o destino"}
                    </h3>
                    <span className="step-duration">
                      {minutes(end - start)} min
                    </span>
                  </div>
                  {leg.type === "ride" ? (
                    <div className="step-body">
                      <p className="direction">
                        Sentido {leg.headsign} · linha ilustrativa
                      </p>
                      <div className="stop-line">
                        <span className="stop-dot" />
                        <div>
                          <strong>{boarding?.stopName}</strong>
                          <span>
                            {clock(start)} · Embarque · código{" "}
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
                            {daySuffix(end)} · Desembarque
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
                        {leg.distanceMeters} m · caminhada sintética, sem
                        trajeto verificado.
                      </p>
                      <p className="muted">
                        {leg.purpose === "access"
                          ? `De ${place(query.origin).name} até ${place(query.origin).stop}.`
                          : `Da parada de chegada até ${place(query.destination).name}.`}
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
              <span>Chegada ilustrativa</span>
            </li>
          </ol>
          <div className="detail-bottom">
            <Icon name="info" />
            <p>
              Sem previsões em tempo real, tarifas, garantia de serviço ou
              orientação de calçadas. Nenhuma geometria real foi verificada.
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
        <h1>Itinerário não encontrado.</h1>
        <p>Esta opção não está disponível para os filtros da pesquisa.</p>
        <a className="button primary" href={`#/search?${encodeQuery(query)}`}>
          Ver resultados
        </a>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ESCOLHA O SEU CAMINHO</div>
          <h1>
            {place(query.origin).name} <span className="title-arrow">→</span>{" "}
            {place(query.destination).name}
          </h1>
          <p>
            {dateLabel(query.serviceDate)} · a partir de {query.departAt} ·
            horário da Irlanda
          </p>
        </div>
        <a className="text-link" href="#/">
          Nova pesquisa <Icon name="arrow" size={18} />
        </a>
      </div>
      <DemoNotice />
      <details className="edit-search">
        <summary>
          Alterar pesquisa <Icon name="swap" size={17} />
        </summary>
        <SearchForm initial={query} compact />
      </details>
      <div className="results-layout">
        <section
          aria-label="Resultados de viagens"
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
                <span>{journeys.length} opções ilustrativas</span>
                <span>
                  Ordenadas por{" "}
                  {query.prioritize === "fastest"
                    ? "chegada"
                    : query.prioritize === "less_walking"
                      ? "caminhada"
                      : "conexões"}
                </span>
              </div>
              {journeys.map((j, i) => (
                <JourneyCard key={j.id} journey={j} query={query} index={i} />
              ))}
              <p className="results-footnote">
                Tempos demonstrativos. Sem previsões ao vivo ou comparação de
                tarifas.
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
      <div className="eyebrow">O PRIMEIRO PASSO</div>
      <h1>
        Mobilidade local.
        <br />
        <em>Informação clara.</em>
      </h1>
      <p className="about-lead">
        Ballina Move começa com uma ideia simples: entender uma viagem deve ser
        tão fácil quanto escolher o destino.
      </p>
      <DemoNotice />
      <div className="about-grid">
        <section>
          <span>01</span>
          <h2>Explore uma viagem</h2>
          <p>
            Escolha locais, data e horário. Compare opções por chegada,
            caminhada e conexões. Abra os detalhes para ver as etapas.
          </p>
        </section>
        <section>
          <span>02</span>
          <h2>Saiba o que está vendo</h2>
          <p>
            Todos os resultados são sintéticos. Os locais referenciam Mayo, mas
            horários, distâncias e linhas são exemplos, sem garantia de
            operação.
          </p>
        </section>
        <section>
          <span>03</span>
          <h2>O próximo caminho</h2>
          <p>
            Dados reais dependem de um gateway seguro. Paradas, acessibilidade,
            caminhos a pé e previsões ao vivo precisam de validação antes de
            orientar passageiros.
          </p>
        </section>
      </div>
      <a className="button primary" href="#/">
        Explorar demonstração <Icon name="arrow" />
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
  const isHome = !path || path === "/";
  useEffect(() => {
    document.title = `${isHome ? "Seu próximo caminho" : isJourney ? "Itinerário" : isSearch ? "Viagens" : "Como funciona"} · Ballina Move`;
  }, [isHome, isJourney, isSearch]);
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
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Ballina Move, início">
          <span className="brand-mark">
            b<span>m</span>
            <i />
          </span>
          <span>
            ballina<span>move</span>
          </span>
        </a>
        <nav aria-label="Navegação principal">
          <a
            className={isHome ? "active" : ""}
            href="#/"
            aria-current={isHome ? "page" : undefined}
          >
            Início
          </a>
          <a
            className={isSearch || isJourney ? "active" : ""}
            href={`#/search?${encodeQuery(defaults)}`}
            aria-current={isSearch || isJourney ? "page" : undefined}
          >
            Viagens
          </a>
          <a
            className={path === "/about" ? "active" : ""}
            href="#/about"
            aria-current={path === "/about" ? "page" : undefined}
          >
            Como funciona
          </a>
        </nav>
        <span className="header-demo">
          <span className="status-dot" /> DEMONSTRAÇÃO
        </span>
      </header>
      <main id="main-content" ref={main} tabIndex={-1}>
        {isHome ? (
          <Home query={defaults} />
        ) : isSearch || isJourney ? (
          query ? (
            <SearchPage
              key={encodeQuery(query)}
              query={query}
              journeyId={journeyMatch?.[1]}
            />
          ) : (
            <div className="empty-state" role="alert">
              <h1>Pesquisa inválida.</h1>
              <p>
                O link não contém uma combinação válida de locais, data e
                filtros.
              </p>
              <a className="button primary" href="#/">
                Iniciar nova pesquisa
              </a>
            </div>
          )
        ) : path === "/about" ? (
          <About />
        ) : (
          <div className="empty-state">
            <h1>Este caminho não existe.</h1>
            <a className="button primary" href="#/">
              Voltar ao início
            </a>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-brand">
          ballina move<span>Um próximo caminho para Mayo.</span>
        </span>
        <span>
          Protótipo navegável · Fixtures v1
          <br />
          Sem dados ao vivo. Sem consultas pagas.
        </span>
        <a href="#/about">
          Sobre esta demonstração <Icon name="arrow" size={16} />
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
