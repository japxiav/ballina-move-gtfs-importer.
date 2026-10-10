-- A09.1: read-only operator check. No RPC, write, activate, or cron changes.
-- Run manually in the Supabase SQL editor with a read-only role if possible.
WITH active AS (
  SELECT version, imported_at, feed_start_date, feed_end_date
  FROM public.gtfs_feed_versions WHERE active IS TRUE
),
summary AS (
 SELECT
   (SELECT COUNT(*) FROM active) AS active_feed_count,
   (SELECT MAX(imported_at) FROM active) AS last_gtfs_import,
   (SELECT MAX(feed_end_date) FROM active) AS gtfs_end_date,
   (SELECT COUNT(*) FROM public.gtfs_routes WHERE version IN (SELECT version FROM active)) AS routes,
   (SELECT COUNT(*) FROM public.gtfs_stops WHERE version IN (SELECT version FROM active)) AS stops,
   (SELECT COUNT(*) FROM public.gtfs_trips WHERE version IN (SELECT version FROM active)) AS trips,
   (SELECT COUNT(*) FROM public.gtfs_stop_times WHERE version IN (SELECT version FROM active)) AS stop_times,
   (SELECT COUNT(*) FROM public.gtfs_stop_times st
     LEFT JOIN public.gtfs_stops s ON s.version=st.version AND s.stop_id=st.stop_id
     WHERE st.version IN (SELECT version FROM active) AND s.stop_id IS NULL) AS orphan_stop_times_stops,
   (SELECT COUNT(*) FROM public.gtfs_stop_times st
     LEFT JOIN public.gtfs_trips t ON t.version=st.version AND t.trip_id=st.trip_id
     WHERE st.version IN (SELECT version FROM active) AND t.trip_id IS NULL) AS orphan_stop_times_trips,
   (SELECT COUNT(*) FROM public.gtfs_trips t
     LEFT JOIN public.gtfs_routes r ON r.version=t.version AND r.route_id=t.route_id
     WHERE t.version IN (SELECT version FROM active) AND r.route_id IS NULL) AS orphan_trips_routes,
   (SELECT MAX(completed_at) FROM public.collection_runs WHERE status='ok' AND channel='vehicle') AS latest_vehicle_ok,
   (SELECT MAX(completed_at) FROM public.collection_runs WHERE status='ok' AND channel='trip_update') AS latest_trip_update_ok
)
SELECT *,
 (active_feed_count=1 AND gtfs_end_date>=CURRENT_DATE AND
  orphan_stop_times_stops=0 AND orphan_stop_times_trips=0 AND orphan_trips_routes=0
 ) AS static_integrity_ok,
 (latest_vehicle_ok>=now()-interval '10 minutes' AND
  latest_trip_update_ok>=now()-interval '10 minutes'
 ) AS collector_fresh_last_10min,
 (last_gtfs_import>=now()-interval '7 days') AS imported_last_7_days
FROM summary;
