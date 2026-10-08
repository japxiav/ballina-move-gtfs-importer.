"""Release invariants: static checks supplement, not replace, live SQL/edge testing."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
class ReleaseContracts(unittest.TestCase):
    def test_no_cron_gtfs_import_enabled(self):
        data=(ROOT/'.github/workflows/gtfs-import.yml').read_text()
        self.assertIn('workflow_dispatch:',data)
        self.assertNotIn('schedule:',data)
        self.assertIn('scripts/check_post_activation.py',data)

    def test_health_only_workflow_does_not_import(self):
        data=(ROOT/'.github/workflows/post-activation-health.yml').read_text()
        self.assertNotIn('import_gtfs.py',data)
        self.assertIn('scripts/check_post_activation.py',data)

    def test_public_api_whitelists_action_before_limits(self):
        data=(ROOT/'supabase/functions/transport-api/index.ts').read_text()
        self.assertLess(data.index('if (!ACTIONS.has(action))'),data.index('const globalKey'))
        self.assertIn('meta.active_feed_version === activeVersion',data)
        self.assertIn('days_until_expiry',data)
        self.assertIn('BALLINA_STOPS = ["8490B5550501", "8490B559701", "8490IR0076"]',data)
        self.assertNotIn('req.headers.get("x-forwarded-for")',data)

    def test_import_gateway_guards_token_and_postgres_errors(self):
        data=(ROOT/'supabase/functions/gtfs-import-api/index.ts').read_text()
        self.assertIn('{ ...params, p_token: importToken }',data)
        self.assertIn('ballina-import-api-global',data)
        self.assertNotIn('detail: raw.slice',data)

    def test_history_archived_before_prune(self):
        data=(ROOT/'docs/applied_migrations/transport_quality_hardening_20261008.sql').read_text()
        self.assertIn('transport_trip_stop_history',data)
        self.assertIn('transport_vehicle_trip_history',data)
        self.assertLess(data.index("after_retention text := E'  perform public.capture_transport_prediction_history()"),data.index("src:=replace(src,before_retention,after_retention)"))
        self.assertIn('coalesce(st.pickup_type,0) <> 1',data)
        self.assertIn('transport_function_backups',data)

if __name__ == '__main__':unittest.main()
