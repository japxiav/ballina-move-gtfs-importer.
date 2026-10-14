-- PROPOSED ONLY. Not applied to production. No data/owner changes.
-- Restore test exercises this after proving the faithful baseline.
BEGIN;
REVOKE ALL ON SEQUENCE public.gtfs_translations_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.service_observations_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.stop_predictions_id_seq FROM anon, authenticated;
COMMIT;
