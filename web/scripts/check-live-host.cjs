"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
function verifyLiveData(data, now = Date.now()) {
  assert.equal(data.mode, "live"); assert([1, 2].includes(data.version)); assert.equal(data.collectorHealthy, true);
  for (const channel of ["bus", "rail"]) assert(["ready", "empty"].includes(data.sources[channel].status));
  const retrievalAge = now - Date.parse(data.generatedAt);
  assert(retrievalAge >= -15000 && retrievalAge < 90000);
  assert(!JSON.stringify(data).includes("sb_publishable_"));
  const buses = data.vehicles.filter(vehicle => vehicle.mode === "bus");
  for (const bus of buses) {
    const observationAge = now - Date.parse(bus.observedAt);
    assert(bus.source === "nta" && bus.quality === "gps_observation" && observationAge >= -15000 && observationAge <= 180000);
  }
  for (const train of data.vehicles.filter(vehicle => vehicle.mode === "train")) assert(train.source === "irish_rail" && train.quality === "reported_location" && train.observedAt === null);
  return buses;
}
module.exports = { verifyLiveData };
async function run() {
  const url = new URL(process.env.BALLINA_LIVE_URL);
  assert(url.protocol === "https:" && url.hostname.endsWith(".onrender.com") && !url.username && !url.password && !url.port && !url.search && !url.hash);
  const launch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {};
  launch.env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "HOME", "LANG", "DISPLAY", "TMPDIR", "XDG_RUNTIME_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].includes(key)));
  if (process.env.HTTPS_PROXY) {
    const provided = new URL(process.env.HTTPS_PROXY);
    launch.proxy = { server: provided.protocol + "//" + provided.host };
    if (provided.username) launch.proxy.username = decodeURIComponent(provided.username);
    if (provided.password) launch.proxy.password = decodeURIComponent(provided.password);
  }
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], csp = [], requests = [], scheduleResponses = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /Content Security|Refused/.test(message.text())) csp.push(message.text()); });
    page.on("request", request => {
      const headers = request.headers();
      assert(!headers.apikey && !headers.authorization && !headers['x-ballina-gateway']);
      requests.push(new URL(request.url()));
    });
    page.on('response', response => {
      const requestUrl = new URL(response.url());
      if (requestUrl.origin !== url.origin || requestUrl.pathname !== '/api/journeys') return;
      scheduleResponses.push((async () => {
        assert.equal(response.status(), 200);
        assert(!requestUrl.searchParams.get('from')?.startsWith('place:') && !requestUrl.searchParams.get('to')?.startsWith('place:'));
        const body = await response.text();
        assert(body.length <= 1048576);
        return JSON.parse(body);
      })().then(value => ({ value }), () => ({ failed: true })));
    });
    assert.equal((await page.goto(new URL("#/live", url).href, { waitUntil: "domcontentloaded", timeout: 60000 })).status(), 200);
    await page.getByRole("heading", { name: "Buses & trains." }).waitFor();
    await page.locator(".live-status").first().filter({ hasText: "Auto-refresh" }).waitFor({ timeout: 30000 });
    const data = await page.evaluate(async () => {
      const response = await fetch("api/live", { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw Error("Hosted live endpoint failed.");
      const body = await response.text();
      if (body.length > 1048576) throw Error("Hosted response exceeds contract.");
      return JSON.parse(body);
    });
    const buses = verifyLiveData(data);
    await page.waitForFunction(() => [...document.querySelectorAll("img.leaflet-tile")].some(image => image.complete && image.naturalWidth > 0), null, { timeout: 30000 });
    const widths = [320, 360, 390, 601, 801, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator(".live-heading button").filter({ hasText: "Refresh" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".live-heading button").disabled, null, { timeout: 20000 });
    await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
    await page.getByLabel('From stop', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByLabel('Schedule time').fill('07:00');
    await page.getByRole('button', { name: 'Find scheduled journeys' }).click();
    await page.locator('.scheduled-results').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.scheduled-results .source-warning').count(), 0);
    const observed = await Promise.all(scheduleResponses);
    assert(observed.length > 0 && observed.every(r => !r.failed));
    const schedules = observed.map(r => r.value);
    for (const scheduled of schedules) {
      assert.equal(scheduled.source, 'nta_gtfs'); assert.equal(scheduled.predictionType, 'scheduled');
      assert.equal(scheduled.walkingIncluded, false); assert.equal(scheduled.realTimeApplied, false);
      assert(Array.isArray(scheduled.journeys) && scheduled.journeys.length <= 6 && scheduled.journeys.every(j => j.rides.length > 0));
    }
    const scheduledOptions = schedules.reduce((count, r) => count + r.journeys.length, 0);
    assert(scheduledOptions > 0 && schedules.every(r => r.feedVersion === schedules[0].feedVersion));
    await page.getByRole('link', { name: 'View itinerary' }).first().click();
    await page.locator('.scheduled-itinerary').waitFor({ timeout: 30000 });
    assert.deepEqual(errors, []); assert.deepEqual(csp, []);
    assert(requests.every(request => request.origin === url.origin || request.hostname === "tile.openstreetmap.org"));
    const proof = { url: url.href + "#/live", browserVerified: true, mode: "live", sources: data.sources,
      vehiclesAtVerification: data.vehicles.length, generatedAt: data.generatedAt, responsiveWidths: widths,
      busGpsPositionsAtVerification: buses.length, railPositionsAreReported: true,
      realMapTiles: true, browserCredentials: false, journeySearchRemainsDemo: false,
      officialScheduledSearch: true, officialItineraryDetails: true, feedVersion: schedules[0].feedVersion, scheduledOptions,
      walkingDirectionsVerified: false, realTimeAppliedToItineraries: false };
    fs.writeFileSync("live-browser-proof.json", JSON.stringify(proof, null, 2));
    console.log("::notice title=Live gateway browser verified::" + JSON.stringify(proof));
  } finally { await browser.close(); }
}
if (require.main === module) run().catch(() => { console.error("Hosted browser smoke failed; no private request data logged."); process.exitCode = 1; });
