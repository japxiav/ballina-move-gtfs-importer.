import { test, expect } from '@playwright/test';
import capture from './fixtures/official-hospital-2026-10-14.json' with { type: 'json' };
import { decodePrefs, PREFS_KEY, PREFS_MAX_CHARS } from '../src/passengerPrefs';
import { nearbyStops } from '../src/JourneyTools';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-14T06:50:00Z') });
  await page.route('**/api/stops', route => route.fulfill({ json: capture.catalog }));
  await page.route('**/api/journeys?*', route => {
    const code = new URL(route.request().url()).searchParams.get('to') === '8490B151081' ? '15108' : '15109';
    return route.fulfill({ json: capture.byStop[code] });
  });
});
const openTools = async (page: import('@playwright/test').Page) => { await page.getByText('Saved & nearby stops', { exact: true }).click(); };

test('favorites and recent routes persist only bounded identifiers and filters, restore with a fresh time and clear', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openTools(page);
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PREFS_KEY);
  expect(stored.favorites).toHaveLength(1);
  expect(Object.keys(stored.favorites[0]).sort()).toEqual(['changes', 'from', 'modes', 'to']);
  await page.getByLabel('Schedule time').fill('07:55');
  await page.getByRole('button', { name: 'Find scheduled journeys' }).click();
  await expect(page.locator('.scheduled-results')).toContainText('12 scheduled options');
  await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click();
  await openTools(page);
  const tools = page.locator('.journey-tools');
  await expect(tools.getByRole('heading', { name: 'Recent searches' })).toBeVisible();
  await page.getByLabel('Schedule time').fill('18:00');
  await tools.locator('ul').first().getByRole('button').click();
  await expect(page.getByLabel('Schedule time')).toHaveValue('07:55'); // now plus five minutes in Dublin
  await page.reload(); await openTools(page);
  await expect(page.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear saved routes', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), PREFS_KEY)).toBeNull();
  await expect(page.locator('.journey-tools')).toContainText('Your submitted searches will appear here.');
  expect(errors).toEqual([]);
});

test('corrupt, oversized or coordinate-bearing preferences fail closed', () => {
  for (const raw of ['{bad', 'x'.repeat(PREFS_MAX_CHARS + 1), JSON.stringify({ version: 1, recent: [], favorites: [{ from: 'a', to: 'b', modes: 'bus', changes: '1', lat: 54.11 }] }), JSON.stringify({ version: 1, recent: Array(9).fill({ from: 'a', to: 'b', modes: 'bus', changes: '1' }), favorites: [] })]) expect(decodePrefs(raw)).toEqual({ version: 1, recent: [], favorites: [] });
  const good = { from: '8490B5550501', to: 'place:mayo-hospital', modes: 'bus,rail', changes: '1' };
  expect(decodePrefs(JSON.stringify({ version: 1, recent: [good, good], favorites: [] })).recent).toEqual([good]);
});

test('unavailable browser storage remains usable and does not crash', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('disabled', 'SecurityError'); } }); });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openTools(page);
  await expect(page.locator('.journey-tools')).toContainText('Browser storage unavailable');
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear saved routes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('optional device location uses browser permission, computes covered stops locally and never transmits coordinates', async ({ page, context }) => {
  // Browser's geolocation emulator, not a real GPS/device observation.
  const gps = { latitude: 54.111019, longitude: -9.159917 };
  await context.grantPermissions(['geolocation']); await context.setGeolocation(gps);
  const urls: string[] = []; page.on('request', r => urls.push(r.url()));
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    Object.defineProperty(window, '__locationCalls', { value: { count: 0 } });
    navigator.geolocation.getCurrentPosition = (...args) => { (window as unknown as { __locationCalls: { count: number } }).__locationCalls.count++; return original(...args); };
  });
  await page.goto('/'); await openTools(page);
  expect(await page.evaluate(() => (window as unknown as { __locationCalls: { count: number } }).__locationCalls.count)).toBe(0);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.nearby-stops').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.tools-status')).toContainText('straight-line distances, not walking routes');
  await page.locator('.nearby-stops').getByRole('button').first().click();
  await expect(page.getByRole('combobox', { name: 'From stop' })).toHaveValue('Ballina Bus Station');
  expect(await page.evaluate(key => localStorage.getItem(key), PREFS_KEY)).toBeNull();
  expect(urls.some(url => url.includes(String(gps.latitude)) || url.includes(String(gps.longitude)))).toBe(false);
  expect(urls.every(url => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true);
  expect(new URL(page.url()).hash).not.toContain(String(gps.latitude));
});

test('location denial, thrown API and cancelled late callback produce safe states', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, bad) => bad?.({ code: 1, message: 'PRIVATE_COORDS_DO_NOT_DISPLAY', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  await page.goto('/'); await openTools(page);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText('permission was declined');
  await expect(page.locator('body')).not.toContainText('PRIVATE_COORDS_DO_NOT_DISPLAY');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = () => { throw Error('private'); }; });
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText('unavailable here');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = ok => { (window as unknown as { __lateGPS: PositionCallback }).__lateGPS = ok; }; });
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel location', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { __lateGPS: PositionCallback }).__lateGPS({ coords: { latitude: 54.11101, longitude: -9.1599 } } as GeolocationPosition); });
  await expect(page.locator('.nearby-stops')).toHaveCount(0);
  await expect(page.locator('.tools-status')).toContainText('cancelled'); expect(errors).toEqual([]);
});

test('closest-stop distances are geometric only and invalid device coordinates are rejected', () => {
  const s = capture.catalog.stops[0]!;
  expect(nearbyStops(capture.catalog.stops, s.lat, s.lon)[0]!.metres).toBeLessThan(1);
  expect(() => nearbyStops(capture.catalog.stops, NaN, s.lon)).toThrow();
  expect(() => nearbyStops(capture.catalog.stops, s.lat, 181)).toThrow();
});

test('maximum valid preference identifiers survive the shared read/write size boundary', () => {
  const make = (n: number) => ({ from: `${n}`.padEnd(120, 'a'), to: `${n}`.padEnd(120, 'b'), modes: 'bus,rail', changes: '2' });
  const value = { version: 1 as const, recent: Array.from({ length: 8 }, (_, n) => make(n)), favorites: Array.from({ length: 6 }, (_, n) => make(n + 8)) };
  const raw = JSON.stringify(value);
  expect(raw.length).toBeLessThanOrEqual(PREFS_MAX_CHARS);
  expect(decodePrefs(raw)).toEqual(value);
});

test('clearing saved routes in another tab also clears this tab fallback without restoring deleted favorites', async ({ page, context }) => {
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ version: 1, recent: [], favorites: [] }));
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  }, PREFS_KEY);
  await page.goto('/'); await openTools(page);
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/favicon.svg');
  await other.evaluate(key => localStorage.removeItem(key), PREFS_KEY);
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toBeVisible();
  await other.close();
});

test('write-only storage denial keeps tab preferences across navigation; failed clear never claims disk deletion', async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    original.call(localStorage, key, JSON.stringify({ version: 1, recent: [], favorites: [] }));
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    Storage.prototype.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  }, PREFS_KEY);
  await page.goto('/'); await openTools(page);
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click();
  await openTools(page);
  await expect(page.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear saved routes', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText('browser storage could not be cleared');
  expect(await page.evaluate(key => localStorage.getItem(key), PREFS_KEY)).not.toBeNull();
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toBeVisible();
});

test('official metadata, About labels and initial search button fit target widths without duplicate current links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /official timetables/);
  for (const width of [320, 360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 430) expect((await page.locator('.search-submit').boundingBox())!.y + (await page.locator('.search-submit').boundingBox())!.height).toBeLessThanOrEqual(832);
    await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCount(1);
  }
  await page.getByRole('navigation').getByRole('link', { name: 'About', exact: true }).click();
  await expect(page.locator('.header-demo')).toHaveText(/PREVIEW/);
  await expect(page.locator('.site-footer')).not.toContainText('Demo prototype');
  await expect(page.locator('.about-page')).toContainText('geolocation is requested only when you choose');
  await expect(page.locator('.about-page').getByRole('link', { name: 'Find scheduled journeys' })).toHaveAttribute('href', '#/plan');
});
