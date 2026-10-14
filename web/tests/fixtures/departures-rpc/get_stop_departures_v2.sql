CREATE OR REPLACE FUNCTION public.get_stop_departures_v2(p_stop_ids text[], p_from timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 40)
 RETURNS TABLE(stop_id text, stop_name text, route_id text, route_name text, route_long_name text, operator_name text, trip_id text, trip_headsign text, direction_id smallint, scheduled_at timestamp with time zone, expected_at timestamp with time zone, delay_seconds integer, realtime_observed_at timestamp with time zone, realtime_source_timestamp timestamp with time zone, realtime_age_seconds integer, data_status text, service_status text, prediction_source text, source_stop_sequence integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with params as (
  select
    coalesce(p_from,now())::timestamptz as from_ts,
    (coalesce(p_from,now()) at time zone 'Europe/Dublin')::date as local_date,
    coalesce(p_stop_ids,array[]::text[]) as stop_ids,
    greatest(1,least(coalesce(p_limit,40),100)) as row_limit
),
feed as (
  select version
  from public.gtfs_feed_versions
  where active and label='nta-realtime'
  order by imported_at desc
  limit 1
),
service_days as (
  select gs::date as service_date
  from params p,
       generate_series(p.local_date-1,p.local_date+1,interval '1 day') gs
),
base_services as (
  select sd.service_date,c.service_id
  from service_days sd
  join feed f on true
  join public.gtfs_calendars c
    on c.version=f.version
   and sd.service_date between c.start_date and c.end_date
   and case extract(isodow from sd.service_date)::int
     when 1 then c.monday
     when 2 then c.tuesday
     when 3 then c.wednesday
     when 4 then c.thursday
     when 5 then c.friday
     when 6 then c.saturday
     when 7 then c.sunday
   end
  where not exists (
    select 1
    from public.gtfs_calendar_dates cd
    where cd.version=f.version
      and cd.service_id=c.service_id
      and cd.service_date=sd.service_date
      and cd.exception_type=2
  )
),
added_services as (
  select sd.service_date,cd.service_id
  from service_days sd
  join feed f on true
  join public.gtfs_calendar_dates cd
    on cd.version=f.version
   and cd.service_date=sd.service_date
   and cd.exception_type=1
),
active_services as (
  select * from base_services
  union
  select * from added_services
),
latest_rt as (
  select distinct on (sp.version,sp.trip_id,sp.stop_id,sp.service_date)
    sp.version,
    sp.trip_id,
    sp.stop_id,
    sp.service_date,
    sp.predicted_arrival,
    sp.predicted_departure,
    sp.arrival_delay_seconds,
    sp.departure_delay_seconds,
    sp.schedule_relationship as stop_schedule_relationship,
    sp.trip_schedule_relationship,
    sp.prediction_source,
    sp.source_stop_sequence,
    sp.observed_at,
    sp.source_timestamp
  from public.stop_predictions sp
  join feed f on f.version=sp.version
  join params p on true
  where coalesce(sp.source_timestamp,sp.observed_at)
        >= p.from_ts - interval '15 minutes'
    and exists (select 1 from public.collection_runs cr
        where cr.channel='trip_update' and cr.status='ok'
        and cr.started_at >= clock_timestamp() - interval '4 minutes')
  order by
    sp.version,sp.trip_id,sp.stop_id,sp.service_date,
    coalesce(sp.source_timestamp,sp.observed_at) desc,
    sp.observed_at desc
),
latest_trip as (
  select distinct on (o.feed_version,o.trip_id,o.service_date)
    o.feed_version as version,
    o.trip_id,
    o.service_date,
    o.schedule_relationship as trip_schedule_relationship,
    o.observed_at,
    o.source_timestamp
  from public.service_observations o
  join feed f on f.version=o.feed_version
  join params p on true
  where o.channel='trip_update'
    and o.mapping_status='exact_trip'
    and o.trip_id is not null
    and o.service_date is not null
    and coalesce(o.source_timestamp,o.observed_at)
        >= p.from_ts - interval '15 minutes'
    and exists (select 1 from public.collection_runs cr
        where cr.channel='trip_update' and cr.status='ok'
        and cr.started_at >= clock_timestamp() - interval '4 minutes')
  order by
    o.feed_version,o.trip_id,o.service_date,
    coalesce(o.source_timestamp,o.observed_at) desc,
    o.observed_at desc
),
scheduled as (
  select
    s.stop_id,
    s.stop_name,
    r.route_id,
    coalesce(rr.route_name,r.route_short_name,r.route_long_name) as route_name,
    r.route_long_name,
    rr.operator_name,
    t.trip_id,
    t.trip_headsign,
    t.direction_id,
    a.service_date,
    (
      (
        (
          (a.service_date::timestamp + interval '12 hours')
          at time zone 'Europe/Dublin'
        )
        - interval '12 hours'
        + make_interval(secs=>coalesce(st.departure_seconds,st.arrival_seconds,0))
      )
    ) as scheduled_at,
    rt.predicted_arrival,
    rt.predicted_departure,
    rt.arrival_delay_seconds,
    rt.departure_delay_seconds,
    rt.stop_schedule_relationship,
    coalesce(
      lt.trip_schedule_relationship,
      rt.trip_schedule_relationship
    ) as trip_schedule_relationship,
    rt.prediction_source,
    rt.source_stop_sequence,
    rt.observed_at as prediction_observed_at,
    rt.source_timestamp as prediction_source_timestamp,
    lt.observed_at as trip_observed_at,
    lt.source_timestamp as trip_source_timestamp,
    exists (
      select 1
      from public.stop_predictions sp_stale
      join params p_stale on true
      where sp_stale.version=t.version
        and sp_stale.trip_id=t.trip_id
        and sp_stale.stop_id=st.stop_id
        and sp_stale.service_date=a.service_date
        and coalesce(sp_stale.source_timestamp,sp_stale.observed_at)
            < p_stale.from_ts - interval '15 minutes'
        and coalesce(sp_stale.source_timestamp,sp_stale.observed_at)
            >= p_stale.from_ts - interval '2 hours'
    ) or exists (
      select 1 from public.service_observations obs_stale
      join params p_stale on true
      where obs_stale.feed_version=t.version
        and obs_stale.trip_id=t.trip_id
        and obs_stale.service_date=a.service_date
        and obs_stale.channel='trip_update'
        and obs_stale.mapping_status='exact_trip'
        and coalesce(obs_stale.source_timestamp,obs_stale.observed_at) < p_stale.from_ts - interval '15 minutes'
        and coalesce(obs_stale.source_timestamp,obs_stale.observed_at) >= p_stale.from_ts - interval '2 hours'
    ) as stale_realtime_seen
  from active_services a
  join feed f on true
  join public.gtfs_trips t
    on t.version=f.version and t.service_id=a.service_id
  join public.gtfs_stop_times st
    on st.version=t.version and st.trip_id=t.trip_id
  join public.gtfs_stops s
    on s.version=st.version and s.stop_id=st.stop_id
  join public.gtfs_routes r
    on r.version=t.version and r.route_id=t.route_id
  join public.regional_routes rr
    on rr.route_id=t.route_id and rr.enabled
  join params p
    on s.stop_id=any(p.stop_ids)
  left join latest_rt rt
    on rt.version=t.version
   and rt.trip_id=t.trip_id
   and rt.stop_id=st.stop_id
   and rt.service_date=a.service_date
  left join latest_trip lt
    on lt.version=t.version
   and lt.trip_id=t.trip_id
   and lt.service_date=a.service_date
  where coalesce(st.pickup_type,0) <> 1
),
classified as (
  select
    s.*,
    case
      when upper(coalesce(s.trip_schedule_relationship,''))='CANCELED' then 'canceled'
      when upper(coalesce(s.stop_schedule_relationship,''))='SKIPPED' then 'skipped'
      when upper(coalesce(s.stop_schedule_relationship,''))='NO_DATA' then 'no_data'
      else 'scheduled'
    end as service_status,
    coalesce(s.departure_delay_seconds,s.arrival_delay_seconds) as resolved_delay_seconds
  from scheduled s
),
resolved as (
  select
    c.*,
    case
      when c.service_status in ('canceled','skipped','no_data')
        then c.scheduled_at
      when coalesce(c.predicted_departure,c.predicted_arrival) is not null
        then coalesce(c.predicted_departure,c.predicted_arrival)
      when c.prediction_observed_at is not null
           and c.resolved_delay_seconds is not null
        then c.scheduled_at + make_interval(secs=>c.resolved_delay_seconds)
      else c.scheduled_at
    end as resolved_expected_at,
    case
      when c.service_status='canceled' then 'realtime_canceled'
      when c.service_status='skipped' then 'realtime_skipped'
      when c.service_status='no_data' then 'scheduled_no_realtime'
      when coalesce(c.predicted_departure,c.predicted_arrival) is not null
        then 'realtime_explicit'
      when c.prediction_observed_at is not null
           and c.resolved_delay_seconds is not null
           and c.prediction_source='propagated'
        then 'realtime_propagated'
      when c.prediction_observed_at is not null
           and c.resolved_delay_seconds is not null
           and c.prediction_source='trip_delay'
        then 'realtime_trip_delay'
      when c.prediction_observed_at is not null
           and c.resolved_delay_seconds is not null
        then 'realtime_derived'
      when c.stale_realtime_seen or not exists (select 1 from public.collection_runs cr where cr.channel='trip_update' and cr.status='ok' and cr.started_at >= clock_timestamp() - interval '4 minutes') then 'scheduled_no_realtime'
      else 'scheduled'
    end as resolved_data_status,
    case
      when c.service_status='canceled'
        then coalesce(c.trip_observed_at,c.prediction_observed_at)
      else c.prediction_observed_at
    end as resolved_observed_at,
    case
      when c.service_status='canceled'
        then coalesce(c.trip_source_timestamp,c.trip_observed_at)
      else coalesce(c.prediction_source_timestamp,c.prediction_observed_at)
    end as resolved_source_timestamp
  from classified c
)
select
  r.stop_id,
  r.stop_name,
  r.route_id,
  r.route_name,
  r.route_long_name,
  r.operator_name,
  r.trip_id,
  r.trip_headsign,
  r.direction_id,
  r.scheduled_at,
  r.resolved_expected_at as expected_at,
  case
    when r.service_status in ('canceled','skipped','no_data') then null
    else r.resolved_delay_seconds
  end as delay_seconds,
  r.resolved_observed_at as realtime_observed_at,
  r.resolved_source_timestamp as realtime_source_timestamp,
  case
    when r.resolved_source_timestamp is null then null
    else greatest(
      0,
      extract(epoch from (p.from_ts-r.resolved_source_timestamp))::integer
    )
  end as realtime_age_seconds,
  r.resolved_data_status as data_status,
  r.service_status,
  r.prediction_source,
  r.source_stop_sequence
from resolved r
join params p on true
where r.resolved_expected_at >= p.from_ts - interval '3 minutes'
order by r.resolved_expected_at,r.route_name,r.trip_id
limit (select row_limit from params);
$function$
