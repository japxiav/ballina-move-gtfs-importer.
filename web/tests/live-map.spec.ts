import { groupVehicles } from "../src/mapGroups";
import { test, expect } from "@playwright/test";
import { decodeLiveData, visibleVehicles, visibleDepartures, type LiveData } from "../src/liveData";

// Offline contract fixtures only; never a substitute for production observations.
const at = "2026-10-12T20:00:00Z", now = Date.parse(at);
const fixture = (): LiveData => ({
  version: 1, mode: "live", generatedAt: at, collectorHealthy: true,
  sources: { bus: { status: "ready", retrievedAt: at }, rail: { status: "ready", retrievedAt: at }, departures: { status: "ready", retrievedAt: at } },
  vehicles: [
    { id: "fixture:bus", mode: "bus", label: "Fixture bus 22", destination: "Ballina", lat: 54.11, lon: -9.15, observedAt: at, retrievedAt: at, quality: "gps_observation", source: "nta" },
    { id: "fixture:train", mode: "train", label: "Fixture train A1", destination: "Northbound", lat: 54.07, lon: -9.12, observedAt: null, retrievedAt: at, quality: "reported_location", source: "irish_rail" },
  ],
  departures: [{ id: "fixture:departure", stop: "Ballina", route: "22", destination: "Dublin", scheduledAt: "2026-10-12T20:30:00Z", expectedAt: "2026-10-12T20:35:00Z", predictionObservedAt: at, status: "predicted" }],
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
test("position age uses GPS time; rail reports never invent observation time", () => {
  const data = fixture();
  expect(visibleVehicles(data, now)).toHaveLength(2);
  expect(visibleVehicles(data, now + 181000)).toEqual([]);
  data.mode = "snapshot";
  expect(visibleVehicles(data, now + 181000).map(v => v.mode)).toEqual(["train"]);
  expect(visibleVehicles(data, now + 3601000)).toEqual([]);
  data.vehicles[0].observedAt = "2026-10-12T19:00:00Z";
  expect(visibleVehicles(data, now).map(v => v.mode)).toEqual(["train"]);
});
test("predictions expire to scheduled; old departures and unavailable feeds disappear", () => {
  const data = fixture();
  expect(visibleDepartures(data, now)[0].status).toBe("predicted");
  expect(visibleDepartures(data, now + 181000)[0]).toMatchObject({ status: "scheduled", expectedAt: null });
  expect(visibleDepartures(data, now + 3600000)).toEqual([]);
  data.sources.departures.status = "unavailable";
  expect(visibleDepartures(data, now)).toEqual([]);
});
test("malformed coordinates, duplicate IDs and invented rail age fail closed", () => {
  for (const change of [
    (d: LiveData) => { d.vehicles[0].lat = NaN; },
    (d: LiveData) => { d.vehicles.push(d.vehicles[0]); },
    (d: LiveData) => { d.vehicles[1].observedAt = at; },
  ]) { const d = fixture(); change(d); expect(() => decodeLiveData(d)).toThrow(); }
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: png }));
});
test("map shows source-specific details, filters, departures and accessible mobile controls", async ({ page }) => {
  await page.clock.pauseAt(new Date(now + 1000));
  await page.route("**/api/live", route => route.fulfill({ json: fixture() }));
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#/demo");
  await page.getByRole("navigation").getByRole("link", { name: "Live map" }).click();
  await expect(page.getByRole("heading", { name: "Buses & trains." })).toBeVisible();
  await expect(page.locator(".transport-marker")).toHaveCount(1);
  // Nearby markers can overlap on mobile; the mode filter and list keep
  // every vehicle reachable without bypassing normal pointer interaction.
  await page.getByRole("button", { name: "Buses", exact: true }).click();
  await page.locator(".vehicle-bus").click();
  await expect(page.getByRole("region", { name: "Selected vehicle" })).toContainText("GPS observation");
  await page.getByRole("button", { name: "Trains", exact: true }).click();
  await expect(page.locator(".vehicle-bus")).toHaveCount(0);
  await page.locator(".vehicle-train").click();
  await expect(page.getByRole("region", { name: "Selected vehicle" })).toContainText("observation time and precision are not supplied");
  await page.getByRole("button", { name: "Close vehicle details" }).click();
  await page.getByText("Next departures · Ballina", { exact: true }).click();
  await expect(page.locator(".departure-row")).toContainText("Prediction");
  await page.clock.fastForward(185000);
  expect(await page.evaluate(() => Date.now())).toBe(now + 186000);
  await expect(page.locator(".departure-row")).toContainText("Scheduled");
  await expect(page.locator(".transport-marker")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const small = await page.locator(".map-toolbar button, .live-heading button, .leaflet-control-zoom a").evaluateAll(els => els.filter(e => { const b = e.getBoundingClientRect(); return b.width < 44 || b.height < 44; }).map(e => e.textContent));
  expect(small).toEqual([]); expect(errors).toEqual([]);
});
test("static capture is labelled; no gateway is claimed and GPS expires", async ({ page }) => {
  // Stop automatic clock ticks before manually jumping. Playwright's older
  // realtime tick can otherwise finish after fastForward and rewind Date.now.
  await page.clock.pauseAt(new Date(now + 1000));
  await page.route("**/api/live", route => route.fulfill({ status: 404 }));
  const data = fixture(); data.mode = "snapshot";
  await page.route("**/live-data.json?*", route => route.fulfill({ json: data }));
  await page.goto("/#/live");
  await expect(page.getByText(/Published snapshot/)).toBeVisible();
  await expect(page.getByText(/Continuous live updates require the server gateway/)).toBeVisible();
  await expect(page.locator(".transport-marker")).toHaveCount(1);
  await page.clock.fastForward(185000);
  expect(await page.evaluate(() => Date.now())).toBe(now + 186000);
  await expect(page.locator(".vehicle-bus")).toHaveCount(0);
  await expect(page.locator(".vehicle-train")).toHaveCount(1);
});
test("unavailable gateway presents an error and retry without fixture vehicles", async ({ page }) => {
  let failed = true;
  await page.route("**/api/live", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: fixture() }));
  await page.goto("/#/live");
  await expect(page.getByRole("alert")).toContainText("Unable to refresh");
  await expect(page.locator(".transport-marker")).toHaveCount(0);
  failed = false; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".transport-marker")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("failed refresh cannot retain expired observations", async ({ page }) => {
  await page.clock.pauseAt(new Date(now + 1000));
  let fail = false;
  await page.route("**/api/live", route => fail ? route.fulfill({ status: 503 }) : route.fulfill({ json: fixture() }));
  await page.goto("/#/live");
  await expect(page.locator(".transport-marker")).toHaveCount(1);
  fail = true;
  await page.clock.fastForward(185000);
  expect(await page.evaluate(() => Date.now())).toBe(now + 186000);
  await expect(page.getByRole("alert")).toContainText("Unable to refresh");
  await expect(page.locator(".transport-marker")).toHaveCount(0);
});

test("leaving the map aborts a pending response and preserves journey navigation", async ({ page }) => {
  let started = false;
  await page.route("**/api/live", async route => {
    started = true;
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ json: fixture() }).catch(() => {});
  });
  await page.goto("/#/live");
  await expect.poll(() => started).toBe(true);
  await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Find your journey." })).toBeVisible();
  await expect(page.locator(".live-map")).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '/demo'; });
  await expect(page.getByRole("heading", { name: "Your next journey." })).toBeVisible();
  await page.getByRole("button", { name: "Find journeys" }).click();
  await expect(page.locator(".journey-card")).toHaveCount(3);
  await expect(page.locator(".live-map")).toHaveCount(0);
});

test('cancellation confirmation uses its own timestamp and expires despite fresh DTO retrieval',()=>{
 const now=Date.parse(at),value=fixture();
 value.departures=[{...value.departures[0],status:'cancelled',expectedAt:null,predictionObservedAt:null,cancellationObservedAt:at}];
 const data=decodeLiveData(value);
 expect(visibleDepartures(data,now)[0].status).toBe('cancelled');
 data.generatedAt=new Date(now+181000).toISOString();data.sources.departures.retrievedAt=data.generatedAt;
 expect(visibleDepartures(data,now+181000)[0].status).toBe('cancellation_unconfirmed');
 expect(visibleDepartures(data,now+181000)[0].status).not.toBe('scheduled');
});
test('missing old or future cancellation stamps are not current cancellation confirmation',()=>{
 const now=Date.parse(at);
 for(const stamp of [undefined,null,'2026-10-12T19:00:00Z','2026-10-12T21:00:00Z']) {
  const value=fixture();value.departures=[{...value.departures[0],status:'cancelled',expectedAt:null,predictionObservedAt:null,cancellationObservedAt:stamp}];
  expect(visibleDepartures(decodeLiveData(value),now)[0].status).toBe('cancellation_unconfirmed');
 }
 const value=fixture();value.departures[0].status='cancelled';
 expect(()=>decodeLiveData(value)).toThrow('Invalid departure');
});

test('a fresh cancellation becomes unconfirmed in the map instead of silently becoming scheduled',async({page})=>{
 await page.clock.pauseAt(new Date(now + 1000));
 const value=fixture();value.departures=[{...value.departures[0],status:'cancelled',expectedAt:null,predictionObservedAt:null,cancellationObservedAt:at}];
 await page.route('**/api/live',route=>route.fulfill({json:value}));
 await page.goto('/#/live');await page.getByText('Next departures · Ballina',{exact:true}).click();
 await expect(page.locator('.departure-row')).toContainText('Cancelled');
 await page.clock.fastForward(185000);
 expect(await page.evaluate(()=>Date.now())).toBe(now + 186000);
 await expect(page.locator('.departure-row')).toContainText('Cancellation unconfirmed · check operator');
 await expect(page.locator('.departure-row')).not.toContainText('Scheduled');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('screen-space groups preserve every identity across grid boundaries and input reorder', () => {
  const a = fixture().vehicles[0]!, b = fixture().vehicles[1]!;
  const c = { ...a, id: 'fixture:third' };
  const points = { [a.id]: { x: 47, y: 0 }, [b.id]: { x: 49, y: 0 }, [c.id]: { x: 200, y: 0 } };
  const result = groupVehicles([c, b, a], v => points[v.id]!);
  expect(result.map(g => g.vehicles.map(v => v.id))).toEqual([[a.id, b.id], [c.id]]);
  expect(groupVehicles([a, c, b], v => points[v.id]!)).toEqual(result);
  expect(result.flatMap(g => g.vehicles)).toHaveLength(3);
});

test('a surrounding group never places its marker on the separate central vehicle', () => {
  const base = fixture().vehicles[0]!;
  const ring = Array.from({ length: 16 }, (_, n) => ({ ...base, id: `ring:${n}`, lat: 54 + Math.sin(n * Math.PI / 8) * .01, lon: -9 + Math.cos(n * Math.PI / 8) * .01 }));
  const centre = { ...base, id: 'centre', lat: 54, lon: -9 };
  const project = (v: { lat: number; lon: number }) => ({ x: (v.lon + 9) * 10000, y: (v.lat - 54) * 10000 });
  const groups = groupVehicles([...ring, centre], project);
  expect(groups.map(g => g.vehicles.length).sort((a, b) => a - b)).toEqual([1, 16]);
  const [a, b] = groups.map(project);
  expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(48);
});

test('stalled map tiles disclose their delay while vehicle data remains usable; a late tile clears the warning', async ({ page }) => {
  await page.clock.pauseAt(new Date(now + 1000));
  await page.unroute('https://tile.openstreetmap.org/**');
  let requested = false, finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  await page.route('https://tile.openstreetmap.org/**', async route => { requested = true; await held; await route.fulfill({ contentType: 'image/png', body: png }).catch(() => {}); });
  await page.route('**/api/live', route => route.fulfill({ json: fixture() }));
  await page.goto('/#/live'); await expect.poll(() => requested).toBe(true);
  await page.clock.fastForward(15001);
  await expect(page.getByText('Map tiles are taking too long. Use the vehicle list or refresh to retry.', { exact: true })).toBeVisible();
  await expect(page.locator('.map-count')).toContainText('2 locations in this view');
  await page.getByRole('button', { name: 'Buses', exact: true }).click();
  await page.locator('.vehicle-bus').click();
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText('GPS observation');
  await page.getByRole('button', { name: 'Close vehicle details', exact: true }).click();
  finish();
  await expect(page.getByText('Map tiles are taking too long. Use the vehicle list or refresh to retry.', { exact: true })).toHaveCount(0);
});

test('selecting from a scrolled vehicle list brings the desktop card into the visible viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.route('**/api/live', route => route.fulfill({ json: fixture() }));
  await page.goto('/#/live');
  await page.getByText('2 locations in this view · vehicle list', { exact: true }).click();
  await page.locator('.live-list').first().getByRole('button', { name: /Fixture bus 22/ }).click();
  const card = page.getByRole('region', { name: 'Selected vehicle' });
  await expect(card).toBeVisible();
  await expect.poll(async () => { const b = await card.boundingBox(); return b!.y >= 0 && b!.y + b!.height <= 501; }).toBe(true);
  await expect(card.getByRole('heading')).toBeFocused();
});

test('overlapping vehicles are keyboard reachable; card opens visibly and Escape restores marker focus', async ({ page }) => {
  await page.route('**/api/live', route => route.fulfill({ json: fixture() }));
  await page.goto('/#/live');
  const marker = page.locator('.vehicle-cluster');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('data-vehicle-count', '2');
  await marker.focus(); await marker.press('Enter');
  const group = page.getByRole('region', { name: 'Vehicles in this group' });
  await expect(group.getByRole('button', { name: /Fixture train A1/ })).toBeVisible();
  await group.getByRole('button', { name: /Fixture train A1/ }).click();
  const card = page.getByRole('region', { name: 'Selected vehicle' });
  await expect(card).toContainText('observation age unknown');
  await expect(card).toContainText('Irish Rail');
  await card.getByText('Service details', { exact: true }).click();
  await expect(card).toContainText('Operator, exact service, stops and route path are not supplied');
  const rect = await card.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0); expect(rect!.y + rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.keyboard.press('Escape'); await expect(card).toHaveCount(0);
  await expect(marker).toBeFocused();
});

test('viewport list and counters distinguish Mayo from the whole feed and follow selected coordinates', async ({ page }) => {
  const data = fixture();
  data.vehicles.push({ ...data.vehicles[0]!, id: 'fixture:dublin', label: 'Fixture Dublin bus', lat: 53.35, lon: -6.26 });
  await page.route('**/api/live', route => route.fulfill({ json: data }));
  await page.goto('/#/live');
  await expect(page.locator('.map-count')).toHaveText('2 locations in this view · 3 available with this filter');
  await page.getByText('2 locations in this view · vehicle list', { exact: true }).click();
  await expect(page.locator('.live-list').first().getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Ireland', exact: true }).click();
  await expect(page.locator('.map-count')).toHaveText('3 locations in this view · 3 available with this filter');
  await page.locator('.live-list').first().getByRole('button', { name: /Fixture Dublin bus/ }).click();
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText('53.35000, -6.26000');
  await expect(page.locator('.map-count')).toHaveText('1 locations in this view · 3 available with this filter');
  await page.getByRole('button', { name: 'Mayo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText('outside the current map view');
  await page.getByRole('button', { name: 'Focus on map', exact: true }).click();
  await expect(page.locator('.map-count')).toHaveText('1 locations in this view · 3 available with this filter');
});

test('selection closes when its source expires; refresh is not a new GPS observation', async ({ page }) => {
  await page.clock.pauseAt(new Date(now + 1000));
  const data = fixture();
  await page.route('**/api/live', route => route.fulfill({ json: data }));
  await page.goto('/#/live');
  await page.getByRole('button', { name: 'Buses', exact: true }).click();
  await page.locator('.vehicle-bus').click();
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toContainText('GPS observation');
  await page.clock.fastForward(185000);
  await expect(page.getByRole('region', { name: 'Selected vehicle' })).toHaveCount(0);
  await expect(page.locator('.selection-notice')).toContainText('location expired');
  await expect(page.locator('.map-count')).toContainText('0 locations in this view');
  await expect(page.locator('.transport-marker')).toHaveCount(0);
});

test('mobile card and controls fit all target widths with no HTML injection from source labels', async ({ page }) => {
  const data = fixture(); data.vehicles = [{ ...data.vehicles[0]!, label: '<img src=x onerror=alert(1)>' }];
  await page.route('**/api/live', route => route.fulfill({ json: data }));
  await page.goto('/#/live'); await page.locator('.vehicle-bus').click();
  const card = page.getByRole('region', { name: 'Selected vehicle' });
  await expect(card.getByRole('heading')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(card.locator('img')).toHaveCount(0);
  for (const width of [320, 360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const b = await card.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width).toBeLessThanOrEqual(width + 1);
    expect(b!.y).toBeGreaterThanOrEqual(0); expect(b!.y + b!.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tiny = await card.locator('button, summary').evaluateAll(els => els.filter(e => e.getBoundingClientRect().height < 44).length);
    expect(tiny).toBe(0);
  }
});
