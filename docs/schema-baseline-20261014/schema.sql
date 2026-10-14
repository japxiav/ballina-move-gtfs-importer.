-- Read-only public application schema baseline. No data, vault values or cron jobs.

SET check_function_bodies = off;

CREATE TABLE public."api_rate_limits" (
  "rate_key" text NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."api_rate_limits" ADD CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY (rate_key);

ALTER TABLE public."api_rate_limits" ADD CONSTRAINT "api_rate_limits_request_count_check" CHECK ((request_count >= 0));

ALTER TABLE public."api_rate_limits" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."collection_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "channel" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "status" text NOT NULL,
  "http_status" integer,
  "feed_timestamp" timestamp with time zone,
  "total_entities" integer,
  "matched_entities" integer,
  "stored_observations" integer,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE public."collection_runs" ADD CONSTRAINT "collection_runs_pkey" PRIMARY KEY (id);

ALTER TABLE public."collection_runs" ADD CONSTRAINT "collection_runs_status_check" CHECK ((status = ANY (ARRAY['started'::text, 'ok'::text, 'http_error'::text, 'parse_error'::text, 'skipped'::text])));

CREATE INDEX collection_runs_started_idx ON public.collection_runs USING btree (started_at DESC);

ALTER TABLE public."collection_runs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."collector_state" (
  "singleton" boolean DEFAULT true NOT NULL,
  "next_channel" text NOT NULL,
  "last_claimed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "min_interval_seconds" integer DEFAULT 61 NOT NULL,
  "history_quality_cutoff" timestamp with time zone DEFAULT '2026-10-06 08:37:00+00'::timestamp with time zone NOT NULL,
  "collector_version" text DEFAULT 'v6'::text NOT NULL
);

ALTER TABLE public."collector_state" ADD CONSTRAINT "collector_state_min_interval_check" CHECK (((min_interval_seconds >= 60) AND (min_interval_seconds <= 300)));

ALTER TABLE public."collector_state" ADD CONSTRAINT "collector_state_next_channel_check" CHECK ((next_channel = ANY (ARRAY['trip_update'::text, 'vehicle'::text])));

ALTER TABLE public."collector_state" ADD CONSTRAINT "collector_state_pkey" PRIMARY KEY (singleton);

ALTER TABLE public."collector_state" ADD CONSTRAINT "collector_state_singleton_check" CHECK (singleton);

ALTER TABLE public."collector_state" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_agencies" (
  "version" text NOT NULL,
  "agency_id" text NOT NULL,
  "agency_name" text NOT NULL,
  "agency_url" text,
  "agency_timezone" text
);

ALTER TABLE public."gtfs_agencies" ADD CONSTRAINT "gtfs_agencies_pkey" PRIMARY KEY (version, agency_id);

ALTER TABLE public."gtfs_agencies" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_calendar_dates" (
  "version" text NOT NULL,
  "service_id" text NOT NULL,
  "service_date" date NOT NULL,
  "exception_type" smallint NOT NULL
);

ALTER TABLE public."gtfs_calendar_dates" ADD CONSTRAINT "gtfs_calendar_dates_exception_type_check" CHECK ((exception_type = ANY (ARRAY[1, 2])));

ALTER TABLE public."gtfs_calendar_dates" ADD CONSTRAINT "gtfs_calendar_dates_pkey" PRIMARY KEY (version, service_id, service_date);

ALTER TABLE public."gtfs_calendar_dates" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_calendars" (
  "version" text NOT NULL,
  "service_id" text NOT NULL,
  "monday" boolean NOT NULL,
  "tuesday" boolean NOT NULL,
  "wednesday" boolean NOT NULL,
  "thursday" boolean NOT NULL,
  "friday" boolean NOT NULL,
  "saturday" boolean NOT NULL,
  "sunday" boolean NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL
);

ALTER TABLE public."gtfs_calendars" ADD CONSTRAINT "gtfs_calendars_pkey" PRIMARY KEY (version, service_id);

ALTER TABLE public."gtfs_calendars" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_feed_info" (
  "version" text NOT NULL,
  "feed_publisher_name" text NOT NULL,
  "feed_publisher_url" text,
  "feed_lang" text,
  "feed_start_date" date,
  "feed_end_date" date,
  "source_feed_version" text,
  "feed_contact_email" text
);

ALTER TABLE public."gtfs_feed_info" ADD CONSTRAINT "gtfs_feed_info_pkey" PRIMARY KEY (version);

ALTER TABLE public."gtfs_feed_info" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_feed_versions" (
  "version" text NOT NULL,
  "label" text NOT NULL,
  "sha256" text NOT NULL,
  "source_url" text,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "active" boolean DEFAULT false NOT NULL,
  "feed_start_date" date,
  "feed_end_date" date,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE public."gtfs_feed_versions" ADD CONSTRAINT "gtfs_feed_versions_label_sha256_key" UNIQUE (label, sha256);

ALTER TABLE public."gtfs_feed_versions" ADD CONSTRAINT "gtfs_feed_versions_pkey" PRIMARY KEY (version);

CREATE UNIQUE INDEX gtfs_one_active_label_idx ON public.gtfs_feed_versions USING btree (label) WHERE active;

ALTER TABLE public."gtfs_feed_versions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_import_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "status" text NOT NULL,
  "source_url" text NOT NULL,
  "source_sha256" text,
  "version" text,
  "source_bytes" bigint,
  "source_last_modified" text,
  "importer_version" text NOT NULL,
  "config_sha256" text,
  "active_before" text,
  "active_after" text,
  "route_count" integer,
  "stop_count" integer,
  "trip_count" integer,
  "stop_time_count" integer,
  "shape_point_count" integer,
  "monitored_stop_count" integer,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_etag" text
);

ALTER TABLE public."gtfs_import_runs" ADD CONSTRAINT "gtfs_import_runs_pkey" PRIMARY KEY (id);

ALTER TABLE public."gtfs_import_runs" ADD CONSTRAINT "gtfs_import_runs_status_check" CHECK ((status = ANY (ARRAY['started'::text, 'unchanged'::text, 'validated'::text, 'deferred'::text, 'importing'::text, 'activated'::text, 'failed'::text])));

CREATE INDEX gtfs_import_runs_started_idx ON public.gtfs_import_runs USING btree (started_at DESC);

CREATE INDEX gtfs_import_runs_version_idx ON public.gtfs_import_runs USING btree (version, started_at DESC);

ALTER TABLE public."gtfs_import_runs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_import_state" (
  "singleton" boolean DEFAULT true NOT NULL,
  "lock_id" uuid,
  "locked_at" timestamp with time zone,
  "locked_until" timestamp with time zone,
  "owner" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."gtfs_import_state" ADD CONSTRAINT "gtfs_import_state_pkey" PRIMARY KEY (singleton);

ALTER TABLE public."gtfs_import_state" ADD CONSTRAINT "gtfs_import_state_singleton_check" CHECK (singleton);

ALTER TABLE public."gtfs_import_state" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_import_targets" (
  "target_id" text NOT NULL,
  "canonical_stop_id" text,
  "expected_name" text NOT NULL,
  "expected_lat" double precision NOT NULL,
  "expected_lon" double precision NOT NULL,
  "fallback_radius_m" integer DEFAULT 750 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."gtfs_import_targets" ADD CONSTRAINT "gtfs_import_targets_lat_check" CHECK (((expected_lat >= ('-90'::integer)::double precision) AND (expected_lat <= (90)::double precision)));

ALTER TABLE public."gtfs_import_targets" ADD CONSTRAINT "gtfs_import_targets_lon_check" CHECK (((expected_lon >= ('-180'::integer)::double precision) AND (expected_lon <= (180)::double precision)));

ALTER TABLE public."gtfs_import_targets" ADD CONSTRAINT "gtfs_import_targets_pkey" PRIMARY KEY (target_id);

ALTER TABLE public."gtfs_import_targets" ADD CONSTRAINT "gtfs_import_targets_radius_check" CHECK (((fallback_radius_m >= 50) AND (fallback_radius_m <= 5000)));

ALTER TABLE public."gtfs_import_targets" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_routes" (
  "version" text NOT NULL,
  "route_id" text NOT NULL,
  "agency_id" text,
  "route_short_name" text,
  "route_long_name" text,
  "route_type" integer,
  "route_desc" text,
  "route_url" text,
  "route_color" text,
  "route_text_color" text
);

ALTER TABLE public."gtfs_routes" ADD CONSTRAINT "gtfs_routes_pkey" PRIMARY KEY (version, route_id);

ALTER TABLE public."gtfs_routes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_shapes" (
  "version" text NOT NULL,
  "shape_id" text NOT NULL,
  "shape_pt_lat" double precision NOT NULL,
  "shape_pt_lon" double precision NOT NULL,
  "shape_pt_sequence" integer NOT NULL,
  "shape_dist_traveled" double precision
);

ALTER TABLE public."gtfs_shapes" ADD CONSTRAINT "gtfs_shapes_pkey" PRIMARY KEY (version, shape_id, shape_pt_sequence);

CREATE INDEX gtfs_shapes_shape_idx ON public.gtfs_shapes USING btree (version, shape_id, shape_pt_sequence);

ALTER TABLE public."gtfs_shapes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_stop_times" (
  "version" text NOT NULL,
  "trip_id" text NOT NULL,
  "stop_sequence" integer NOT NULL,
  "stop_id" text NOT NULL,
  "arrival_seconds" integer,
  "departure_seconds" integer,
  "pickup_type" smallint,
  "drop_off_type" smallint,
  "monitored" boolean DEFAULT false NOT NULL,
  "stop_headsign" text,
  "timepoint" smallint
);

ALTER TABLE public."gtfs_stop_times" ADD CONSTRAINT "gtfs_stop_times_pkey" PRIMARY KEY (version, trip_id, stop_sequence);

CREATE INDEX gtfs_stop_times_stop_idx ON public.gtfs_stop_times USING btree (version, stop_id, trip_id);

CREATE INDEX gtfs_stop_times_monitored_idx ON public.gtfs_stop_times USING btree (version, trip_id) WHERE monitored;

ALTER TABLE public."gtfs_stop_times" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_stops" (
  "version" text NOT NULL,
  "stop_id" text NOT NULL,
  "stop_name" text NOT NULL,
  "stop_lat" double precision,
  "stop_lon" double precision,
  "parent_station" text,
  "location_type" integer,
  "monitored" boolean DEFAULT false NOT NULL,
  "stop_code" text,
  "stop_desc" text,
  "zone_id" text,
  "stop_url" text
);

ALTER TABLE public."gtfs_stops" ADD CONSTRAINT "gtfs_stops_pkey" PRIMARY KEY (version, stop_id);

ALTER TABLE public."gtfs_stops" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_translations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.gtfs_translations_id_seq INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
  "version" text NOT NULL,
  "table_name" text NOT NULL,
  "field_name" text NOT NULL,
  "language" text NOT NULL,
  "translation" text NOT NULL,
  "record_id" text,
  "field_value" text
);

ALTER TABLE public."gtfs_translations" ADD CONSTRAINT "gtfs_translations_pkey" PRIMARY KEY (id);

ALTER TABLE public."gtfs_translations" ADD CONSTRAINT "gtfs_translations_unique" UNIQUE NULLS NOT DISTINCT (version, table_name, field_name, language, record_id, field_value);

CREATE INDEX gtfs_translations_lookup_idx ON public.gtfs_translations USING btree (version, table_name, field_name, language);

ALTER TABLE public."gtfs_translations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."gtfs_trips" (
  "version" text NOT NULL,
  "trip_id" text NOT NULL,
  "route_id" text NOT NULL,
  "service_id" text NOT NULL,
  "trip_headsign" text,
  "trip_short_name" text,
  "direction_id" smallint,
  "shape_id" text,
  "passes_monitored" boolean DEFAULT false NOT NULL,
  "selected_by_route" boolean DEFAULT false NOT NULL,
  "block_id" text
);

ALTER TABLE public."gtfs_trips" ADD CONSTRAINT "gtfs_trips_pkey" PRIMARY KEY (version, trip_id);

CREATE INDEX gtfs_trips_route_idx ON public.gtfs_trips USING btree (version, route_id);

CREATE INDEX gtfs_trips_shape_idx ON public.gtfs_trips USING btree (version, shape_id) WHERE (shape_id IS NOT NULL);

ALTER TABLE public."gtfs_trips" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."regional_routes" (
  "route_id" text NOT NULL,
  "route_name" text NOT NULL,
  "operator_name" text NOT NULL,
  "source" text DEFAULT 'nta_gtfs'::text NOT NULL,
  "feed_version" text NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "collection_scope" text DEFAULT 'local_trips'::text NOT NULL
);

ALTER TABLE public."regional_routes" ADD CONSTRAINT "regional_routes_collection_scope_check" CHECK ((collection_scope = ANY (ARRAY['local_trips'::text, 'all_trips'::text])));

ALTER TABLE public."regional_routes" ADD CONSTRAINT "regional_routes_pkey" PRIMARY KEY (route_id);

ALTER TABLE public."regional_routes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."service_observations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.service_observations_id_seq INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
  "run_id" uuid NOT NULL,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "channel" text NOT NULL,
  "entity_id" text NOT NULL,
  "route_id" text NOT NULL,
  "route_name" text NOT NULL,
  "operator_name" text NOT NULL,
  "trip_id" text,
  "service_date" date,
  "vehicle_id" text,
  "latitude" double precision,
  "longitude" double precision,
  "source_timestamp" timestamp with time zone,
  "delay_seconds" integer,
  "schedule_relationship" text,
  "payload" jsonb NOT NULL,
  "feed_version" text,
  "mapping_status" text DEFAULT 'route_only'::text NOT NULL,
  "trip_headsign" text,
  "direction_id" smallint
);

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_channel_check" CHECK ((channel = ANY (ARRAY['trip_update'::text, 'vehicle'::text])));

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_mapping_status_check" CHECK ((mapping_status = ANY (ARRAY['exact_trip'::text, 'route_only'::text, 'unmapped_trip'::text, 'route_mismatch'::text, 'realtime_only_trip'::text])));

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_pkey" PRIMARY KEY (id);

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_run_id_channel_entity_id_key" UNIQUE (run_id, channel, entity_id);

CREATE INDEX service_observations_route_time_idx ON public.service_observations USING btree (route_name, observed_at DESC);

CREATE INDEX service_observations_trip_time_idx ON public.service_observations USING btree (trip_id, observed_at DESC);

CREATE INDEX service_observations_position_idx ON public.service_observations USING btree (observed_at DESC) WHERE (latitude IS NOT NULL);

CREATE INDEX service_observations_route_id_time_idx ON public.service_observations USING btree (route_id, observed_at DESC);

ALTER TABLE public."service_observations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."stop_predictions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.stop_predictions_id_seq INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 START 1 CACHE 1 NO CYCLE) NOT NULL,
  "run_id" uuid NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "entity_id" text NOT NULL,
  "version" text NOT NULL,
  "route_id" text NOT NULL,
  "trip_id" text NOT NULL,
  "service_date" date,
  "stop_id" text NOT NULL,
  "stop_name" text NOT NULL,
  "stop_sequence" integer,
  "scheduled_arrival_seconds" integer,
  "scheduled_departure_seconds" integer,
  "predicted_arrival" timestamp with time zone,
  "predicted_departure" timestamp with time zone,
  "arrival_delay_seconds" integer,
  "departure_delay_seconds" integer,
  "schedule_relationship" text,
  "source_timestamp" timestamp with time zone,
  "prediction_source" text DEFAULT 'explicit'::text NOT NULL,
  "source_stop_sequence" integer,
  "trip_schedule_relationship" text,
  "direction_id" smallint
);

ALTER TABLE public."stop_predictions" ADD CONSTRAINT "stop_predictions_pkey" PRIMARY KEY (id);

ALTER TABLE public."stop_predictions" ADD CONSTRAINT "stop_predictions_prediction_source_check" CHECK ((prediction_source = ANY (ARRAY['explicit'::text, 'propagated'::text, 'trip_delay'::text, 'no_data'::text, 'unknown'::text])));

ALTER TABLE public."stop_predictions" ADD CONSTRAINT "stop_predictions_run_id_entity_id_stop_id_stop_sequence_key" UNIQUE (run_id, entity_id, stop_id, stop_sequence);

CREATE INDEX stop_predictions_stop_time_idx ON public.stop_predictions USING btree (stop_id, observed_at DESC);

CREATE INDEX stop_predictions_trip_time_idx ON public.stop_predictions USING btree (trip_id, observed_at DESC);

CREATE INDEX stop_predictions_source_time_idx ON public.stop_predictions USING btree (stop_id, source_timestamp DESC) WHERE (source_timestamp IS NOT NULL);

CREATE INDEX stop_predictions_realtime_only_idx ON public.stop_predictions USING btree (stop_id, trip_schedule_relationship, source_timestamp DESC) WHERE (trip_schedule_relationship = ANY (ARRAY['ADDED'::text, 'UNSCHEDULED'::text, 'REPLACEMENT'::text, 'DUPLICATED'::text]));

ALTER TABLE public."stop_predictions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."transport_function_backups" (
  "release_id" text NOT NULL,
  "function_name" text NOT NULL,
  "definition" text NOT NULL,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."transport_function_backups" ADD CONSTRAINT "transport_function_backups_pkey" PRIMARY KEY (release_id, function_name);

ALTER TABLE public."transport_function_backups" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."transport_trip_stop_history" (
  "version" text NOT NULL,
  "service_date" date NOT NULL,
  "trip_id" text NOT NULL,
  "stop_id" text NOT NULL,
  "route_id" text NOT NULL,
  "first_observed_at" timestamp with time zone NOT NULL,
  "last_observed_at" timestamp with time zone NOT NULL,
  "last_source_timestamp" timestamp with time zone,
  "evidence_count" bigint DEFAULT 0 NOT NULL,
  "last_prediction_source" text,
  "last_stop_relationship" text,
  "last_trip_relationship" text,
  "last_delay_seconds" integer,
  "last_predicted_at" timestamp with time zone,
  "scheduled_seconds" integer,
  "ever_no_data" boolean DEFAULT false NOT NULL,
  "ever_skipped" boolean DEFAULT false NOT NULL,
  "ever_canceled" boolean DEFAULT false NOT NULL
);

ALTER TABLE public."transport_trip_stop_history" ADD CONSTRAINT "transport_trip_stop_history_pkey" PRIMARY KEY (version, service_date, trip_id, stop_id);

CREATE INDEX transport_trip_stop_history_route_day_idx ON public.transport_trip_stop_history USING btree (route_id, service_date, stop_id);

ALTER TABLE public."transport_trip_stop_history" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."transport_vehicle_trip_history" (
  "version" text NOT NULL,
  "service_date" date NOT NULL,
  "route_id" text NOT NULL,
  "trip_id" text NOT NULL,
  "vehicle_key" text NOT NULL,
  "first_observed_at" timestamp with time zone NOT NULL,
  "last_observed_at" timestamp with time zone NOT NULL,
  "gps_samples" bigint NOT NULL,
  "last_latitude" double precision,
  "last_longitude" double precision
);

ALTER TABLE public."transport_vehicle_trip_history" ADD CONSTRAINT "transport_vehicle_trip_history_pkey" PRIMARY KEY (version, service_date, route_id, trip_id, vehicle_key);

CREATE INDEX transport_vehicle_trip_history_route_day_idx ON public.transport_vehicle_trip_history USING btree (route_id, service_date);

ALTER TABLE public."transport_vehicle_trip_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."gtfs_agencies" ADD CONSTRAINT "gtfs_agencies_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_calendar_dates" ADD CONSTRAINT "gtfs_calendar_dates_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_calendars" ADD CONSTRAINT "gtfs_calendars_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_feed_info" ADD CONSTRAINT "gtfs_feed_info_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_routes" ADD CONSTRAINT "gtfs_routes_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_shapes" ADD CONSTRAINT "gtfs_shapes_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_stop_times" ADD CONSTRAINT "gtfs_stop_times_version_stop_id_fkey" FOREIGN KEY (version, stop_id) REFERENCES gtfs_stops(version, stop_id) ON DELETE CASCADE;

ALTER TABLE public."gtfs_stop_times" ADD CONSTRAINT "gtfs_stop_times_version_trip_id_fkey" FOREIGN KEY (version, trip_id) REFERENCES gtfs_trips(version, trip_id) ON DELETE CASCADE;

ALTER TABLE public."gtfs_stops" ADD CONSTRAINT "gtfs_stops_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_translations" ADD CONSTRAINT "gtfs_translations_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_trips" ADD CONSTRAINT "gtfs_trips_version_fkey" FOREIGN KEY (version) REFERENCES gtfs_feed_versions(version) ON DELETE CASCADE;

ALTER TABLE public."gtfs_trips" ADD CONSTRAINT "gtfs_trips_version_route_id_fkey" FOREIGN KEY (version, route_id) REFERENCES gtfs_routes(version, route_id) ON DELETE CASCADE;

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_route_id_fkey" FOREIGN KEY (route_id) REFERENCES regional_routes(route_id);

ALTER TABLE public."service_observations" ADD CONSTRAINT "service_observations_run_id_fkey" FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE CASCADE;

ALTER TABLE public."stop_predictions" ADD CONSTRAINT "stop_predictions_run_id_fkey" FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.get_collector_secret(secret_name text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.assert_gtfs_import_token(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare expected_token text;
begin
  select decrypted_secret into expected_token
  from vault.decrypted_secrets where name='gtfs_import_token';
  if expected_token is null or p_token is null or p_token<>expected_token then
    raise exception 'unauthorized' using errcode='42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_gtfs_import_http_state(p_token text, p_source_url text, p_config_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  perform public.assert_gtfs_import_token(p_token);

  select jsonb_build_object(
    'source_last_modified',source_last_modified,
    'source_etag',source_etag,
    'active_after',active_after,
    'config_sha256',config_sha256
  )
  into result
  from public.gtfs_import_runs
  where source_url=p_source_url
    and config_sha256=p_config_sha256
    and active_after is not null
    and status in ('activated','unchanged')
  order by started_at desc
  limit 1;

  return coalesce(result,'{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_gtfs_feed_state(p_token text, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  perform public.assert_gtfs_import_token(p_token);

  select jsonb_build_object(
    'version',version,
    'active',active,
    'feed_start_date',feed_start_date,
    'feed_end_date',feed_end_date,
    'metadata',metadata
  )
  into result
  from public.gtfs_feed_versions
  where version=p_version
  limit 1;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_gtfs_batch(p_token text, p_version text, p_kind text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted_count integer;
begin
  perform public.assert_gtfs_import_token(p_token);

  if not exists(
    select 1
    from public.gtfs_feed_versions
    where version=p_version and not active
  ) then
    raise exception 'feed_not_importable';
  end if;

  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then
    raise exception 'invalid_batch';
  end if;

  if p_kind='agencies' then
    insert into public.gtfs_agencies(
      version,agency_id,agency_name,agency_url,agency_timezone
    )
    select p_version,x.agency_id,x.agency_name,x.agency_url,x.agency_timezone
    from jsonb_to_recordset(p_rows) as x(
      agency_id text,agency_name text,agency_url text,agency_timezone text
    )
    on conflict(version,agency_id) do update set
      agency_name=excluded.agency_name,
      agency_url=excluded.agency_url,
      agency_timezone=excluded.agency_timezone;

  elsif p_kind='feed_info' then
    insert into public.gtfs_feed_info(
      version,feed_publisher_name,feed_publisher_url,feed_lang,
      feed_start_date,feed_end_date,source_feed_version,feed_contact_email
    )
    select
      p_version,x.feed_publisher_name,x.feed_publisher_url,x.feed_lang,
      x.feed_start_date,x.feed_end_date,x.feed_version,x.feed_contact_email
    from jsonb_to_recordset(p_rows) as x(
      feed_publisher_name text,feed_publisher_url text,feed_lang text,
      feed_start_date date,feed_end_date date,feed_version text,feed_contact_email text
    )
    on conflict(version) do update set
      feed_publisher_name=excluded.feed_publisher_name,
      feed_publisher_url=excluded.feed_publisher_url,
      feed_lang=excluded.feed_lang,
      feed_start_date=excluded.feed_start_date,
      feed_end_date=excluded.feed_end_date,
      source_feed_version=excluded.source_feed_version,
      feed_contact_email=excluded.feed_contact_email;

  elsif p_kind='routes' then
    insert into public.gtfs_routes(
      version,route_id,agency_id,route_short_name,route_long_name,route_type,
      route_desc,route_url,route_color,route_text_color
    )
    select
      p_version,x.route_id,x.agency_id,x.route_short_name,x.route_long_name,x.route_type,
      x.route_desc,x.route_url,x.route_color,x.route_text_color
    from jsonb_to_recordset(p_rows) as x(
      route_id text,agency_id text,route_short_name text,route_long_name text,route_type integer,
      route_desc text,route_url text,route_color text,route_text_color text
    )
    on conflict(version,route_id) do update set
      agency_id=excluded.agency_id,
      route_short_name=excluded.route_short_name,
      route_long_name=excluded.route_long_name,
      route_type=excluded.route_type,
      route_desc=excluded.route_desc,
      route_url=excluded.route_url,
      route_color=excluded.route_color,
      route_text_color=excluded.route_text_color;

  elsif p_kind='stops' then
    insert into public.gtfs_stops(
      version,stop_id,stop_name,stop_lat,stop_lon,parent_station,location_type,monitored,
      stop_code,stop_desc,zone_id,stop_url
    )
    select
      p_version,x.stop_id,x.stop_name,x.stop_lat,x.stop_lon,x.parent_station,x.location_type,
      coalesce(x.monitored,false),x.stop_code,x.stop_desc,x.zone_id,x.stop_url
    from jsonb_to_recordset(p_rows) as x(
      stop_id text,stop_name text,stop_lat double precision,stop_lon double precision,
      parent_station text,location_type integer,monitored boolean,
      stop_code text,stop_desc text,zone_id text,stop_url text
    )
    on conflict(version,stop_id) do update set
      stop_name=excluded.stop_name,
      stop_lat=excluded.stop_lat,
      stop_lon=excluded.stop_lon,
      parent_station=excluded.parent_station,
      location_type=excluded.location_type,
      monitored=excluded.monitored,
      stop_code=excluded.stop_code,
      stop_desc=excluded.stop_desc,
      zone_id=excluded.zone_id,
      stop_url=excluded.stop_url;

  elsif p_kind='trips' then
    insert into public.gtfs_trips(
      version,trip_id,route_id,service_id,trip_headsign,trip_short_name,direction_id,
      shape_id,passes_monitored,selected_by_route,block_id
    )
    select
      p_version,x.trip_id,x.route_id,x.service_id,x.trip_headsign,x.trip_short_name,
      x.direction_id,x.shape_id,coalesce(x.passes_monitored,false),
      coalesce(x.selected_by_route,false),x.block_id
    from jsonb_to_recordset(p_rows) as x(
      trip_id text,route_id text,service_id text,trip_headsign text,trip_short_name text,
      direction_id smallint,shape_id text,passes_monitored boolean,
      selected_by_route boolean,block_id text
    )
    on conflict(version,trip_id) do update set
      route_id=excluded.route_id,
      service_id=excluded.service_id,
      trip_headsign=excluded.trip_headsign,
      trip_short_name=excluded.trip_short_name,
      direction_id=excluded.direction_id,
      shape_id=excluded.shape_id,
      passes_monitored=excluded.passes_monitored,
      selected_by_route=excluded.selected_by_route,
      block_id=excluded.block_id;

  elsif p_kind='stop_times' then
    insert into public.gtfs_stop_times(
      version,trip_id,stop_sequence,stop_id,arrival_seconds,departure_seconds,
      pickup_type,drop_off_type,monitored,stop_headsign,timepoint
    )
    select
      p_version,x.trip_id,x.stop_sequence,x.stop_id,x.arrival_seconds,x.departure_seconds,
      x.pickup_type,x.drop_off_type,coalesce(x.monitored,false),x.stop_headsign,x.timepoint
    from jsonb_to_recordset(p_rows) as x(
      trip_id text,stop_sequence integer,stop_id text,arrival_seconds integer,
      departure_seconds integer,pickup_type smallint,drop_off_type smallint,
      monitored boolean,stop_headsign text,timepoint smallint
    )
    on conflict(version,trip_id,stop_sequence) do update set
      stop_id=excluded.stop_id,
      arrival_seconds=excluded.arrival_seconds,
      departure_seconds=excluded.departure_seconds,
      pickup_type=excluded.pickup_type,
      drop_off_type=excluded.drop_off_type,
      monitored=excluded.monitored,
      stop_headsign=excluded.stop_headsign,
      timepoint=excluded.timepoint;

  elsif p_kind='calendars' then
    insert into public.gtfs_calendars(
      version,service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
    )
    select
      p_version,x.service_id,x.monday,x.tuesday,x.wednesday,x.thursday,x.friday,
      x.saturday,x.sunday,x.start_date,x.end_date
    from jsonb_to_recordset(p_rows) as x(
      service_id text,monday boolean,tuesday boolean,wednesday boolean,thursday boolean,
      friday boolean,saturday boolean,sunday boolean,start_date date,end_date date
    )
    on conflict(version,service_id) do update set
      monday=excluded.monday,
      tuesday=excluded.tuesday,
      wednesday=excluded.wednesday,
      thursday=excluded.thursday,
      friday=excluded.friday,
      saturday=excluded.saturday,
      sunday=excluded.sunday,
      start_date=excluded.start_date,
      end_date=excluded.end_date;

  elsif p_kind='calendar_dates' then
    insert into public.gtfs_calendar_dates(version,service_id,service_date,exception_type)
    select p_version,x.service_id,x.service_date,x.exception_type
    from jsonb_to_recordset(p_rows) as x(
      service_id text,service_date date,exception_type smallint
    )
    on conflict(version,service_id,service_date) do update set
      exception_type=excluded.exception_type;

  elsif p_kind='shapes' then
    insert into public.gtfs_shapes(
      version,shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled
    )
    select
      p_version,x.shape_id,x.shape_pt_lat,x.shape_pt_lon,x.shape_pt_sequence,x.shape_dist_traveled
    from jsonb_to_recordset(p_rows) as x(
      shape_id text,shape_pt_lat double precision,shape_pt_lon double precision,
      shape_pt_sequence integer,shape_dist_traveled double precision
    )
    on conflict(version,shape_id,shape_pt_sequence) do update set
      shape_pt_lat=excluded.shape_pt_lat,
      shape_pt_lon=excluded.shape_pt_lon,
      shape_dist_traveled=excluded.shape_dist_traveled;

  elsif p_kind='translations' then
    insert into public.gtfs_translations(
      version,table_name,field_name,language,translation,record_id,field_value
    )
    select
      p_version,x.table_name,x.field_name,x.language,x.translation,x.record_id,x.field_value
    from jsonb_to_recordset(p_rows) as x(
      table_name text,field_name text,language text,translation text,record_id text,field_value text
    )
    on conflict on constraint gtfs_translations_unique do update set
      translation=excluded.translation;

  else
    raise exception 'unknown_import_kind';
  end if;

  get diagnostics inserted_count=row_count;
  return inserted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_stop_departures(p_stop_ids text[], p_from timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 40)
 RETURNS TABLE(stop_id text, stop_name text, route_id text, route_name text, route_long_name text, operator_name text, trip_id text, trip_headsign text, direction_id smallint, scheduled_at timestamp with time zone, expected_at timestamp with time zone, delay_seconds integer, realtime_observed_at timestamp with time zone, realtime_age_seconds integer, data_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with params as (
  select
    coalesce(p_from, now())::timestamptz as from_ts,
    (coalesce(p_from, now()) at time zone 'Europe/Dublin')::date as local_date,
    coalesce(p_stop_ids, array[]::text[]) as stop_ids,
    greatest(1, least(coalesce(p_limit, 40), 100)) as row_limit
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
       generate_series(p.local_date - 1, p.local_date + 1, interval '1 day') gs
),
base_services as (
  select sd.service_date, c.service_id
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
  select sd.service_date, cd.service_id
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
    sp.observed_at
  from public.stop_predictions sp
  join feed f on f.version=sp.version
  join params p on true
  where sp.observed_at >= p.from_ts - interval '15 minutes'
  order by
    sp.version,
    sp.trip_id,
    sp.stop_id,
    sp.service_date,
    sp.observed_at desc
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
        a.service_date::timestamp
        + make_interval(secs=>coalesce(st.departure_seconds,st.arrival_seconds,0))
      )
      at time zone 'Europe/Dublin'
    ) as scheduled_at,
    rt.predicted_arrival,
    rt.predicted_departure,
    rt.arrival_delay_seconds,
    rt.departure_delay_seconds,
    rt.observed_at as realtime_observed_at
  from active_services a
  join feed f on true
  join public.gtfs_trips t
    on t.version=f.version
   and t.service_id=a.service_id
  join public.gtfs_stop_times st
    on st.version=t.version
   and st.trip_id=t.trip_id
  join public.gtfs_stops s
    on s.version=st.version
   and s.stop_id=st.stop_id
  join public.gtfs_routes r
    on r.version=t.version
   and r.route_id=t.route_id
  join public.regional_routes rr
    on rr.route_id=t.route_id
   and rr.enabled
  join params p
    on s.stop_id=any(p.stop_ids)
  left join latest_rt rt
    on rt.version=t.version
   and rt.trip_id=t.trip_id
   and rt.stop_id=st.stop_id
   and rt.service_date=a.service_date
),
resolved as (
  select
    s.*,
    coalesce(s.departure_delay_seconds,s.arrival_delay_seconds) as resolved_delay_seconds,
    case
      when coalesce(s.predicted_departure,s.predicted_arrival) is not null
        then coalesce(s.predicted_departure,s.predicted_arrival)
      when s.realtime_observed_at is not null
           and coalesce(s.departure_delay_seconds,s.arrival_delay_seconds) is not null
        then s.scheduled_at
             + make_interval(
                 secs=>coalesce(s.departure_delay_seconds,s.arrival_delay_seconds)
               )
      else s.scheduled_at
    end as resolved_expected_at,
    case
      when coalesce(s.predicted_departure,s.predicted_arrival) is not null
        then 'realtime_explicit'
      when s.realtime_observed_at is not null
           and coalesce(s.departure_delay_seconds,s.arrival_delay_seconds) is not null
        then 'realtime_derived'
      else 'scheduled'
    end as resolved_data_status
  from scheduled s
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
  r.resolved_delay_seconds as delay_seconds,
  r.realtime_observed_at,
  case
    when r.realtime_observed_at is null then null
    else greatest(
      0,
      extract(epoch from (p.from_ts-r.realtime_observed_at))::integer
    )
  end as realtime_age_seconds,
  r.resolved_data_status as data_status
from resolved r
join params p on true
where r.resolved_expected_at >= p.from_ts - interval '3 minutes'
order by r.resolved_expected_at, r.route_name, r.trip_id
limit (select row_limit from params);
$function$;

CREATE OR REPLACE FUNCTION public.update_gtfs_import_run(p_token text, p_run_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_gtfs_import_token(p_token);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_import_run_patch';
  end if;

  update public.gtfs_import_runs
  set
    status = case when p_patch ? 'status' then p_patch->>'status' else status end,
    completed_at = case
      when p_patch ? 'completed_at'
        then nullif(p_patch->>'completed_at','')::timestamptz
      else completed_at
    end,
    source_sha256 = case when p_patch ? 'source_sha256' then p_patch->>'source_sha256' else source_sha256 end,
    version = case when p_patch ? 'version' then p_patch->>'version' else version end,
    source_bytes = case
      when p_patch ? 'source_bytes' then nullif(p_patch->>'source_bytes','')::bigint
      else source_bytes
    end,
    source_last_modified = case
      when p_patch ? 'source_last_modified' then p_patch->>'source_last_modified'
      else source_last_modified
    end,
    source_etag = case
      when p_patch ? 'source_etag' then p_patch->>'source_etag'
      else source_etag
    end,
    active_after = case when p_patch ? 'active_after' then p_patch->>'active_after' else active_after end,
    route_count = case
      when p_patch ? 'route_count' then nullif(p_patch->>'route_count','')::integer
      else route_count
    end,
    stop_count = case
      when p_patch ? 'stop_count' then nullif(p_patch->>'stop_count','')::integer
      else stop_count
    end,
    trip_count = case
      when p_patch ? 'trip_count' then nullif(p_patch->>'trip_count','')::integer
      else trip_count
    end,
    stop_time_count = case
      when p_patch ? 'stop_time_count' then nullif(p_patch->>'stop_time_count','')::integer
      else stop_time_count
    end,
    shape_point_count = case
      when p_patch ? 'shape_point_count' then nullif(p_patch->>'shape_point_count','')::integer
      else shape_point_count
    end,
    monitored_stop_count = case
      when p_patch ? 'monitored_stop_count' then nullif(p_patch->>'monitored_stop_count','')::integer
      else monitored_stop_count
    end,
    error_code = case when p_patch ? 'error_code' then p_patch->>'error_code' else error_code end,
    metadata = case when p_patch ? 'metadata' then coalesce(p_patch->'metadata','{}'::jsonb) else metadata end
  where id=p_run_id;

  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_gtfs_import(p_token text, p_version text, p_label text, p_sha256 text, p_source_url text, p_feed_start_date date, p_feed_end_date date, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing_active boolean;
begin
  perform public.assert_gtfs_import_token(p_token);

  select active into existing_active
  from public.gtfs_feed_versions
  where version=p_version
  for update;

  if found and existing_active then
    return jsonb_build_object(
      'version',p_version,
      'exists',true,
      'active',true
    );
  end if;

  if found and not existing_active then
    delete from public.gtfs_feed_versions
    where version=p_version
      and not active;
  end if;

  insert into public.gtfs_feed_versions(
    version,label,sha256,source_url,feed_start_date,feed_end_date,metadata
  ) values (
    p_version,p_label,p_sha256,p_source_url,p_feed_start_date,p_feed_end_date,
    coalesce(p_metadata,'{}'::jsonb)
  );

  return jsonb_build_object(
    'version',p_version,
    'exists',false,
    'active',false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_transport_collection(p_token text)
 RETURNS TABLE(channel text, run_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_channel text;
  selected_run uuid;
  last_claim timestamptz;
  expected_token text;
  min_interval integer;
  current_collector_version text;
  quality_cutoff timestamptz;
  elapsed_seconds double precision;
  remaining_seconds double precision;
  claim_ts timestamptz;
begin
  select decrypted_secret into expected_token
  from vault.decrypted_secrets
  where name='collector_cron_token';

  if expected_token is null or p_token is null or p_token <> expected_token then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  select
    next_channel,
    last_claimed_at,
    min_interval_seconds,
    collector_version,
    history_quality_cutoff
  into
    selected_channel,
    last_claim,
    min_interval,
    current_collector_version,
    quality_cutoff
  from public.collector_state
  where singleton=true
  for update;

  if selected_channel is null then
    raise exception 'collector_state_missing';
  end if;

  min_interval := greatest(coalesce(min_interval,61),60);
  current_collector_version := coalesce(current_collector_version,'unknown');

  if last_claim is not null then
    elapsed_seconds := extract(epoch from(clock_timestamp()-last_claim));
    remaining_seconds := min_interval-elapsed_seconds;

    if remaining_seconds > 0 then
      if remaining_seconds <= 5 then
        perform pg_catalog.pg_sleep(remaining_seconds);
      else
        return;
      end if;
    end if;
  end if;

  claim_ts := clock_timestamp();

  update public.collector_state
  set next_channel = case selected_channel when 'trip_update' then 'vehicle' else 'trip_update' end,
      last_claimed_at=claim_ts,
      updated_at=claim_ts
  where singleton=true;

  insert into public.collection_runs(
    source,channel,started_at,status,metadata
  )
  values(
    'nta',
    selected_channel,
    claim_ts,
    'started',
    jsonb_build_object(
      'collector_version',current_collector_version,
      'history_quality_eligible',
      claim_ts >= coalesce(quality_cutoff,'infinity'::timestamptz),
      'claim_timestamp',claim_ts
    )
  )
  returning id into selected_run;

  return query select selected_channel,selected_run;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_realtime_trip_context(p_version text, p_trip_ids text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'trip_id',t.trip_id,
      'route_id',t.route_id,
      'trip_headsign',t.trip_headsign,
      'direction_id',t.direction_id,
      'passes_monitored',t.passes_monitored,
      'selected_by_route',t.selected_by_route,
      'stops',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'stop_id',st.stop_id,
            'stop_name',s.stop_name,
            'stop_sequence',st.stop_sequence,
            'arrival_seconds',st.arrival_seconds,
            'departure_seconds',st.departure_seconds
          ) order by st.stop_sequence
        )
        from public.gtfs_stop_times st
        join public.gtfs_stops s
          on s.version=st.version and s.stop_id=st.stop_id
        where st.version=t.version
          and st.trip_id=t.trip_id
          and st.monitored
      ),'[]'::jsonb),
      'all_stops',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'stop_id',st.stop_id,
            'stop_sequence',st.stop_sequence,
            'arrival_seconds',st.arrival_seconds,
            'departure_seconds',st.departure_seconds,
            'monitored',st.monitored
          ) order by st.stop_sequence
        )
        from public.gtfs_stop_times st
        where st.version=t.version
          and st.trip_id=t.trip_id
      ),'[]'::jsonb)
    ) order by t.trip_id
  ),'[]'::jsonb)
  from public.gtfs_trips t
  where t.version=p_version
    and t.trip_id=any(p_trip_ids);
$function$;

CREATE OR REPLACE FUNCTION public.consume_transport_api_rate_limit(p_key text, p_limit integer DEFAULT 90, p_window_seconds integer DEFAULT 60)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  now_ts timestamptz := clock_timestamp();
  row_window timestamptz;
  row_count integer;
  max_count integer := greatest(1, least(coalesce(p_limit,90),1000));
  window_seconds integer := greatest(10, least(coalesce(p_window_seconds,60),3600));
  elapsed double precision;
begin
  if p_key is null or length(p_key) < 16 then
    raise exception 'invalid_rate_key';
  end if;

  insert into public.api_rate_limits(rate_key,window_started_at,request_count,updated_at)
  values(p_key,now_ts,0,now_ts)
  on conflict(rate_key) do nothing;

  select window_started_at,request_count
    into row_window,row_count
  from public.api_rate_limits
  where rate_key=p_key
  for update;

  elapsed := extract(epoch from (now_ts-row_window));

  if elapsed >= window_seconds then
    update public.api_rate_limits
    set window_started_at=now_ts,
        request_count=1,
        updated_at=now_ts
    where rate_key=p_key;

    return query select true,0,max_count-1;
    return;
  end if;

  if row_count >= max_count then
    return query select
      false,
      greatest(1,ceil(window_seconds-elapsed)::integer),
      0;
    return;
  end if;

  update public.api_rate_limits
  set request_count=request_count+1,
      updated_at=now_ts
  where rate_key=p_key;

  return query select true,0,greatest(0,max_count-row_count-1);
end;
$function$;

CREATE OR REPLACE FUNCTION public.prune_transport_history()
 RETURNS TABLE(payloads_cleared bigint, runs_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cleared bigint;
  deleted bigint;
begin
  update public.service_observations
  set payload=null
  where observed_at < clock_timestamp()-interval '24 hours'
    and payload is not null;
  get diagnostics cleared=row_count;

  perform public.capture_transport_prediction_history();
  perform public.capture_transport_vehicle_history();

  delete from public.collection_runs
  where coalesce(completed_at,started_at)
        < clock_timestamp()-interval '14 days';
  get diagnostics deleted=row_count;

  delete from public.gtfs_feed_versions
  where not active
    and imported_at < clock_timestamp()-interval '21 days';

  delete from cron.job_run_details
  where coalesce(end_time,start_time)
        < clock_timestamp()-interval '30 days';

  delete from public.api_rate_limits
  where updated_at < clock_timestamp()-interval '1 day';

  return query select cleared,deleted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_gtfs_import_worker(p_token text, p_lock_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  released boolean := false;
begin
  perform public.assert_gtfs_import_token(p_token);

  update public.gtfs_import_state
  set lock_id=null,
      locked_at=null,
      locked_until=null,
      owner=null,
      updated_at=clock_timestamp()
  where singleton=true
    and lock_id=p_lock_id;

  released := found;
  return released;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_gtfs_import(p_token text, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_label text;
  target_active boolean;
  target_metadata jsonb;
  config_sha text;

  route_count integer;
  stop_count integer;
  trip_count integer;
  stop_time_count integer;
  monitored_time_count integer;
  monitored_stop_count integer;
  expected_target_count integer;
  expected_route_count integer;

  calendar_count integer;
  calendar_date_count integer;
  agency_count integer;
  feed_info_count integer;
  shape_count integer;
  translation_count integer;

  missing_service_count integer;
  missing_agency_count integer;
  missing_shape_count integer;
  short_trip_count integer;

  info_start date;
  info_end date;
  info_source_version text;
  local_today date := (clock_timestamp() at time zone 'Europe/Dublin')::date;

  missing_upcoming_stops text[];
  missing_upcoming_count integer := 0;

  baseline_version text;
  baseline_trip_count integer;
  baseline_stop_time_count integer;
  baseline_stop_count integer;
begin
  perform public.assert_gtfs_import_token(p_token);

  select label,active,coalesce(metadata,'{}'::jsonb),metadata->>'config_sha256'
    into target_label,target_active,target_metadata,config_sha
  from public.gtfs_feed_versions
  where version=p_version;

  if target_label is null then
    raise exception 'unknown_feed_version';
  end if;

  select count(*) into route_count
  from public.gtfs_routes where version=p_version;

  select count(*) into stop_count
  from public.gtfs_stops where version=p_version;

  select count(*) into trip_count
  from public.gtfs_trips where version=p_version;

  select count(*) into stop_time_count
  from public.gtfs_stop_times where version=p_version;

  select count(*) into monitored_time_count
  from public.gtfs_stop_times
  where version=p_version and monitored;

  select count(*) into monitored_stop_count
  from public.gtfs_stops
  where version=p_version and monitored;

  select count(*) into expected_target_count
  from public.gtfs_import_targets
  where enabled;

  select count(*) into expected_route_count
  from public.regional_routes
  where enabled;

  select count(*) into calendar_count
  from public.gtfs_calendars where version=p_version;

  select count(*) into calendar_date_count
  from public.gtfs_calendar_dates where version=p_version;

  select count(*) into agency_count
  from public.gtfs_agencies where version=p_version;

  select count(*) into feed_info_count
  from public.gtfs_feed_info where version=p_version;

  select count(*) into shape_count
  from public.gtfs_shapes where version=p_version;

  select count(*) into translation_count
  from public.gtfs_translations where version=p_version;

  select count(distinct t.service_id) into missing_service_count
  from public.gtfs_trips t
  where t.version=p_version
    and not exists (
      select 1
      from public.gtfs_calendars c
      where c.version=t.version
        and c.service_id=t.service_id
    )
    and not exists (
      select 1
      from public.gtfs_calendar_dates cd
      where cd.version=t.version
        and cd.service_id=t.service_id
    );

  select count(*) into missing_agency_count
  from public.gtfs_routes r
  where r.version=p_version
    and r.agency_id is not null
    and not exists (
      select 1
      from public.gtfs_agencies a
      where a.version=r.version
        and a.agency_id=r.agency_id
    );

  select count(distinct t.shape_id) into missing_shape_count
  from public.gtfs_trips t
  where t.version=p_version
    and t.shape_id is not null
    and not exists (
      select 1
      from public.gtfs_shapes s
      where s.version=t.version
        and s.shape_id=t.shape_id
    );

  select count(*) into short_trip_count
  from (
    select t.trip_id
    from public.gtfs_trips t
    left join public.gtfs_stop_times st
      on st.version=t.version
     and st.trip_id=t.trip_id
    where t.version=p_version
    group by t.trip_id
    having count(st.stop_sequence)<2
  ) q;

  if route_count<1
     or stop_count<1
     or trip_count<1
     or stop_time_count<trip_count
     or monitored_time_count<1
     or monitored_stop_count<1
     or (calendar_count<1 and calendar_date_count<1)
     or agency_count<1
     or feed_info_count<>1
     or missing_service_count>0
     or missing_agency_count>0
     or missing_shape_count>0
     or short_trip_count>0 then
    raise exception
      'invalid_gtfs_subset routes=% stops=% trips=% stop_times=% monitored_times=% monitored_stops=% calendars=% calendar_dates=% agencies=% feed_info=% missing_services=% missing_agencies=% missing_shapes=% short_trips=%',
      route_count,stop_count,trip_count,stop_time_count,monitored_time_count,
      monitored_stop_count,calendar_count,calendar_date_count,
      agency_count,feed_info_count,missing_service_count,
      missing_agency_count,missing_shape_count,short_trip_count;
  end if;

  if expected_target_count < 1 or monitored_stop_count <> expected_target_count then
    raise exception
      'gtfs_monitored_target_count_mismatch expected=% actual=%',
      expected_target_count,monitored_stop_count;
  end if;

  if expected_route_count < 1 or route_count <> expected_route_count then
    raise exception
      'gtfs_enabled_route_count_mismatch expected=% actual=%',
      expected_route_count,route_count;
  end if;

  select feed_start_date,feed_end_date,source_feed_version
    into info_start,info_end,info_source_version
  from public.gtfs_feed_info
  where version=p_version;

  if info_start is null
     or info_end is null
     or info_start > info_end
     or local_today < info_start
     or local_today > info_end then
    raise exception
      'gtfs_feed_not_current today=% start=% end=%',
      local_today,info_start,info_end;
  end if;

  with service_days as (
    select gs::date as service_date
    from generate_series(local_today, local_today + 7, interval '1 day') gs
  ),
  base_services as (
    select sd.service_date,c.service_id
    from service_days sd
    join public.gtfs_calendars c
      on c.version=p_version
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
      where cd.version=p_version
        and cd.service_id=c.service_id
        and cd.service_date=sd.service_date
        and cd.exception_type=2
    )
  ),
  added_services as (
    select sd.service_date,cd.service_id
    from service_days sd
    join public.gtfs_calendar_dates cd
      on cd.version=p_version
     and cd.service_date=sd.service_date
     and cd.exception_type=1
  ),
  active_services as (
    select * from base_services
    union
    select * from added_services
  ),
  monitored as (
    select stop_id
    from public.gtfs_stops
    where version=p_version and monitored
  ),
  served as (
    select distinct st.stop_id
    from public.gtfs_stop_times st
    join public.gtfs_trips t
      on t.version=st.version
     and t.trip_id=st.trip_id
    join active_services a
      on a.service_id=t.service_id
    where st.version=p_version
      and st.monitored
      and coalesce(st.departure_seconds,st.arrival_seconds) is not null
  )
  select
    coalesce(array_agg(m.stop_id order by m.stop_id),array[]::text[]),
    count(*)::integer
  into missing_upcoming_stops,missing_upcoming_count
  from monitored m
  where not exists (
    select 1 from served s where s.stop_id=m.stop_id
  );

  if missing_upcoming_count > 0 then
    raise exception
      'gtfs_monitored_targets_without_service_next_7_days:%',
      array_to_string(missing_upcoming_stops,',');
  end if;

  select f.version
    into baseline_version
  from public.gtfs_feed_versions f
  where f.label=target_label
    and f.active
    and f.version<>p_version
    and f.metadata->>'schema_completeness'='complete_nta_feed'
    and config_sha is not null
    and f.metadata->>'config_sha256'=config_sha
  order by f.imported_at desc
  limit 1;

  if baseline_version is not null then
    select count(*) into baseline_stop_count
    from public.gtfs_stops where version=baseline_version;

    select count(*) into baseline_trip_count
    from public.gtfs_trips where version=baseline_version;

    select count(*) into baseline_stop_time_count
    from public.gtfs_stop_times where version=baseline_version;

    if stop_count * 2 < greatest(baseline_stop_count,1)
       or trip_count * 2 < greatest(baseline_trip_count,1)
       or stop_time_count * 2 < greatest(baseline_stop_time_count,1) then
      raise exception
        'gtfs_regression_gate_failed baseline=% old_stops=% new_stops=% old_trips=% new_trips=% old_stop_times=% new_stop_times=%',
        baseline_version,baseline_stop_count,stop_count,
        baseline_trip_count,trip_count,
        baseline_stop_time_count,stop_time_count;
    end if;
  end if;

  return jsonb_build_object(
    'version',p_version,
    'active',target_active,
    'routes',route_count,
    'expected_routes',expected_route_count,
    'stops',stop_count,
    'trips',trip_count,
    'stop_times',stop_time_count,
    'monitored_stop_times',monitored_time_count,
    'monitored_stops',monitored_stop_count,
    'expected_monitored_stops',expected_target_count,
    'calendars',calendar_count,
    'calendar_dates',calendar_date_count,
    'agencies',agency_count,
    'shape_points',shape_count,
    'translations',translation_count,
    'source_feed_version',info_source_version,
    'feed_start_date',info_start,
    'feed_end_date',info_end,
    'service_horizon_days',7,
    'baseline_version',baseline_version,
    'validated_at',clock_timestamp()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.abort_gtfs_import(p_token text, p_version text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  deleted_count integer;
begin
  perform public.assert_gtfs_import_token(p_token);

  delete from public.gtfs_feed_versions
  where version=p_version
    and not active;

  get diagnostics deleted_count=row_count;
  return deleted_count>0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_gtfs_import_worker(p_token text, p_owner text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 2700)
 RETURNS TABLE(lock_id uuid, locked_until timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ttl_seconds integer := greatest(300,least(coalesce(p_ttl_seconds,2700),7200));
  new_lock uuid := gen_random_uuid();
  now_ts timestamptz := clock_timestamp();
  current_until timestamptz;
begin
  perform public.assert_gtfs_import_token(p_token);

  select s.locked_until
    into current_until
  from public.gtfs_import_state s
  where s.singleton=true
  for update;

  if current_until is not null and current_until > now_ts then
    return;
  end if;

  update public.gtfs_import_state
  set lock_id=new_lock,
      locked_at=now_ts,
      locked_until=now_ts+make_interval(secs=>ttl_seconds),
      owner=left(coalesce(p_owner,'unknown'),200),
      updated_at=now_ts
  where singleton=true;

  return query
  select new_lock,now_ts+make_interval(secs=>ttl_seconds);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_gtfs_import_config(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  perform public.assert_gtfs_import_token(p_token);

  select jsonb_build_object(
    'targets',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'target_id',target_id,
            'canonical_stop_id',canonical_stop_id,
            'expected_name',expected_name,
            'expected_lat',expected_lat,
            'expected_lon',expected_lon,
            'fallback_radius_m',fallback_radius_m
          )
          order by target_id
        )
        from public.gtfs_import_targets
        where enabled
      ),'[]'::jsonb),
    'routes',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'route_id',route_id,
            'route_name',route_name,
            'collection_scope',collection_scope
          )
          order by route_id
        )
        from public.regional_routes
        where enabled
      ),'[]'::jsonb),
    'active_version',
      (
        select version
        from public.gtfs_feed_versions
        where label='nta-realtime' and active
        order by imported_at desc
        limit 1
      )
  ) into result;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_gtfs_import_run(p_token text, p_source_url text, p_importer_version text, p_config_sha256 text, p_active_before text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_id uuid;
begin
  perform public.assert_gtfs_import_token(p_token);

  insert into public.gtfs_import_runs(
    status,source_url,importer_version,config_sha256,active_before,metadata
  )
  values(
    'started',
    p_source_url,
    p_importer_version,
    p_config_sha256,
    p_active_before,
    coalesce(p_metadata,'{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capture_transport_prediction_history()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.capture_transport_vehicle_history()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_live_vehicles(p_max_age_seconds integer DEFAULT 600, p_limit integer DEFAULT 100)
 RETURNS TABLE(vehicle_key text, vehicle_id text, entity_id text, route_id text, route_name text, operator_name text, trip_id text, trip_headsign text, direction_id smallint, latitude double precision, longitude double precision, position_timestamp timestamp with time zone, observed_at timestamp with time zone, age_seconds integer, freshness text, mapping_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with params as (
  select
    greatest(30, least(coalesce(p_max_age_seconds,600),3600)) as max_age,
    greatest(1, least(coalesce(p_limit,100),250)) as row_limit,
    now() as now_ts
),
latest as (
  select distinct on (
    coalesce(o.vehicle_id,o.entity_id,o.trip_id,o.route_id)
  )
    coalesce(o.vehicle_id,o.entity_id,o.trip_id,o.route_id) as vehicle_key,
    o.vehicle_id,
    o.entity_id,
    o.route_id,
    o.route_name,
    o.operator_name,
    o.trip_id,
    o.trip_headsign,
    o.direction_id,
    o.latitude,
    o.longitude,
    coalesce(o.source_timestamp,o.observed_at) as position_timestamp,
    o.observed_at,
    o.mapping_status
  from public.service_observations o
  join public.regional_routes rr
    on rr.route_id=o.route_id
   and rr.enabled
  join params p on true
  where o.channel='vehicle'
    and o.feed_version = (select version from public.gtfs_feed_versions where label='nta-realtime' and active limit 1)
    and o.latitude is not null
    and o.longitude is not null
    and (
      rr.collection_scope='all_trips'
      or o.mapping_status='exact_trip'
    )
    and coalesce(o.source_timestamp,o.observed_at)
        >= p.now_ts - make_interval(secs=>p.max_age)
  order by
    coalesce(o.vehicle_id,o.entity_id,o.trip_id,o.route_id),
    coalesce(o.source_timestamp,o.observed_at) desc,
    o.observed_at desc
)
select
  l.vehicle_key,
  l.vehicle_id,
  l.entity_id,
  l.route_id,
  l.route_name,
  l.operator_name,
  l.trip_id,
  l.trip_headsign,
  l.direction_id,
  l.latitude,
  l.longitude,
  l.position_timestamp,
  l.observed_at,
  greatest(
    0,
    extract(epoch from (p.now_ts-l.position_timestamp))::integer
  ) as age_seconds,
  case
    when p.now_ts-l.position_timestamp <= interval '2 minutes' then 'live'
    when p.now_ts-l.position_timestamp <= interval '5 minutes' then 'aging'
    else 'stale'
  end as freshness,
  l.mapping_status
from latest l
join params p on true
order by
  case
    when p.now_ts-l.position_timestamp <= interval '2 minutes' then 0
    when p.now_ts-l.position_timestamp <= interval '5 minutes' then 1
    else 2
  end,
  l.route_name,
  l.trip_headsign nulls last,
  l.position_timestamp desc
limit (select row_limit from params);
$function$;

CREATE OR REPLACE FUNCTION public.finalize_gtfs_import(p_token text, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_label text;
  validation jsonb;
begin
  perform public.assert_gtfs_import_token(p_token);

  select label into target_label
  from public.gtfs_feed_versions
  where version=p_version
  for update;

  if target_label is null then
    raise exception 'unknown_feed_version';
  end if;

  validation := public.validate_gtfs_import(p_token,p_version);

  update public.gtfs_feed_versions
  set feed_start_date=coalesce((validation->>'feed_start_date')::date,feed_start_date),
      feed_end_date=coalesce((validation->>'feed_end_date')::date,feed_end_date),
      metadata=coalesce(metadata,'{}'::jsonb)
        || validation
        || jsonb_build_object(
          'schema_completeness','complete_nta_feed', 'active',true,
          'validated_at',clock_timestamp()
        )
  where version=p_version;

  update public.gtfs_feed_versions
  set active=false
  where label=target_label
    and active
    and version<>p_version;

  update public.gtfs_feed_versions
  set active=true
  where version=p_version;

  update public.regional_routes rr
  set feed_version=p_version
  where exists (
    select 1
    from public.gtfs_routes r
    where r.version=p_version
      and r.route_id=rr.route_id
  );

  delete from public.gtfs_feed_versions
  where label=target_label
    and not active
    and imported_at < clock_timestamp()-interval '21 days';

  return validation || jsonb_build_object(
    'version',p_version,
    'activated',true
  );
end;
$function$;

ALTER TABLE public."api_rate_limits" OWNER TO "postgres";

REVOKE ALL ON public."api_rate_limits" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."api_rate_limits" TO "postgres";

GRANT SELECT ON public."api_rate_limits" TO "postgres";

GRANT UPDATE ON public."api_rate_limits" TO "postgres";

GRANT DELETE ON public."api_rate_limits" TO "postgres";

GRANT TRUNCATE ON public."api_rate_limits" TO "postgres";

GRANT REFERENCES ON public."api_rate_limits" TO "postgres";

GRANT TRIGGER ON public."api_rate_limits" TO "postgres";

GRANT MAINTAIN ON public."api_rate_limits" TO "postgres";

GRANT INSERT ON public."api_rate_limits" TO "service_role";

GRANT SELECT ON public."api_rate_limits" TO "service_role";

GRANT UPDATE ON public."api_rate_limits" TO "service_role";

GRANT DELETE ON public."api_rate_limits" TO "service_role";

GRANT TRUNCATE ON public."api_rate_limits" TO "service_role";

GRANT REFERENCES ON public."api_rate_limits" TO "service_role";

GRANT TRIGGER ON public."api_rate_limits" TO "service_role";

GRANT MAINTAIN ON public."api_rate_limits" TO "service_role";

ALTER TABLE public."collection_runs" OWNER TO "postgres";

REVOKE ALL ON public."collection_runs" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."collection_runs" TO "postgres";

GRANT SELECT ON public."collection_runs" TO "postgres";

GRANT UPDATE ON public."collection_runs" TO "postgres";

GRANT DELETE ON public."collection_runs" TO "postgres";

GRANT TRUNCATE ON public."collection_runs" TO "postgres";

GRANT REFERENCES ON public."collection_runs" TO "postgres";

GRANT TRIGGER ON public."collection_runs" TO "postgres";

GRANT MAINTAIN ON public."collection_runs" TO "postgres";

GRANT INSERT ON public."collection_runs" TO "service_role";

GRANT SELECT ON public."collection_runs" TO "service_role";

GRANT UPDATE ON public."collection_runs" TO "service_role";

GRANT DELETE ON public."collection_runs" TO "service_role";

GRANT TRUNCATE ON public."collection_runs" TO "service_role";

GRANT REFERENCES ON public."collection_runs" TO "service_role";

GRANT TRIGGER ON public."collection_runs" TO "service_role";

GRANT MAINTAIN ON public."collection_runs" TO "service_role";

ALTER TABLE public."collector_state" OWNER TO "postgres";

REVOKE ALL ON public."collector_state" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."collector_state" TO "postgres";

GRANT SELECT ON public."collector_state" TO "postgres";

GRANT UPDATE ON public."collector_state" TO "postgres";

GRANT DELETE ON public."collector_state" TO "postgres";

GRANT TRUNCATE ON public."collector_state" TO "postgres";

GRANT REFERENCES ON public."collector_state" TO "postgres";

GRANT TRIGGER ON public."collector_state" TO "postgres";

GRANT MAINTAIN ON public."collector_state" TO "postgres";

GRANT INSERT ON public."collector_state" TO "service_role";

GRANT SELECT ON public."collector_state" TO "service_role";

GRANT UPDATE ON public."collector_state" TO "service_role";

GRANT DELETE ON public."collector_state" TO "service_role";

GRANT TRUNCATE ON public."collector_state" TO "service_role";

GRANT REFERENCES ON public."collector_state" TO "service_role";

GRANT TRIGGER ON public."collector_state" TO "service_role";

GRANT MAINTAIN ON public."collector_state" TO "service_role";

ALTER TABLE public."gtfs_agencies" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_agencies" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_agencies" TO "postgres";

GRANT SELECT ON public."gtfs_agencies" TO "postgres";

GRANT UPDATE ON public."gtfs_agencies" TO "postgres";

GRANT DELETE ON public."gtfs_agencies" TO "postgres";

GRANT TRUNCATE ON public."gtfs_agencies" TO "postgres";

GRANT REFERENCES ON public."gtfs_agencies" TO "postgres";

GRANT TRIGGER ON public."gtfs_agencies" TO "postgres";

GRANT MAINTAIN ON public."gtfs_agencies" TO "postgres";

GRANT INSERT ON public."gtfs_agencies" TO "service_role";

GRANT SELECT ON public."gtfs_agencies" TO "service_role";

GRANT UPDATE ON public."gtfs_agencies" TO "service_role";

GRANT DELETE ON public."gtfs_agencies" TO "service_role";

GRANT TRUNCATE ON public."gtfs_agencies" TO "service_role";

GRANT REFERENCES ON public."gtfs_agencies" TO "service_role";

GRANT TRIGGER ON public."gtfs_agencies" TO "service_role";

GRANT MAINTAIN ON public."gtfs_agencies" TO "service_role";

ALTER TABLE public."gtfs_calendar_dates" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_calendar_dates" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_calendar_dates" TO "postgres";

GRANT SELECT ON public."gtfs_calendar_dates" TO "postgres";

GRANT UPDATE ON public."gtfs_calendar_dates" TO "postgres";

GRANT DELETE ON public."gtfs_calendar_dates" TO "postgres";

GRANT TRUNCATE ON public."gtfs_calendar_dates" TO "postgres";

GRANT REFERENCES ON public."gtfs_calendar_dates" TO "postgres";

GRANT TRIGGER ON public."gtfs_calendar_dates" TO "postgres";

GRANT MAINTAIN ON public."gtfs_calendar_dates" TO "postgres";

GRANT INSERT ON public."gtfs_calendar_dates" TO "service_role";

GRANT SELECT ON public."gtfs_calendar_dates" TO "service_role";

GRANT UPDATE ON public."gtfs_calendar_dates" TO "service_role";

GRANT DELETE ON public."gtfs_calendar_dates" TO "service_role";

GRANT TRUNCATE ON public."gtfs_calendar_dates" TO "service_role";

GRANT REFERENCES ON public."gtfs_calendar_dates" TO "service_role";

GRANT TRIGGER ON public."gtfs_calendar_dates" TO "service_role";

GRANT MAINTAIN ON public."gtfs_calendar_dates" TO "service_role";

ALTER TABLE public."gtfs_calendars" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_calendars" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_calendars" TO "postgres";

GRANT SELECT ON public."gtfs_calendars" TO "postgres";

GRANT UPDATE ON public."gtfs_calendars" TO "postgres";

GRANT DELETE ON public."gtfs_calendars" TO "postgres";

GRANT TRUNCATE ON public."gtfs_calendars" TO "postgres";

GRANT REFERENCES ON public."gtfs_calendars" TO "postgres";

GRANT TRIGGER ON public."gtfs_calendars" TO "postgres";

GRANT MAINTAIN ON public."gtfs_calendars" TO "postgres";

GRANT INSERT ON public."gtfs_calendars" TO "service_role";

GRANT SELECT ON public."gtfs_calendars" TO "service_role";

GRANT UPDATE ON public."gtfs_calendars" TO "service_role";

GRANT DELETE ON public."gtfs_calendars" TO "service_role";

GRANT TRUNCATE ON public."gtfs_calendars" TO "service_role";

GRANT REFERENCES ON public."gtfs_calendars" TO "service_role";

GRANT TRIGGER ON public."gtfs_calendars" TO "service_role";

GRANT MAINTAIN ON public."gtfs_calendars" TO "service_role";

ALTER TABLE public."gtfs_feed_info" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_feed_info" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_feed_info" TO "postgres";

GRANT SELECT ON public."gtfs_feed_info" TO "postgres";

GRANT UPDATE ON public."gtfs_feed_info" TO "postgres";

GRANT DELETE ON public."gtfs_feed_info" TO "postgres";

GRANT TRUNCATE ON public."gtfs_feed_info" TO "postgres";

GRANT REFERENCES ON public."gtfs_feed_info" TO "postgres";

GRANT TRIGGER ON public."gtfs_feed_info" TO "postgres";

GRANT MAINTAIN ON public."gtfs_feed_info" TO "postgres";

GRANT INSERT ON public."gtfs_feed_info" TO "service_role";

GRANT SELECT ON public."gtfs_feed_info" TO "service_role";

GRANT UPDATE ON public."gtfs_feed_info" TO "service_role";

GRANT DELETE ON public."gtfs_feed_info" TO "service_role";

GRANT TRUNCATE ON public."gtfs_feed_info" TO "service_role";

GRANT REFERENCES ON public."gtfs_feed_info" TO "service_role";

GRANT TRIGGER ON public."gtfs_feed_info" TO "service_role";

GRANT MAINTAIN ON public."gtfs_feed_info" TO "service_role";

ALTER TABLE public."gtfs_feed_versions" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_feed_versions" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_feed_versions" TO "postgres";

GRANT SELECT ON public."gtfs_feed_versions" TO "postgres";

GRANT UPDATE ON public."gtfs_feed_versions" TO "postgres";

GRANT DELETE ON public."gtfs_feed_versions" TO "postgres";

GRANT TRUNCATE ON public."gtfs_feed_versions" TO "postgres";

GRANT REFERENCES ON public."gtfs_feed_versions" TO "postgres";

GRANT TRIGGER ON public."gtfs_feed_versions" TO "postgres";

GRANT MAINTAIN ON public."gtfs_feed_versions" TO "postgres";

GRANT INSERT ON public."gtfs_feed_versions" TO "service_role";

GRANT SELECT ON public."gtfs_feed_versions" TO "service_role";

GRANT UPDATE ON public."gtfs_feed_versions" TO "service_role";

GRANT DELETE ON public."gtfs_feed_versions" TO "service_role";

GRANT TRUNCATE ON public."gtfs_feed_versions" TO "service_role";

GRANT REFERENCES ON public."gtfs_feed_versions" TO "service_role";

GRANT TRIGGER ON public."gtfs_feed_versions" TO "service_role";

GRANT MAINTAIN ON public."gtfs_feed_versions" TO "service_role";

ALTER TABLE public."gtfs_import_runs" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_import_runs" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_import_runs" TO "postgres";

GRANT SELECT ON public."gtfs_import_runs" TO "postgres";

GRANT UPDATE ON public."gtfs_import_runs" TO "postgres";

GRANT DELETE ON public."gtfs_import_runs" TO "postgres";

GRANT TRUNCATE ON public."gtfs_import_runs" TO "postgres";

GRANT REFERENCES ON public."gtfs_import_runs" TO "postgres";

GRANT TRIGGER ON public."gtfs_import_runs" TO "postgres";

GRANT MAINTAIN ON public."gtfs_import_runs" TO "postgres";

GRANT INSERT ON public."gtfs_import_runs" TO "service_role";

GRANT SELECT ON public."gtfs_import_runs" TO "service_role";

GRANT UPDATE ON public."gtfs_import_runs" TO "service_role";

GRANT DELETE ON public."gtfs_import_runs" TO "service_role";

GRANT TRUNCATE ON public."gtfs_import_runs" TO "service_role";

GRANT REFERENCES ON public."gtfs_import_runs" TO "service_role";

GRANT TRIGGER ON public."gtfs_import_runs" TO "service_role";

GRANT MAINTAIN ON public."gtfs_import_runs" TO "service_role";

ALTER TABLE public."gtfs_import_state" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_import_state" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_import_state" TO "postgres";

GRANT SELECT ON public."gtfs_import_state" TO "postgres";

GRANT UPDATE ON public."gtfs_import_state" TO "postgres";

GRANT DELETE ON public."gtfs_import_state" TO "postgres";

GRANT TRUNCATE ON public."gtfs_import_state" TO "postgres";

GRANT REFERENCES ON public."gtfs_import_state" TO "postgres";

GRANT TRIGGER ON public."gtfs_import_state" TO "postgres";

GRANT MAINTAIN ON public."gtfs_import_state" TO "postgres";

GRANT INSERT ON public."gtfs_import_state" TO "service_role";

GRANT SELECT ON public."gtfs_import_state" TO "service_role";

GRANT UPDATE ON public."gtfs_import_state" TO "service_role";

GRANT DELETE ON public."gtfs_import_state" TO "service_role";

GRANT TRUNCATE ON public."gtfs_import_state" TO "service_role";

GRANT REFERENCES ON public."gtfs_import_state" TO "service_role";

GRANT TRIGGER ON public."gtfs_import_state" TO "service_role";

GRANT MAINTAIN ON public."gtfs_import_state" TO "service_role";

ALTER TABLE public."gtfs_import_targets" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_import_targets" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_import_targets" TO "postgres";

GRANT SELECT ON public."gtfs_import_targets" TO "postgres";

GRANT UPDATE ON public."gtfs_import_targets" TO "postgres";

GRANT DELETE ON public."gtfs_import_targets" TO "postgres";

GRANT TRUNCATE ON public."gtfs_import_targets" TO "postgres";

GRANT REFERENCES ON public."gtfs_import_targets" TO "postgres";

GRANT TRIGGER ON public."gtfs_import_targets" TO "postgres";

GRANT MAINTAIN ON public."gtfs_import_targets" TO "postgres";

GRANT INSERT ON public."gtfs_import_targets" TO "service_role";

GRANT SELECT ON public."gtfs_import_targets" TO "service_role";

GRANT UPDATE ON public."gtfs_import_targets" TO "service_role";

GRANT DELETE ON public."gtfs_import_targets" TO "service_role";

GRANT TRUNCATE ON public."gtfs_import_targets" TO "service_role";

GRANT REFERENCES ON public."gtfs_import_targets" TO "service_role";

GRANT TRIGGER ON public."gtfs_import_targets" TO "service_role";

GRANT MAINTAIN ON public."gtfs_import_targets" TO "service_role";

ALTER TABLE public."gtfs_routes" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_routes" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_routes" TO "postgres";

GRANT SELECT ON public."gtfs_routes" TO "postgres";

GRANT UPDATE ON public."gtfs_routes" TO "postgres";

GRANT DELETE ON public."gtfs_routes" TO "postgres";

GRANT TRUNCATE ON public."gtfs_routes" TO "postgres";

GRANT REFERENCES ON public."gtfs_routes" TO "postgres";

GRANT TRIGGER ON public."gtfs_routes" TO "postgres";

GRANT MAINTAIN ON public."gtfs_routes" TO "postgres";

GRANT INSERT ON public."gtfs_routes" TO "service_role";

GRANT SELECT ON public."gtfs_routes" TO "service_role";

GRANT UPDATE ON public."gtfs_routes" TO "service_role";

GRANT DELETE ON public."gtfs_routes" TO "service_role";

GRANT TRUNCATE ON public."gtfs_routes" TO "service_role";

GRANT REFERENCES ON public."gtfs_routes" TO "service_role";

GRANT TRIGGER ON public."gtfs_routes" TO "service_role";

GRANT MAINTAIN ON public."gtfs_routes" TO "service_role";

ALTER TABLE public."gtfs_shapes" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_shapes" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_shapes" TO "postgres";

GRANT SELECT ON public."gtfs_shapes" TO "postgres";

GRANT UPDATE ON public."gtfs_shapes" TO "postgres";

GRANT DELETE ON public."gtfs_shapes" TO "postgres";

GRANT TRUNCATE ON public."gtfs_shapes" TO "postgres";

GRANT REFERENCES ON public."gtfs_shapes" TO "postgres";

GRANT TRIGGER ON public."gtfs_shapes" TO "postgres";

GRANT MAINTAIN ON public."gtfs_shapes" TO "postgres";

GRANT INSERT ON public."gtfs_shapes" TO "service_role";

GRANT SELECT ON public."gtfs_shapes" TO "service_role";

GRANT UPDATE ON public."gtfs_shapes" TO "service_role";

GRANT DELETE ON public."gtfs_shapes" TO "service_role";

GRANT TRUNCATE ON public."gtfs_shapes" TO "service_role";

GRANT REFERENCES ON public."gtfs_shapes" TO "service_role";

GRANT TRIGGER ON public."gtfs_shapes" TO "service_role";

GRANT MAINTAIN ON public."gtfs_shapes" TO "service_role";

ALTER TABLE public."gtfs_stop_times" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_stop_times" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_stop_times" TO "postgres";

GRANT SELECT ON public."gtfs_stop_times" TO "postgres";

GRANT UPDATE ON public."gtfs_stop_times" TO "postgres";

GRANT DELETE ON public."gtfs_stop_times" TO "postgres";

GRANT TRUNCATE ON public."gtfs_stop_times" TO "postgres";

GRANT REFERENCES ON public."gtfs_stop_times" TO "postgres";

GRANT TRIGGER ON public."gtfs_stop_times" TO "postgres";

GRANT MAINTAIN ON public."gtfs_stop_times" TO "postgres";

GRANT INSERT ON public."gtfs_stop_times" TO "service_role";

GRANT SELECT ON public."gtfs_stop_times" TO "service_role";

GRANT UPDATE ON public."gtfs_stop_times" TO "service_role";

GRANT DELETE ON public."gtfs_stop_times" TO "service_role";

GRANT TRUNCATE ON public."gtfs_stop_times" TO "service_role";

GRANT REFERENCES ON public."gtfs_stop_times" TO "service_role";

GRANT TRIGGER ON public."gtfs_stop_times" TO "service_role";

GRANT MAINTAIN ON public."gtfs_stop_times" TO "service_role";

ALTER TABLE public."gtfs_stops" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_stops" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_stops" TO "postgres";

GRANT SELECT ON public."gtfs_stops" TO "postgres";

GRANT UPDATE ON public."gtfs_stops" TO "postgres";

GRANT DELETE ON public."gtfs_stops" TO "postgres";

GRANT TRUNCATE ON public."gtfs_stops" TO "postgres";

GRANT REFERENCES ON public."gtfs_stops" TO "postgres";

GRANT TRIGGER ON public."gtfs_stops" TO "postgres";

GRANT MAINTAIN ON public."gtfs_stops" TO "postgres";

GRANT INSERT ON public."gtfs_stops" TO "service_role";

GRANT SELECT ON public."gtfs_stops" TO "service_role";

GRANT UPDATE ON public."gtfs_stops" TO "service_role";

GRANT DELETE ON public."gtfs_stops" TO "service_role";

GRANT TRUNCATE ON public."gtfs_stops" TO "service_role";

GRANT REFERENCES ON public."gtfs_stops" TO "service_role";

GRANT TRIGGER ON public."gtfs_stops" TO "service_role";

GRANT MAINTAIN ON public."gtfs_stops" TO "service_role";

ALTER TABLE public."gtfs_translations" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_translations" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_translations" TO "postgres";

GRANT SELECT ON public."gtfs_translations" TO "postgres";

GRANT UPDATE ON public."gtfs_translations" TO "postgres";

GRANT DELETE ON public."gtfs_translations" TO "postgres";

GRANT TRUNCATE ON public."gtfs_translations" TO "postgres";

GRANT REFERENCES ON public."gtfs_translations" TO "postgres";

GRANT TRIGGER ON public."gtfs_translations" TO "postgres";

GRANT MAINTAIN ON public."gtfs_translations" TO "postgres";

GRANT INSERT ON public."gtfs_translations" TO "service_role";

GRANT SELECT ON public."gtfs_translations" TO "service_role";

GRANT UPDATE ON public."gtfs_translations" TO "service_role";

GRANT DELETE ON public."gtfs_translations" TO "service_role";

GRANT TRUNCATE ON public."gtfs_translations" TO "service_role";

GRANT REFERENCES ON public."gtfs_translations" TO "service_role";

GRANT TRIGGER ON public."gtfs_translations" TO "service_role";

GRANT MAINTAIN ON public."gtfs_translations" TO "service_role";

ALTER TABLE public."gtfs_trips" OWNER TO "postgres";

REVOKE ALL ON public."gtfs_trips" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."gtfs_trips" TO "postgres";

GRANT SELECT ON public."gtfs_trips" TO "postgres";

GRANT UPDATE ON public."gtfs_trips" TO "postgres";

GRANT DELETE ON public."gtfs_trips" TO "postgres";

GRANT TRUNCATE ON public."gtfs_trips" TO "postgres";

GRANT REFERENCES ON public."gtfs_trips" TO "postgres";

GRANT TRIGGER ON public."gtfs_trips" TO "postgres";

GRANT MAINTAIN ON public."gtfs_trips" TO "postgres";

GRANT INSERT ON public."gtfs_trips" TO "service_role";

GRANT SELECT ON public."gtfs_trips" TO "service_role";

GRANT UPDATE ON public."gtfs_trips" TO "service_role";

GRANT DELETE ON public."gtfs_trips" TO "service_role";

GRANT TRUNCATE ON public."gtfs_trips" TO "service_role";

GRANT REFERENCES ON public."gtfs_trips" TO "service_role";

GRANT TRIGGER ON public."gtfs_trips" TO "service_role";

GRANT MAINTAIN ON public."gtfs_trips" TO "service_role";

ALTER TABLE public."regional_routes" OWNER TO "postgres";

REVOKE ALL ON public."regional_routes" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."regional_routes" TO "postgres";

GRANT SELECT ON public."regional_routes" TO "postgres";

GRANT UPDATE ON public."regional_routes" TO "postgres";

GRANT DELETE ON public."regional_routes" TO "postgres";

GRANT TRUNCATE ON public."regional_routes" TO "postgres";

GRANT REFERENCES ON public."regional_routes" TO "postgres";

GRANT TRIGGER ON public."regional_routes" TO "postgres";

GRANT MAINTAIN ON public."regional_routes" TO "postgres";

GRANT INSERT ON public."regional_routes" TO "service_role";

GRANT SELECT ON public."regional_routes" TO "service_role";

GRANT UPDATE ON public."regional_routes" TO "service_role";

GRANT DELETE ON public."regional_routes" TO "service_role";

GRANT TRUNCATE ON public."regional_routes" TO "service_role";

GRANT REFERENCES ON public."regional_routes" TO "service_role";

GRANT TRIGGER ON public."regional_routes" TO "service_role";

GRANT MAINTAIN ON public."regional_routes" TO "service_role";

ALTER TABLE public."service_observations" OWNER TO "postgres";

REVOKE ALL ON public."service_observations" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."service_observations" TO "postgres";

GRANT SELECT ON public."service_observations" TO "postgres";

GRANT UPDATE ON public."service_observations" TO "postgres";

GRANT DELETE ON public."service_observations" TO "postgres";

GRANT TRUNCATE ON public."service_observations" TO "postgres";

GRANT REFERENCES ON public."service_observations" TO "postgres";

GRANT TRIGGER ON public."service_observations" TO "postgres";

GRANT MAINTAIN ON public."service_observations" TO "postgres";

GRANT INSERT ON public."service_observations" TO "service_role";

GRANT SELECT ON public."service_observations" TO "service_role";

GRANT UPDATE ON public."service_observations" TO "service_role";

GRANT DELETE ON public."service_observations" TO "service_role";

GRANT TRUNCATE ON public."service_observations" TO "service_role";

GRANT REFERENCES ON public."service_observations" TO "service_role";

GRANT TRIGGER ON public."service_observations" TO "service_role";

GRANT MAINTAIN ON public."service_observations" TO "service_role";

ALTER TABLE public."stop_predictions" OWNER TO "postgres";

REVOKE ALL ON public."stop_predictions" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."stop_predictions" TO "postgres";

GRANT SELECT ON public."stop_predictions" TO "postgres";

GRANT UPDATE ON public."stop_predictions" TO "postgres";

GRANT DELETE ON public."stop_predictions" TO "postgres";

GRANT TRUNCATE ON public."stop_predictions" TO "postgres";

GRANT REFERENCES ON public."stop_predictions" TO "postgres";

GRANT TRIGGER ON public."stop_predictions" TO "postgres";

GRANT MAINTAIN ON public."stop_predictions" TO "postgres";

GRANT INSERT ON public."stop_predictions" TO "service_role";

GRANT SELECT ON public."stop_predictions" TO "service_role";

GRANT UPDATE ON public."stop_predictions" TO "service_role";

GRANT DELETE ON public."stop_predictions" TO "service_role";

GRANT TRUNCATE ON public."stop_predictions" TO "service_role";

GRANT REFERENCES ON public."stop_predictions" TO "service_role";

GRANT TRIGGER ON public."stop_predictions" TO "service_role";

GRANT MAINTAIN ON public."stop_predictions" TO "service_role";

ALTER TABLE public."transport_function_backups" OWNER TO "postgres";

REVOKE ALL ON public."transport_function_backups" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."transport_function_backups" TO "postgres";

GRANT SELECT ON public."transport_function_backups" TO "postgres";

GRANT UPDATE ON public."transport_function_backups" TO "postgres";

GRANT DELETE ON public."transport_function_backups" TO "postgres";

GRANT TRUNCATE ON public."transport_function_backups" TO "postgres";

GRANT REFERENCES ON public."transport_function_backups" TO "postgres";

GRANT TRIGGER ON public."transport_function_backups" TO "postgres";

GRANT MAINTAIN ON public."transport_function_backups" TO "postgres";

GRANT INSERT ON public."transport_function_backups" TO "service_role";

GRANT SELECT ON public."transport_function_backups" TO "service_role";

GRANT UPDATE ON public."transport_function_backups" TO "service_role";

GRANT DELETE ON public."transport_function_backups" TO "service_role";

GRANT TRUNCATE ON public."transport_function_backups" TO "service_role";

GRANT REFERENCES ON public."transport_function_backups" TO "service_role";

GRANT TRIGGER ON public."transport_function_backups" TO "service_role";

GRANT MAINTAIN ON public."transport_function_backups" TO "service_role";

ALTER TABLE public."transport_trip_stop_history" OWNER TO "postgres";

REVOKE ALL ON public."transport_trip_stop_history" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."transport_trip_stop_history" TO "postgres";

GRANT SELECT ON public."transport_trip_stop_history" TO "postgres";

GRANT UPDATE ON public."transport_trip_stop_history" TO "postgres";

GRANT DELETE ON public."transport_trip_stop_history" TO "postgres";

GRANT TRUNCATE ON public."transport_trip_stop_history" TO "postgres";

GRANT REFERENCES ON public."transport_trip_stop_history" TO "postgres";

GRANT TRIGGER ON public."transport_trip_stop_history" TO "postgres";

GRANT MAINTAIN ON public."transport_trip_stop_history" TO "postgres";

GRANT INSERT ON public."transport_trip_stop_history" TO "service_role";

GRANT SELECT ON public."transport_trip_stop_history" TO "service_role";

GRANT UPDATE ON public."transport_trip_stop_history" TO "service_role";

GRANT DELETE ON public."transport_trip_stop_history" TO "service_role";

GRANT TRUNCATE ON public."transport_trip_stop_history" TO "service_role";

GRANT REFERENCES ON public."transport_trip_stop_history" TO "service_role";

GRANT TRIGGER ON public."transport_trip_stop_history" TO "service_role";

GRANT MAINTAIN ON public."transport_trip_stop_history" TO "service_role";

ALTER TABLE public."transport_vehicle_trip_history" OWNER TO "postgres";

REVOKE ALL ON public."transport_vehicle_trip_history" FROM PUBLIC, anon, authenticated, service_role;

GRANT INSERT ON public."transport_vehicle_trip_history" TO "postgres";

GRANT SELECT ON public."transport_vehicle_trip_history" TO "postgres";

GRANT UPDATE ON public."transport_vehicle_trip_history" TO "postgres";

GRANT DELETE ON public."transport_vehicle_trip_history" TO "postgres";

GRANT TRUNCATE ON public."transport_vehicle_trip_history" TO "postgres";

GRANT REFERENCES ON public."transport_vehicle_trip_history" TO "postgres";

GRANT TRIGGER ON public."transport_vehicle_trip_history" TO "postgres";

GRANT MAINTAIN ON public."transport_vehicle_trip_history" TO "postgres";

GRANT INSERT ON public."transport_vehicle_trip_history" TO "service_role";

GRANT SELECT ON public."transport_vehicle_trip_history" TO "service_role";

GRANT UPDATE ON public."transport_vehicle_trip_history" TO "service_role";

GRANT DELETE ON public."transport_vehicle_trip_history" TO "service_role";

GRANT TRUNCATE ON public."transport_vehicle_trip_history" TO "service_role";

GRANT REFERENCES ON public."transport_vehicle_trip_history" TO "service_role";

GRANT TRIGGER ON public."transport_vehicle_trip_history" TO "service_role";

GRANT MAINTAIN ON public."transport_vehicle_trip_history" TO "service_role";

ALTER FUNCTION public.get_collector_secret(text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_collector_secret(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_collector_secret(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_collector_secret(text) TO "service_role";

ALTER FUNCTION public.assert_gtfs_import_token(text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.assert_gtfs_import_token(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.assert_gtfs_import_token(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.assert_gtfs_import_token(text) TO "service_role";

ALTER FUNCTION public.get_gtfs_import_http_state(text,text,text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_gtfs_import_http_state(text,text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_gtfs_import_http_state(text,text,text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_gtfs_import_http_state(text,text,text) TO "service_role";

ALTER FUNCTION public.get_gtfs_feed_state(text,text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_gtfs_feed_state(text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_gtfs_feed_state(text,text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_gtfs_feed_state(text,text) TO "service_role";

ALTER FUNCTION public.import_gtfs_batch(text,text,text,jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.import_gtfs_batch(text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.import_gtfs_batch(text,text,text,jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION public.import_gtfs_batch(text,text,text,jsonb) TO "service_role";

ALTER FUNCTION public.get_stop_departures(text[],timestamp with time zone,integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_stop_departures(text[],timestamp with time zone,integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_stop_departures(text[],timestamp with time zone,integer) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_stop_departures(text[],timestamp with time zone,integer) TO "service_role";

ALTER FUNCTION public.update_gtfs_import_run(text,uuid,jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.update_gtfs_import_run(text,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_gtfs_import_run(text,uuid,jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION public.update_gtfs_import_run(text,uuid,jsonb) TO "service_role";

ALTER FUNCTION public.begin_gtfs_import(text,text,text,text,text,date,date,jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.begin_gtfs_import(text,text,text,text,text,date,date,jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.begin_gtfs_import(text,text,text,text,text,date,date,jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION public.begin_gtfs_import(text,text,text,text,text,date,date,jsonb) TO "service_role";

ALTER FUNCTION public.claim_transport_collection(text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.claim_transport_collection(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_transport_collection(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.claim_transport_collection(text) TO "service_role";

ALTER FUNCTION public.get_realtime_trip_context(text,text[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_realtime_trip_context(text,text[]) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_realtime_trip_context(text,text[]) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_realtime_trip_context(text,text[]) TO "service_role";

ALTER FUNCTION public.consume_transport_api_rate_limit(text,integer,integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.consume_transport_api_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.consume_transport_api_rate_limit(text,integer,integer) TO "postgres";

GRANT EXECUTE ON FUNCTION public.consume_transport_api_rate_limit(text,integer,integer) TO "service_role";

ALTER FUNCTION public.prune_transport_history() OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.prune_transport_history() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prune_transport_history() TO "postgres";

GRANT EXECUTE ON FUNCTION public.prune_transport_history() TO "service_role";

ALTER FUNCTION public.release_gtfs_import_worker(text,uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.release_gtfs_import_worker(text,uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.release_gtfs_import_worker(text,uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION public.release_gtfs_import_worker(text,uuid) TO "service_role";

ALTER FUNCTION public.validate_gtfs_import(text,text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.validate_gtfs_import(text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.validate_gtfs_import(text,text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.validate_gtfs_import(text,text) TO "service_role";

ALTER FUNCTION public.abort_gtfs_import(text,text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.abort_gtfs_import(text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.abort_gtfs_import(text,text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.abort_gtfs_import(text,text) TO "service_role";

ALTER FUNCTION public.claim_gtfs_import_worker(text,text,integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.claim_gtfs_import_worker(text,text,integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_gtfs_import_worker(text,text,integer) TO "postgres";

GRANT EXECUTE ON FUNCTION public.claim_gtfs_import_worker(text,text,integer) TO "service_role";

ALTER FUNCTION public.get_gtfs_import_config(text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_gtfs_import_config(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_gtfs_import_config(text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_gtfs_import_config(text) TO "service_role";

ALTER FUNCTION public.start_gtfs_import_run(text,text,text,text,text,jsonb) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.start_gtfs_import_run(text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_gtfs_import_run(text,text,text,text,text,jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION public.start_gtfs_import_run(text,text,text,text,text,jsonb) TO "service_role";

ALTER FUNCTION public.capture_transport_prediction_history() OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.capture_transport_prediction_history() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.capture_transport_prediction_history() TO "postgres";

GRANT EXECUTE ON FUNCTION public.capture_transport_prediction_history() TO "service_role";

ALTER FUNCTION public.capture_transport_vehicle_history() OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.capture_transport_vehicle_history() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.capture_transport_vehicle_history() TO "postgres";

GRANT EXECUTE ON FUNCTION public.capture_transport_vehicle_history() TO "service_role";

ALTER FUNCTION public.get_stop_departures_v2(text[],timestamp with time zone,integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_stop_departures_v2(text[],timestamp with time zone,integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_stop_departures_v2(text[],timestamp with time zone,integer) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_stop_departures_v2(text[],timestamp with time zone,integer) TO "service_role";

ALTER FUNCTION public.get_live_vehicles(integer,integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.get_live_vehicles(integer,integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_live_vehicles(integer,integer) TO "postgres";

GRANT EXECUTE ON FUNCTION public.get_live_vehicles(integer,integer) TO "service_role";

ALTER FUNCTION public.finalize_gtfs_import(text,text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.finalize_gtfs_import(text,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.finalize_gtfs_import(text,text) TO "postgres";

GRANT EXECUTE ON FUNCTION public.finalize_gtfs_import(text,text) TO "service_role";

ALTER SEQUENCE public."gtfs_translations_id_seq" OWNER TO "postgres";

REVOKE ALL ON SEQUENCE public."gtfs_translations_id_seq" FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON SEQUENCE public."gtfs_translations_id_seq" TO "postgres";

GRANT UPDATE ON SEQUENCE public."gtfs_translations_id_seq" TO "postgres";

GRANT USAGE ON SEQUENCE public."gtfs_translations_id_seq" TO "postgres";

GRANT SELECT ON SEQUENCE public."gtfs_translations_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."gtfs_translations_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."gtfs_translations_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."gtfs_translations_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."gtfs_translations_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."gtfs_translations_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."gtfs_translations_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."gtfs_translations_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."gtfs_translations_id_seq" TO "service_role";

ALTER SEQUENCE public."service_observations_id_seq" OWNER TO "postgres";

REVOKE ALL ON SEQUENCE public."service_observations_id_seq" FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON SEQUENCE public."service_observations_id_seq" TO "postgres";

GRANT UPDATE ON SEQUENCE public."service_observations_id_seq" TO "postgres";

GRANT USAGE ON SEQUENCE public."service_observations_id_seq" TO "postgres";

GRANT SELECT ON SEQUENCE public."service_observations_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."service_observations_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."service_observations_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."service_observations_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."service_observations_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."service_observations_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."service_observations_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."service_observations_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."service_observations_id_seq" TO "service_role";

ALTER SEQUENCE public."stop_predictions_id_seq" OWNER TO "postgres";

REVOKE ALL ON SEQUENCE public."stop_predictions_id_seq" FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON SEQUENCE public."stop_predictions_id_seq" TO "postgres";

GRANT UPDATE ON SEQUENCE public."stop_predictions_id_seq" TO "postgres";

GRANT USAGE ON SEQUENCE public."stop_predictions_id_seq" TO "postgres";

GRANT SELECT ON SEQUENCE public."stop_predictions_id_seq" TO "anon";

GRANT UPDATE ON SEQUENCE public."stop_predictions_id_seq" TO "anon";

GRANT USAGE ON SEQUENCE public."stop_predictions_id_seq" TO "anon";

GRANT SELECT ON SEQUENCE public."stop_predictions_id_seq" TO "authenticated";

GRANT UPDATE ON SEQUENCE public."stop_predictions_id_seq" TO "authenticated";

GRANT USAGE ON SEQUENCE public."stop_predictions_id_seq" TO "authenticated";

GRANT SELECT ON SEQUENCE public."stop_predictions_id_seq" TO "service_role";

GRANT UPDATE ON SEQUENCE public."stop_predictions_id_seq" TO "service_role";

GRANT USAGE ON SEQUENCE public."stop_predictions_id_seq" TO "service_role";
