-- Offline RPC test scaffold: actual column names/types; no production data or constraints.
CREATE TABLE public."collection_runs" (
 "id" uuid,
 "source" text,
 "channel" text,
 "started_at" timestamp with time zone,
 "completed_at" timestamp with time zone,
 "status" text,
 "http_status" integer,
 "feed_timestamp" timestamp with time zone,
 "total_entities" integer,
 "matched_entities" integer,
 "stored_observations" integer,
 "error_code" text,
 "metadata" jsonb
);
CREATE TABLE public."gtfs_calendar_dates" (
 "version" text,
 "service_id" text,
 "service_date" date,
 "exception_type" smallint
);
CREATE TABLE public."gtfs_calendars" (
 "version" text,
 "service_id" text,
 "monday" boolean,
 "tuesday" boolean,
 "wednesday" boolean,
 "thursday" boolean,
 "friday" boolean,
 "saturday" boolean,
 "sunday" boolean,
 "start_date" date,
 "end_date" date
);
CREATE TABLE public."gtfs_feed_versions" (
 "version" text,
 "label" text,
 "sha256" text,
 "source_url" text,
 "imported_at" timestamp with time zone,
 "active" boolean,
 "feed_start_date" date,
 "feed_end_date" date,
 "metadata" jsonb
);
CREATE TABLE public."gtfs_routes" (
 "version" text,
 "route_id" text,
 "agency_id" text,
 "route_short_name" text,
 "route_long_name" text,
 "route_type" integer,
 "route_desc" text,
 "route_url" text,
 "route_color" text,
 "route_text_color" text
);
CREATE TABLE public."gtfs_stop_times" (
 "version" text,
 "trip_id" text,
 "stop_sequence" integer,
 "stop_id" text,
 "arrival_seconds" integer,
 "departure_seconds" integer,
 "pickup_type" smallint,
 "drop_off_type" smallint,
 "monitored" boolean,
 "stop_headsign" text,
 "timepoint" smallint
);
CREATE TABLE public."gtfs_stops" (
 "version" text,
 "stop_id" text,
 "stop_name" text,
 "stop_lat" double precision,
 "stop_lon" double precision,
 "parent_station" text,
 "location_type" integer,
 "monitored" boolean,
 "stop_code" text,
 "stop_desc" text,
 "zone_id" text,
 "stop_url" text
);
CREATE TABLE public."gtfs_trips" (
 "version" text,
 "trip_id" text,
 "route_id" text,
 "service_id" text,
 "trip_headsign" text,
 "trip_short_name" text,
 "direction_id" smallint,
 "shape_id" text,
 "passes_monitored" boolean,
 "selected_by_route" boolean,
 "block_id" text
);
CREATE TABLE public."regional_routes" (
 "route_id" text,
 "route_name" text,
 "operator_name" text,
 "source" text,
 "feed_version" text,
 "imported_at" timestamp with time zone,
 "enabled" boolean,
 "collection_scope" text
);
CREATE TABLE public."service_observations" (
 "id" bigint,
 "run_id" uuid,
 "observed_at" timestamp with time zone,
 "channel" text,
 "entity_id" text,
 "route_id" text,
 "route_name" text,
 "operator_name" text,
 "trip_id" text,
 "service_date" date,
 "vehicle_id" text,
 "latitude" double precision,
 "longitude" double precision,
 "source_timestamp" timestamp with time zone,
 "delay_seconds" integer,
 "schedule_relationship" text,
 "payload" jsonb,
 "feed_version" text,
 "mapping_status" text,
 "trip_headsign" text,
 "direction_id" smallint
);
CREATE TABLE public."stop_predictions" (
 "id" bigint,
 "run_id" uuid,
 "observed_at" timestamp with time zone,
 "entity_id" text,
 "version" text,
 "route_id" text,
 "trip_id" text,
 "service_date" date,
 "stop_id" text,
 "stop_name" text,
 "stop_sequence" integer,
 "scheduled_arrival_seconds" integer,
 "scheduled_departure_seconds" integer,
 "predicted_arrival" timestamp with time zone,
 "predicted_departure" timestamp with time zone,
 "arrival_delay_seconds" integer,
 "departure_delay_seconds" integer,
 "schedule_relationship" text,
 "source_timestamp" timestamp with time zone,
 "prediction_source" text,
 "source_stop_sequence" integer,
 "trip_schedule_relationship" text,
 "direction_id" smallint
);
