'use strict';
// Offline worker: parse once, measure only solve/native IDs, keep complete
// journeys for equality checks. No provider, database, or HTTP requests.
const fs = require('node:fs'), { performance } = require('node:perf_hooks');
globalThis.fetch = async () => { throw Error('benchmark_network_forbidden'); };
const modulePath = process.argv[2], snapshotPath = process.argv[3];
const schedules = require(modulePath), snapshot = JSON.parse(fs.readFileSync(snapshotPath));
const query = { from: '8490B5550501', to: '8490B151081', date: '2026-10-13', time: '02:59', modes: 'bus,rail', changes: '2' };
(async () => {
  const before = process.cpuUsage(), started = performance.now();
  const result = schedules.searchScheduledJourneys
    ? await schedules.searchScheduledJourneys(snapshot, query)
    : schedules.searchSchedules(snapshot, query);
  const cpu = process.cpuUsage(before);
  console.log(JSON.stringify({ cpuMs: (cpu.user + cpu.system) / 1000,
    wallMs: performance.now() - started, peakRssMb: process.resourceUsage().maxRSS / 1024,
    journeys: result.journeys, networkCalls: 0 }));
})().catch(() => { console.error('Offline schedule benchmark failed.'); process.exitCode = 1; });
