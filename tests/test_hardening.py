import unittest
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import import_gtfs as mod
from scripts.check_post_activation import validate_health, validate_departures

class HardeningTests(unittest.TestCase):
    def test_conditional_http_prevents_false_304_after_rollback(self):
        self.assertTrue(mod.can_reuse_http_validators({'active_after':'v2'}, 'v2'))
        self.assertFalse(mod.can_reuse_http_validators({'active_after':'v2'}, 'v1'))
        self.assertFalse(mod.can_reuse_http_validators({'active_after':'v2'}, None))
        self.assertFalse(mod.can_reuse_http_validators({}, 'v2'))

    def test_non_monotonic_stop_times_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'gtfs_trip_time_backwards'):
            mod.validate_trip_chronology([
                {'trip_id':'T','stop_sequence':1,'arrival_seconds':3600,'departure_seconds':3600},
                {'trip_id':'T','stop_sequence':2,'arrival_seconds':3400,'departure_seconds':3800},
            ])

    def test_departure_before_arrival_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'gtfs_departure_before_arrival'):
            mod.validate_trip_chronology([{'trip_id':'T','stop_sequence':1,'arrival_seconds':7200,'departure_seconds':3600}])

    def test_after_midnight_timetable_accepted(self):
        mod.validate_trip_chronology([
            {'trip_id':'T','stop_sequence':2,'arrival_seconds':90600,'departure_seconds':90720},
            {'trip_id':'T','stop_sequence':1,'arrival_seconds':86200,'departure_seconds':86200},
        ])

    def mock_health(self):
        timestamp = datetime.now(timezone.utc).isoformat()
        runs = [{'channel': channel,'status':'ok','http_status':200,'completed_at':timestamp,'metadata':{'active_feed_version':'v1'}} for channel in ('vehicle','trip_update')]
        return {'status':'ok','active_feed':{'version':'v1','schema_completeness':'complete_nta_feed'},'collector':{'healthy':True,'heartbeat_limit_seconds':180,'latest_runs':runs}}

    def test_health_happy_path(self):
        self.assertEqual(validate_health(self.mock_health(), 'v1')['active_version'],'v1')

    def test_health_nested_not_root(self):
        h = self.mock_health(); h['latest_runs'] = []
        self.assertEqual(validate_health(h)['channels'],['trip_update','vehicle'])

    def test_health_only_one_channel_rejected(self):
        h=self.mock_health();h['collector']['latest_runs'][1]['channel']='vehicle'
        with self.assertRaisesRegex(ValueError,'realtime_channels'): validate_health(h)

    def test_health_stale_collector_run_rejected(self):
        h=self.mock_health();h['collector']['latest_runs'][0]['completed_at']=(datetime.now(timezone.utc)-timedelta(minutes=9)).isoformat()
        with self.assertRaisesRegex(ValueError,'realtime_run_stale'):validate_health(h)

    def test_health_old_feed_run_rejected(self):
        h=self.mock_health();h['collector']['latest_runs'][1]['metadata']['active_feed_version']='v0'
        with self.assertRaisesRegex(ValueError,'realtime_version_mismatch'):validate_health(h)

    def test_health_status_degraded_rejected(self):
        h=self.mock_health();h['status']='degraded'
        with self.assertRaisesRegex(ValueError,'health_not_ok'):validate_health(h)

    def test_health_bad_feed_version_rejected(self):
        h=self.mock_health()
        with self.assertRaisesRegex(ValueError,'active_feed_mismatch'): validate_health(h,'v2')

    def test_departure_response_shape(self):
        self.assertEqual(validate_departures({'departures':[]})['departure_count'],0)
        with self.assertRaisesRegex(ValueError,'invalid_response'):validate_departures({'departures':None})

if __name__ == '__main__': unittest.main()
