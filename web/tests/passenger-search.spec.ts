import { test, expect } from '@playwright/test';
import capture from './fixtures/official-hospital-2026-10-14.json' with { type: 'json' };
import { decodeCatalog, decodeSchedules, encodeStopSearch, type StopSearch } from '../src/scheduleData';
import { searchChoices, suggestions, expandSearch, decodePassengerSearch, pageSearch, orderOptions, itineraryLink, rememberStopOptions, prefetchStopOptions, loadStopOptions } from '../src/passengerSearch';

const catalog = decodeCatalog(capture.catalog), from = '8490B5550501';
const place: StopSearch = { from, to: 'place:mayo-hospital', date: '2026-10-14', time: '07:55', modes: 'bus,rail', changes: '1' };
const bodies = capture.byStop;
const hash = '/#/plan?' + encodeStopSearch(place);
test.beforeEach(async ({ page }) => {
  // Retained official capture; all browser HTTP is replayed offline here.
  await page.clock.install({ time: new Date('2026-10-14T06:00:00Z') });
  await page.route('**/api/stops', route => route.fulfill({ json: catalog }));
});

test('hospital associations use exact verified identities, never proximity or matching name alone', () => {
  const nearby = { ...catalog.stops[1]!, id: 'OTHER-HOSPITAL-BAY', code: 'OTHER', lat: 53.85185 };
  const choices = searchChoices({ ...catalog, stops: [...catalog.stops, nearby] });
  expect(choices.find(c => c.kind === 'place')!.stops.map(s => s.code)).toEqual(['15108', '15109']);
  expect(suggestions(choices, 'Mayo University Hospital')[0]!.kind).toBe('place');
  expect(suggestions(choices, '15109')[0]!.id).toBe('8490B151091');
  expect(expandSearch(place, choices).map(q => q.to)).toEqual(['8490B151081', '8490B151091']);
  expect(decodePassengerSearch(encodeStopSearch({ ...place, to: 'place:invented-entrance' }))).toBeNull();
  const mismatched = searchChoices({ ...catalog, stops: catalog.stops.map(s => s.code === '15109' ? { ...s, name: 'Different hospital' } : s) });
  expect(mismatched.find(c => c.kind === 'place')!.stops).toHaveLength(1);
});

test('place aggregation preserves stop alternatives and actual transfer identities without cross-stop dominance', () => {
  const pairs = expandSearch(place, searchChoices(catalog));
  const entries = pairs.flatMap(q => decodeSchedules(bodies[q.to === '8490B151081' ? '15108' : '15109'], q).journeys.map(journey => ({ query: q, journey })));
  const ordered = orderOptions(entries);
  expect(ordered).toHaveLength(12);
  expect(ordered[0]!.journey).toMatchObject({ departureAt: 28800, arrivalAt: 31920, changes: 0 });
  expect(ordered[0]!.query.to).toBe('8490B151091');
  expect(ordered.filter(o => o.query.to === '8490B151081' && o.journey.arrivalAt === 33840)).toHaveLength(2);
  const route = itineraryLink(ordered[0]!, place), params = route.split('?')[1]!;
  const decoded = pageSearch(params, true);
  expect(decoded.query!.to).toBe('8490B151091');
  expect(decoded.back).toEqual(place);
  expect(pageSearch(params, false).query).toBeNull();
  const unsafe = new URLSearchParams(params); unsafe.append('back', encodeStopSearch(place));
  expect(pageSearch(unsafe.toString(), true).query).toBeNull();
});

test('passenger hospital search shows direct420 and both15108 alternatives with bounded serial exact requests', async ({ page }) => {
  let pending = 0, maximum = 0;
  const requested: string[] = [];
  await page.route('**/api/journeys?*', async route => {
    const p = new URL(route.request().url()).searchParams;
    expect([...p.keys()].sort()).toEqual(['changes', 'date', 'from', 'modes', 'time', 'to']);
    expect(p.get('from')).toBe(from); expect(p.get('to')).not.toContain('place:');
    expect(route.request().headers()['apikey']).toBeUndefined(); expect(route.request().headers()['authorization']).toBeUndefined();
    requested.push(p.get('to')!); maximum = Math.max(maximum, ++pending);
    await new Promise(resolve => setTimeout(resolve, 80));
    await route.fulfill({ json: bodies[p.get('to') === '8490B151081' ? '15108' : '15109'] }); pending--;
  });
  await page.goto(hash);
  await expect(page.locator('.scheduled-results')).toContainText('12 scheduled options');
  const cards = page.locator('.journey-card'); await expect(cards).toHaveCount(6);
  await expect(cards.first()).toContainText('08:00 → 08:52');
  await expect(cards.first()).toContainText('Direct'); await expect(cards.first()).toContainText('stop 15109');
  await expect(cards.nth(1)).toContainText('09:24'); await expect(cards.nth(1)).toContainText('stop 15108');
  expect(requested).toEqual(['8490B151081', '8490B151091']); expect(maximum).toBe(1);
  await page.getByRole('button', { name: 'Show all 12 options' }).click(); await expect(cards).toHaveCount(12);
  await expect(page.locator('.next-day-notice').first()).toContainText('later day');
  await cards.first().getByRole('link', { name: 'View itinerary' }).click();
  await expect(page.locator('.scheduled-itinerary')).toContainText('Get off: Mayo Hospital · stop 15109');
  await page.getByRole('link', { name: 'Back to results' }).click();
  await expect(page).toHaveURL(new RegExp('to=place%3Amayo-hospital'));
  await expect(page.locator('.scheduled-results')).toContainText('12 scheduled options');
  expect(requested).toHaveLength(2); // Detail/back uses bounded memory, not more upstream searches.
});

test('keyboard suggestions, known stop code and exact-stop mode remain usable without internal IDs', async ({ page }) => {
  await page.goto('/');
  const destination = page.getByRole('combobox', { name: 'To stop' });
  await destination.fill('15109');
  const choices = page.getByRole('listbox', { name: 'To suggestions' }).getByRole('option');
  await expect(choices).toHaveCount(1); await expect(choices).toContainText('Stop 15109');
  await destination.press('Enter'); await expect(destination).toHaveValue('Mayo Hospital');
  await page.getByRole('button', { name: 'Choose exact stops' }).click();
  await expect(page.getByLabel('To stop')).toHaveValue('8490B151091');
  await page.getByLabel('To stop').selectOption('8490B151081');
  await page.getByRole('button', { name: 'Swap stops' }).click();
  await expect(page.getByLabel('From stop')).toHaveValue('8490B151081');
  await page.getByRole('button', { name: 'Choose exact stops' }).click();
  await expect(page.getByRole('combobox', { name: 'From stop' })).toHaveValue('Mayo Hospital');
});

test('typing unselected text cannot submit an old destination silently', async ({ page }) => {
  let calls = 0; await page.route('**/api/journeys?*', route => { calls++; return route.abort(); });
  await page.goto('/'); await page.getByRole('combobox', { name: 'To stop' }).fill('unknown destination');
  await page.getByRole('button', { name: 'Find scheduled journeys' }).click();
  await expect(page.getByRole('alert')).toContainText('suggestions'); expect(calls).toBe(0);
});

test('quota stops the batch; partial successes are labelled and never replaced by fixtures', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/journeys?*', route => {
    calls++;
    return calls === 1 ? route.fulfill({ json: bodies['15108'] }) : route.fulfill({ status: 429, json: { error: 'rate_limited', private_detail: 'DO_NOT_ECHO' } });
  });
  await page.goto(hash); await expect(page.locator('.scheduled-results')).toContainText('incomplete');
  await expect(page.locator('.scheduled-results')).toContainText('Wait a minute');
  await expect(page.locator('.journey-card')).toHaveCount(6); expect(calls).toBe(2);
  await expect(page.locator('body')).not.toContainText('DO_NOT_ECHO');
});

test('a changed feed aborts the whole comparison without mixing timetable versions', async ({ page }) => {
  await page.route('**/api/journeys?*', route => {
    const code = new URL(route.request().url()).searchParams.get('to') === '8490B151081' ? '15108' : '15109';
    return route.fulfill({ json: code === '15108' ? bodies[code] : { ...bodies[code], feedVersion: 'different-feed' } });
  });
  await page.goto(hash); await expect(page.getByRole('alert')).toContainText('timetable changed');
  await expect(page.locator('.journey-card')).toHaveCount(0);
});

test('first-stop quota exhaustion never starts the second stop request', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/journeys?*', route => {
    calls.push(new URL(route.request().url()).searchParams.get('to')!);
    return route.fulfill({ status: 429, json: { error: 'rate_limited' } });
  });
  await page.goto(hash);
  await expect(page.getByRole('alert')).toContainText('Wait a minute');
  expect(calls).toEqual(['8490B151081']);
  await expect(page.locator('.journey-card')).toHaveCount(0);
});

test('retry refreshes once; detail and back reuse results until the original fifteen-second expiry', async ({ page }) => {
  await page.clock.pauseAt(new Date('2026-10-14T06:00:01Z'));
  let calls = 0;
  await page.route('**/api/journeys?*', route => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503 });
    const code = new URL(route.request().url()).searchParams.get('to') === '8490B151081' ? '15108' : '15109';
    return route.fulfill({ json: bodies[code] });
  });
  await page.goto(hash);
  await expect(page.locator('.scheduled-results')).toContainText('incomplete');
  await page.getByText('Edit search', { exact: false }).click();
  await page.getByRole('button', { name: 'Find scheduled journeys' }).click();
  await expect(page.locator('.scheduled-results')).toContainText('12 scheduled options');
  expect(calls).toBe(4);
  await page.locator('.journey-card').first().getByRole('link', { name: 'View itinerary' }).click();
  await expect(page.locator('.scheduled-itinerary')).toBeVisible();
  await page.clock.fastForward(10000);
  await page.getByRole('link', { name: 'Back to results' }).click();
  await expect(page.locator('.scheduled-results')).toContainText('12 scheduled options');
  expect(calls).toBe(4);
  await page.clock.fastForward(6000);
  await page.locator('.journey-card').first().getByRole('link', { name: 'View itinerary' }).click();
  await expect(page.locator('.scheduled-itinerary')).toBeVisible();
  expect(calls).toBe(5);
});

test('twenty-three-second budget preserves labelled partial results and ignores a late response', async ({ page }) => {
  await page.clock.pauseAt(new Date('2026-10-14T06:00:01Z'));
  let second = false;
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/journeys?*', async route => {
    const code = new URL(route.request().url()).searchParams.get('to') === '8490B151081' ? '15108' : '15109';
    if (code === '15109') { second = true; await held; }
    await route.fulfill({ json: bodies[code] }).catch(() => {});
  });
  await page.goto(hash);
  await expect.poll(() => second).toBe(true);
  await page.clock.fastForward(23001);
  await expect(page.locator('.scheduled-results')).toContainText('incomplete');
  await expect(page.locator('.journey-card')).toHaveCount(6);
  finish();
  await expect(page.locator('.journey-card').first()).toContainText('stop 15108');
  await expect(page.locator('.journey-card')).toHaveCount(6);
});

test('leaving a pending place batch aborts the request and cannot replace the next screen', async ({ page }) => {
  let began = false, aborted = false;
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  page.on('requestfailed', request => { if (request.url().includes('/api/journeys')) aborted = true; });
  await page.route('**/api/journeys?*', async route => {
    began = true; await held;
    await route.fulfill({ json: bodies['15108'] }).catch(() => {});
  });
  await page.goto(hash); await expect.poll(() => began).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'To stop' })).toBeVisible();
  await expect.poll(() => aborted).toBe(true); finish();
  await expect(page.locator('.journey-card')).toHaveCount(0);
  await expect(page).not.toHaveURL(/to=place/);
});

test('swap clears an externally emptied field while preserving unselected text in the field being edited', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'To stop' }).fill('unselected place');
  await expect(page.getByRole('combobox', { name: 'To stop' })).toHaveValue('unselected place');
  await page.getByRole('button', { name: 'Swap stops' }).click();
  await expect(page.getByRole('combobox', { name: 'From stop' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'To stop' })).toHaveValue('Ballina Bus Station');
});

test('cache canonicalizes query order, prefers a validated new feed, expires and bounds retained entries', async () => {
  const q = { ...place, to: '8490B151091' }, signal = new AbortController().signal;
  const r1 = { ...decodeSchedules(bodies['15109'], q), feedVersion: 'cache-unit-v1' };
  const r2 = { ...r1, feedVersion: 'cache-unit-v2' };
  const c1 = { ...catalog, feedVersion: r1.feedVersion }, c2 = { ...catalog, feedVersion: r2.feedVersion };
  rememberStopOptions(q, c1, signal, r1); rememberStopOptions(q, c2, signal, r2);
  const reordered = { changes: q.changes, modes: q.modes, time: q.time, date: q.date, to: q.to, from: q.from };
  expect(await prefetchStopOptions(reordered, signal, false)).toBe(r2);
  expect(rememberStopOptions(q, c2, signal, r1)).toBe(r2);
  const originalNow = Date.now, originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'http://127.0.0.1:4173/' } } });
    globalThis.fetch = async () => { calls++; throw Error('expected uncached read'); };
    const initial = originalNow();
    Date.now = () => initial + 10000;
    expect(rememberStopOptions(q, c2, signal, r2)).toBe(r2);
    Date.now = () => initial + 16000;
    // A catalog arriving after an exact prefetch hit must not renew that hit.
    expect(rememberStopOptions(q, c2, signal, r2)).toBe(r2);
    await expect(prefetchStopOptions(q, signal, false)).rejects.toThrow(); expect(calls).toBe(1);
    Date.now = () => initial - 1000;
    await expect(loadStopOptions(q, c2, signal, false)).rejects.toThrow(); expect(calls).toBe(2);
    Date.now = originalNow;
    for (let n = 0; n < 6; n++) rememberStopOptions({ ...q, time: `07:${40 + n}` }, c2, signal, r2);
    await expect(prefetchStopOptions(q, signal, false)).rejects.toThrow(); expect(calls).toBe(3);
  } finally {
    Date.now = originalNow; globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
