'use strict';
// Read-only verification tooling, not part of the deployed application.
// Install before tile loading; fetchTile must use verified TLS, no credentials,
// no redirects, and a bounded PNG response. Browser visitors are unaffected.
class SmokeTileBudget {
  constructor(fetchTile) {
    this.fetchTile = fetchTile;
    this.cache = new Map(); this.queue = []; this.active = 0; this.maximumActive = 0;
    this.exceeded = false;
  }
  get(url) {
    const match = /^https:\/\/tile\.openstreetmap\.org\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!match || Number(match[1]) > 18 || Number(match[2]) >= 2 ** Number(match[1]) || Number(match[3]) >= 2 ** Number(match[1])) return Promise.reject(Error('invalid_tile_url'));
    if (this.cache.has(url)) return this.cache.get(url);
    if (this.cache.size >= 32) { this.exceeded = true; return Promise.reject(Error('tile_budget_exceeded')); }
    const result = new Promise((resolve, reject) => { this.queue.push({ url, resolve, reject }); });
    this.cache.set(url, result); this.pump(); return result;
  }
  pump() {
    while (this.active < 2 && this.queue.length) {
      const item = this.queue.shift(); this.active++; this.maximumActive = Math.max(this.maximumActive, this.active);
      Promise.resolve().then(() => this.fetchTile(item.url)).then(item.resolve, item.reject).finally(() => { this.active--; this.pump(); });
    }
  }
  async install(page) {
    await page.route('https://tile.openstreetmap.org/**', async route => {
      try { await route.fulfill({ contentType: 'image/png', body: await this.get(route.request().url()) }); }
      catch { await route.abort().catch(() => {}); }
    });
  }
}
module.exports = { SmokeTileBudget };

// Offline controlled proof: more demand never sends more than32/two to fetcher;
// equivalent requests share one result, and an upstream failure releases a slot.
if (require.main === module) {
  (async () => {
    const assert = require('node:assert/strict'); let calls = 0, current = 0, maximum = 0;
    const budget = new SmokeTileBudget(async url => {
      calls++; maximum = Math.max(maximum, ++current);
      await new Promise(resolve => setTimeout(resolve, 2)); current--;
      if (url.endsWith('/0/0.png')) throw Error('offline_upstream_failure');
      return Buffer.from('offline image response');
    });
    const requests = Array.from({ length: 32 }, (_, i) => `https://tile.openstreetmap.org/6/${i}/0.png`);
    const reads = requests.map(url => budget.get(url));
    assert.equal(budget.get(requests[1]), reads[1]);
    await assert.rejects(budget.get('https://tile.openstreetmap.org/6/32/0.png'), /tile_budget_exceeded/);
    const results = await Promise.allSettled(reads);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(calls, 32); assert.equal(maximum, 2); assert.equal(budget.maximumActive, 2);
    await assert.rejects(budget.get('https://private.invalid/6/0/0.png'), /invalid_tile_url/);
    console.log(JSON.stringify({ scope: 'offline smoke-controller proof, no network and not deployed code', uniqueTileCalls: calls, maximumConcurrent: maximum, excessDemandRejected: true, upstreamFailureReleasesSlot: true, privateInputUrlsAllowed: false, redirectPolicy: 'fetcher must reject redirects; offline fixture does not exercise TLS or redirects' }));
  })().catch(() => { console.error('Offline verification tile-budget proof failed.'); process.exitCode = 1; });
}
