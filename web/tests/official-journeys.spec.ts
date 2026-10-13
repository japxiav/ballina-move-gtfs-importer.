import { test, expect } from '@playwright/test';
import { decodeCatalog, decodeSchedules, encodeStopSearch, type StopSearch } from '../src/scheduleData';
import { dublinToday } from '../src/fixtures';
const from = { id: '8490B5550501', name: 'Ballina Bus Stn', code: '555051', lat: 54.11101, lon: -9.1599 };
const to = { id: '8490B151091', name: 'Mayo Hospital', code: '15109', lat: 53.85184, lon: -9.30599 };
// Offline browser fixtures only. Historical 420 times, not a live source test.
const base = { version: 1, source: 'nta_gtfs', timezone: 'Europe/Dublin', scope: 'stop_to_stop_same_stop_transfers', feedVersion: 'offline-browser-fixture', loadedAt: new Date().toISOString() };
const catalog = { ...base, validFrom: '2026-10-07', validUntil: '2027-10-07', stops: [from, to] };
const q: StopSearch = { from: from.id, to: to.id, date: dublinToday(), time: '07:55', modes: 'bus,rail', changes: '1' };
const result = () => ({ ...base, serviceDate: q.date, predictionType: 'scheduled', walkingIncluded: false, realTimeApplied: false, minBoardingSeconds: 60, minTransferSeconds: 120, journeys: [{ id: '1', departureAt: 28800, arrivalAt: 31920, changes: 0, rides: [{ tripId: 'offline-fixture-420', route: '420', mode: 'bus', destination: 'Mayo Hospital', from, to, boardAt: 28800, alightAt: 31920, serviceDate: q.date }] }] });
test('scheduled search uses same-origin gateway without credentials and navigates to official stop details', async ({ page }) => {
  await page.route('**/api/stops', route => route.fulfill({ json: catalog }));
  await page.route('**/api/journeys?*', route => {
    expect(route.request().headers()['apikey']).toBeUndefined(); expect(route.request().headers()['authorization']).toBeUndefined();
    expect(new URL(route.request().url()).searchParams.get('from')).toBe(from.id); return route.fulfill({ json: result() });
  });
  await page.goto('/');
  await expect(page.getByLabel('From stop')).toBeVisible();
  await page.getByLabel('Schedule time').fill('07:55'); await page.getByRole('button', { name: 'Find scheduled journeys' }).click();
  await expect(page.locator('.journey-card')).toHaveCount(1); await expect(page.locator('.journey-card')).toContainText('NTA SCHEDULE');
  await expect(page.locator('.schedule-note')).toContainText('cancellations are not applied');
  await page.getByRole('link', { name: 'View itinerary' }).click();
  await expect(page.locator('.scheduled-itinerary')).toContainText('Bus 420'); await expect(page.locator('.scheduled-itinerary')).toContainText('stop 555051');
  await expect(page.locator('.scheduled-itinerary')).toContainText('accessibility unverified');
  for (const width of [320, 360, 390, 601, 801, 1440]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
});
test('HTTP failure displays recovery and never substitutes demo journeys', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/stops', route => { calls++; return route.fulfill(calls === 1 ? { status: 503, json: { error: 'unavailable' } } : { json: catalog }); });
  await page.goto('/#/plan'); await expect(page.getByRole('alert')).toContainText('Schedules unavailable.');
  await expect(page.locator('.journey-card')).toHaveCount(0); await expect(page.locator('.fixture-tag')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click(); await expect(page.getByLabel('From stop')).toBeVisible();
  expect(calls).toBe(2);
});
test('empty official results, schema change and mismatched feed are distinct from demo', async ({ page }) => {
  await page.route('**/api/stops', route => route.fulfill({ json: catalog }));
  let response: unknown = { ...result(), journeys: [] };
  await page.route('**/api/journeys?*', route => route.fulfill({ json: response }));
  await page.goto(`/#/plan?${encodeStopSearch(q)}`); await expect(page.getByRole('heading', { name: 'No scheduled options found.' })).toBeVisible();
  response = { ...result(), feedVersion: 'different-version' }; await page.reload(); await expect(page.getByRole('alert')).toContainText('timetable changed');
  response = { ...result(), realTimeApplied: true }; await page.reload(); await expect(page.getByRole('alert')).toContainText('Invalid scheduled journeys');
  await expect(page.locator('.journey-card')).toHaveCount(0);
});
test('invalid URL never makes official or paid requests', async ({ page }) => {
  let calls = 0; await page.route('**/api/**', route => { calls++; return route.abort(); });
  await page.goto('/#/plan?from=private&url=https://private.example'); await expect(page.getByRole('alert')).toContainText('invalid'); expect(calls).toBe(0);
});
test('browser contract rejects wrong connections, invented live provenance and too-early boarding', () => {
  expect(decodeCatalog(catalog).stops).toHaveLength(2); expect(decodeSchedules(result(), q).journeys).toHaveLength(1);
  for (const override of [{ walkingIncluded: true }, { realTimeApplied: true }, { source: 'demo' }, { serviceDate: '2020-01-01' }]) expect(() => decodeSchedules({ ...result(), ...override }, q)).toThrow();
  const r = result(); r.journeys[0]!.rides[0]!.boardAt = 7 * 3600 + 55 * 60; expect(() => decodeSchedules(r, q)).toThrow();
  const late = result(); late.journeys[0]!.rides[0]!.boardAt = 9 * 3600 + 60; late.journeys[0]!.departureAt = 9 * 3600 + 60;
  expect(() => decodeSchedules(late, { ...q, time: '09:15' })).toThrow();
});
test('official mobile home keeps the search button visible without scrolling and date inside API window', async ({ page }) => {
  await page.route('**/api/stops', route => route.fulfill({ json: catalog }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Find scheduled journeys' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ bottom: document.querySelector('.search-submit')!.getBoundingClientRect().bottom, width: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.bottom).toBeLessThanOrEqual(832); expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  const lastDay = new Date(Date.parse(dublinToday() + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10);
  await expect(page.getByLabel('Schedule date')).toHaveAttribute('max', lastDay);
  await expect(page.locator('.demo-note')).toHaveCount(0);
});
