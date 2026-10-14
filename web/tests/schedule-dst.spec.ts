import { test, expect } from '@playwright/test';
import evidence from './fixtures/schedule-dst.json' with { type: 'json' };
import { decodeSchedules, encodeStopSearch, type StopSearch } from '../src/scheduleData';
import { dublinInstant, scheduleClock, scheduleDaySuffix } from '../src/dublinTime';
test('engine UTC instants decode and render Dublin time across both DST changes', () => {
  for (const scenario of evidence.cases) {
    const q = scenario.query as StopSearch;
    if (!('result' in scenario)) { expect(() => dublinInstant(q.date, q.time)).toThrow('nonexistent or ambiguous'); continue; }
    const result = decodeSchedules(scenario.result, q), j = result.journeys[0]!;
    expect(scheduleClock(j.departureAt, result.referenceAt)).toMatch(/^\d{2}:\d{2}( \(GMT(?:\+1)?\))?$/);
    const incorrect = { ...scenario.result, referenceAt: '2026-01-01T00:00:00Z' };
    expect(() => decodeSchedules(incorrect, q)).toThrow('Invalid schedule time reference');
  }
  const autumn = evidence.cases.find(c => c.query.date === '2026-10-25' && c.query.time === '07:55')!;
  const result = decodeSchedules(autumn.result, autumn.query as StopSearch);
  expect(result.journeys[0]!.departureAt).toBe(9 * 3600);
  expect(scheduleClock(result.journeys[0]!.departureAt, result.referenceAt)).toBe('08:00');
  expect(scheduleDaySuffix(24 * 3600, result.referenceAt)).toBe('');
  expect(scheduleDaySuffix(25 * 3600, result.referenceAt)).toBe(' (+1 day)');
  const fold = evidence.cases.find(c => c.query.date === '2026-10-25' && c.query.changes === '1')!;
  const transfer = decodeSchedules(fold.result, fold.query as StopSearch);
  expect(scheduleClock(transfer.journeys[0]!.rides[0]!.alightAt, transfer.referenceAt)).toBe('01:05 (GMT+1)');
  expect(scheduleClock(transfer.journeys[0]!.rides[1]!.boardAt, transfer.referenceAt)).toBe('01:02 (GMT)');
  expect(transfer.journeys[0]!.rides[1]!.boardAt - transfer.journeys[0]!.rides[0]!.alightAt).toBe(3420);
});

test('autumn scheduled cards and itinerary show 08:00, with the actual 52-minute duration', async ({ page }) => {
  const scenario = evidence.cases.find(c => c.query.date === '2026-10-25' && c.query.time === '07:55')!;
  const result = scenario.result!, ride = result.journeys[0]!.rides[0]!;
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  await page.route('**/api/stops', route => route.fulfill({ json: { version: 1, source: 'nta_gtfs', feedVersion: result.feedVersion, loadedAt: result.loadedAt, validFrom: '2026-01-01', validUntil: '2026-12-31', timezone: 'Europe/Dublin', scope: result.scope, stops: [ride.from, ride.to] } }));
  await page.route('**/api/journeys?*', route => route.fulfill({ json: result }));
  await page.goto('/#/plan?' + encodeStopSearch(scenario.query as StopSearch));
  await expect(page.locator('.journey-times')).toHaveText('08:00 → 08:52');
  await expect(page.locator('.journey-card')).toContainText('52 min');
  await page.getByRole('link', { name: 'View itinerary →' }).click();
  await expect(page.locator('.scheduled-itinerary')).toContainText('08:00 → 08:52');
});
