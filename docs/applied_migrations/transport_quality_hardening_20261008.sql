-- Ballina Move: protect departures and preserve realtime evidence for later quality analysis.
-- Does not expose any table or RPC to anon/authenticated roles.

create table if not exists public.transport_trip_stop_history (
  version text not null,
  service_date date not null,
  trip_id text not null,
  stop_id text not null,
  route_id text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  last_source_timestamp timestamptz,
  evidence_count bigint not null default 0,
  last_prediction_source text,
  last_stop_relationship text,
  last_trip_relationship text,
  last_delay_seconds integer,
  last_predicted_at timestamptz,
  scheduled_seconds integer,
  ever_no_data boolean not null default false,
  ever_skipped boolean not null default false,
  ever_canceled boolean not null default false,
  primary key(version,service_date,trip_id,stop_id)
);
create index if not exists transport_trip_stop_history_route_day_idx
  on public.transport_trip_stop_history(route_id,service_date,stop_id);
alter table public.transport_trip_stop_history enable row level security;
revoke all on public.transport_trip_stop_history from public, anon, authenticated;
grant select,insert,update,delete on public.transport_trip_stop_history to service_role;

-- This is an archive of prediction EVIDENCE, not evidence of actual punctuality.
create or replace function public.capture_transport_prediction_history()
returns bigint
language plpgsql
security definer
set search_path to ''
as $history$
declare stored_rows bigint := 0;
begin
  with snapshots as (
    select
      version,service_date,trip_id,stop_id,
      (array_agg(route_id order by observed_at desc, id desc))[1] as route_id,
      min(observed_at) as first_observed_at,
      max(observed_at) as last_observed_at,
      (array_agg(source_timestamp order by observed_at desc, id desc))[1] as last_source_timestamp,
      count(*) as evidence_count,
      (array_agg(prediction_source order by observed_at desc,id desc))[1] as last_prediction_source,
      (array_agg(schedule_relationship order by observed_at desc,id desc))[1] as last_stop_relationship,
      (array_agg(trip_schedule_relationship order by observed_at desc,id desc))[1] as last_trip_relationship,
      (array_agg(coalesce(departure_delay_seconds,arrival_delay_seconds) order by observed_at desc,id desc))[1] as last_delay_seconds,
      (array_agg(coalesce(predicted_departure,predicted_arrival) order by observed_at desc,id desc))[1] as last_predicted_at,
      (array_agg(coalesce(scheduled_departure_seconds,scheduled_arrival_seconds) order by observed_at desc,id desc))[1] as scheduled_seconds,
      bool_or(upper(coalesce(schedule_relationship,''))='NO_DATA') as ever_no_data,
      bool_or(upper(coalesce(schedule_relationship,''))='SKIPPED') as ever_skipped,
      bool_or(upper(coalesce(trip_schedule_relationship,''))='CANCELED') as ever_canceled
    from public.stop_predictions
    where service_date is not null and version is not null
    group by version,service_date,trip_id,stop_id
  )
  insert into public.transport_trip_stop_history as h (
    version,service_date,trip_id,stop_id,route_id,
    first_observed_at,last_observed_at,last_source_timestamp,evidence_count,
    last_prediction_source,last_stop_relationship,last_trip_relationship,
    last_delay_seconds,last_predicted_at,scheduled_seconds,
    ever_no_data,ever_skipped,ever_canceled
  )
  select version,service_date,trip_id,stop_id,route_id,
    first_observed_at,last_observed_at,last_source_timestamp,evidence_count,
    last_prediction_source,last_stop_relationship,last_trip_relationship,
    last_delay_seconds,last_predicted_at,scheduled_seconds,
    ever_no_data,ever_skipped,ever_canceled
  from snapshots
  on conflict(version,service_date,trip_id,stop_id) do update set
    route_id=case when excluded.last_observed_at >= h.last_observed_at then excluded.route_id else h.route_id end,
    first_observed_at=least(h.first_observed_at,excluded.first_observed_at),
    last_observed_at=greatest(h.last_observed_at,excluded.last_observed_at),
    last_source_timestamp=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_source_timestamp else h.last_source_timestamp end,
    evidence_count=greatest(h.evidence_count,excluded.evidence_count),
    last_prediction_source=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_prediction_source else h.last_prediction_source end,
    last_stop_relationship=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_stop_relationship else h.last_stop_relationship end,
    last_trip_relationship=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_trip_relationship else h.last_trip_relationship end,
    last_delay_seconds=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_delay_seconds else h.last_delay_seconds end,
    last_predicted_at=case when excluded.last_observed_at >= h.last_observed_at then excluded.last_predicted_at else h.last_predicted_at end,
    scheduled_seconds=case when excluded.last_observed_at >= h.last_observed_at then excluded.scheduled_seconds else h.scheduled_seconds end,
    ever_no_data=h.ever_no_data or excluded.ever_no_data,
    ever_skipped=h.ever_skipped or excluded.ever_skipped,
    ever_canceled=h.ever_canceled or excluded.ever_canceled;
  get diagnostics stored_rows = row_count;
  return stored_rows;
end;
$history$;
revoke all on function public.capture_transport_prediction_history() from public,anon,authenticated;
grant execute on function public.capture_transport_prediction_history() to service_role;

-- Archive vehicle sightings as distinct evidence from arrival predictions.
-- This does NOT assert a scheduled stop was served.
create table if not exists public.transport_vehicle_trip_history (
  version text not null,
  service_date date not null,
  route_id text not null,
  trip_id text not null,
  vehicle_key text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  gps_samples bigint not null,
  last_latitude double precision,
  last_longitude double precision,
  primary key(version, service_date, route_id, trip_id, vehicle_key)
);
create index if not exists transport_vehicle_trip_history_route_day_idx
 on public.transport_vehicle_trip_history(route_id,service_date);
alter table public.transport_vehicle_trip_history enable row level security;
revoke all on public.transport_vehicle_trip_history from public,anon,authenticated;
grant select,insert,update,delete on public.transport_vehicle_trip_history to service_role;

create or replace function public.capture_transport_vehicle_history()
returns bigint
language plpgsql
security definer
set search_path to ''
as $history$
declare stored_rows bigint := 0;
begin
  with sightings as (
    select
      o.feed_version as version,
      coalesce(o.service_date,(o.observed_at at time zone 'Europe/Dublin')::date) as service_date,
      o.route_id,
      coalesce(o.trip_id,'') as trip_id,
      coalesce(o.vehicle_id,o.entity_id,'') as vehicle_key,
      min(o.observed_at) as first_observed_at,
      max(o.observed_at) as last_observed_at,
      count(*) as gps_samples,
      (array_agg(o.latitude order by o.observed_at desc, o.id desc))[1] as last_latitude,
      (array_agg(o.longitude order by o.observed_at desc, o.id desc))[1] as last_longitude
    from public.service_observations o
    where o.channel='vehicle' and o.feed_version is not null
      and o.latitude is not null and o.longitude is not null
    group by o.feed_version,
      coalesce(o.service_date,(o.observed_at at time zone 'Europe/Dublin')::date),
      o.route_id,coalesce(o.trip_id,''),coalesce(o.vehicle_id,o.entity_id,'')
  )
  insert into public.transport_vehicle_trip_history as h (
    version,service_date,route_id,trip_id,vehicle_key,first_observed_at,last_observed_at,
    gps_samples,last_latitude,last_longitude
  )
  select version,service_date,route_id,trip_id,vehicle_key,first_observed_at,last_observed_at,
    gps_samples,last_latitude,last_longitude from sightings
  on conflict(version,service_date,route_id,trip_id,vehicle_key) do update set
    first_observed_at=least(h.first_observed_at,excluded.first_observed_at),
    last_observed_at=greatest(h.last_observed_at,excluded.last_observed_at),
    gps_samples=greatest(h.gps_samples,excluded.gps_samples),
    last_latitude=case when excluded.last_observed_at>=h.last_observed_at then excluded.last_latitude else h.last_latitude end,
    last_longitude=case when excluded.last_observed_at>=h.last_observed_at then excluded.last_longitude else h.last_longitude end;
  get diagnostics stored_rows = row_count;
  return stored_rows;
end;
$history$;
revoke all on function public.capture_transport_vehicle_history() from public,anon,authenticated;
grant execute on function public.capture_transport_vehicle_history() to service_role;

-- Store pre-migration DDL for supervised rollback, backend-only.
create table if not exists public.transport_function_backups (
  release_id text not null,
  function_name text not null,
  definition text not null,
  saved_at timestamptz not null default now(),
  primary key(release_id,function_name)
);
alter table public.transport_function_backups enable row level security;
revoke all on public.transport_function_backups from public,anon,authenticated;
grant select,insert,update on public.transport_function_backups to service_role;
insert into public.transport_function_backups(release_id,function_name,definition)
select 'pre_transport_hardening_20261008',p.proname,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_stop_departures_v2','get_live_vehicles','finalize_gtfs_import','prune_transport_history')
on conflict do nothing;

-- Fail closed if the production functions differ from the audited version.
-- Replacing only exact known SQL clauses preserves all previous DST and GTFS semantics.
do $patch$
declare src text;
  before_pickup text := E'   and lt.service_date=a.service_date\n),\nclassified as (';
  after_pickup text := E'   and lt.service_date=a.service_date\n  where coalesce(st.pickup_type,0) <> 1\n),\nclassified as (';
  before_stale text := E'    ) as stale_realtime_seen';
  before_vehicle text := $$  where o.channel='vehicle'$$;
  after_vehicle text := $$  where o.channel='vehicle'
    and o.feed_version = (select version from public.gtfs_feed_versions where label='nta-realtime' and active limit 1)$$;
  after_stale text := E'    ) or exists (\n      select 1 from public.service_observations obs_stale\n      join params p_stale on true\n      where obs_stale.feed_version=t.version\n        and obs_stale.trip_id=t.trip_id\n        and obs_stale.service_date=a.service_date\n        and obs_stale.channel=\'trip_update\'\n        and obs_stale.mapping_status=\'exact_trip\'\n        and coalesce(obs_stale.source_timestamp,obs_stale.observed_at) < p_stale.from_ts - interval \'15 minutes\'\n        and coalesce(obs_stale.source_timestamp,obs_stale.observed_at) >= p_stale.from_ts - interval \'2 hours\'\n    ) as stale_realtime_seen';
  before_retention text := E'  delete from public.collection_runs\n  where';
  after_retention text := E'  perform public.capture_transport_prediction_history();\n  perform public.capture_transport_vehicle_history();\n\n  delete from public.collection_runs\n  where';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_stop_departures_v2';
  if src is null or position(before_pickup in src)=0 or position(before_stale in src)=0
      or position(E'        >= p.from_ts - interval \'15 minutes\'\n  order by' in src)=0 then
    raise exception 'get_stop_departures_v2_source_changed_abort_migration';
  end if;
  src:=replace(src,before_pickup,after_pickup);
  src:=replace(src,before_stale,after_stale);
  -- The latest realtime data are only authoritative while the TripUpdates
  -- collector has a recent successful heartbeat. Otherwise show schedules as
  -- unconfirmed instead of resurrecting a cancellation.
  src:=replace(src,
    E'        >= p.from_ts - interval \'15 minutes\'\n  order by',
    E'        >= p.from_ts - interval \'15 minutes\'\n    and exists (select 1 from public.collection_runs cr\n        where cr.channel=\'trip_update\' and cr.status=\'ok\'\n        and cr.started_at >= clock_timestamp() - interval \'4 minutes\')\n  order by');
  src:=replace(src,
    $$      when c.stale_realtime_seen then 'scheduled_no_realtime'$$,
    $$      when c.stale_realtime_seen or not exists (select 1 from public.collection_runs cr where cr.channel='trip_update' and cr.status='ok' and cr.started_at >= clock_timestamp() - interval '4 minutes') then 'scheduled_no_realtime'$$);
  execute src;

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_live_vehicles';
  if src is null or position(before_vehicle in src)=0 then
    raise exception 'get_live_vehicles_source_changed_abort_migration';
  end if;
  src:=replace(src,before_vehicle,after_vehicle);
  execute src;

  -- Correct a metadata field that otherwise says active=false after promotion.
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='finalize_gtfs_import';
  if src is null or position($$'schema_completeness','complete_nta_feed'$$ in src)=0 then
    raise exception 'finalize_gtfs_import_source_changed_abort_migration';
  end if;
  src:=replace(src,$$'schema_completeness','complete_nta_feed'$$,
    $$'schema_completeness','complete_nta_feed', 'active',true$$);
  execute src;

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='prune_transport_history';
  if src is null or position(before_retention in src)=0 then
    raise exception 'prune_transport_history_source_changed_abort_migration';
  end if;
  src:=replace(src,before_retention,after_retention);
  execute src;
end;
$patch$;

-- Run once during deployment; future daily cleanup persists latest evidence
-- BEFORE its 14-day cascaded data deletion.
select public.capture_transport_prediction_history();
select public.capture_transport_vehicle_history();

-- Heal previously contradictory active metadata (the real active column remains authoritative).
update public.gtfs_feed_versions
set metadata = (coalesce(metadata,'{}'::jsonb) - 'active') || jsonb_build_object('active',true)
where active and label='nta-realtime';
