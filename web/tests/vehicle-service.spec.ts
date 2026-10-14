import { test, expect } from '@playwright/test';
import { decodeLiveData, type LiveData } from '../src/liveData';
const at = '2026-10-12T20:00:00Z';
const fixture = (): LiveData => ({ version: 2, mode: 'live', generatedAt: at, collectorHealthy: true,
  sources: { bus: { status: 'ready', retrievedAt: at }, rail: { status: 'empty', retrievedAt: at }, departures: { status: 'empty', retrievedAt: at } }, departures: [],
  vehicles: [{ id: 'offline:bus', mode: 'bus', label: 'Fixture 420', destination: 'Ballina', lat: 54.11, lon: -9.15, observedAt: at, retrievedAt: at, quality: 'gps_observation', source: 'nta',
    service: { routeId: 'route:420', tripId: 'trip:offline', operator: 'Fixture operator', directionId: 1, mappingStatus: 'exact_trip', linkage: 'source_reported_unverified', source: 'get_live_vehicles' } }] });
test('only v2 bus references with explicit unverified provenance are accepted', () => {
  expect(decodeLiveData(fixture()).vehicles[0]!.service!.tripId).toBe('trip:offline');
  for (const edit of [
    (d: LiveData) => { d.version = 1; },
    (d: LiveData) => { d.vehicles[0]!.service!.tripId = 'x'.repeat(121); },
    (d: LiveData) => { d.vehicles[0]!.service!.mappingStatus = 'route_only'; },
    (d: LiveData) => { d.vehicles[0]!.service!.operator = 'bad\nname'; },
  ]) { const data = fixture(); edit(data); expect(() => decodeLiveData(data)).toThrow(); }
});
test('reported trip/operator render without claiming verified stops, path or ETA', async ({ page }) => {
  await page.clock.install({ time: Date.parse(at) });
  await page.route('**/api/live', route => route.fulfill({ json: fixture() }));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/#/live'); await page.locator('.vehicle-bus').click();
  const card = page.getByRole('region', { name: 'Selected vehicle' });
  await card.getByText('Service details', { exact: true }).click();
  await expect(card).toContainText('Fixture operator'); await expect(card).toContainText('trip:offline');
  await expect(card).toContainText('Source mapping'); await expect(card).toContainText('exact_trip');
  await expect(card).toContainText('Feed version and service date are not supplied here');
  await expect(card).toContainText('Times, delay and cancellation are unknown');
});
