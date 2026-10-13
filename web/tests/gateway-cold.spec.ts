import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

test('real gateway admits the browser parallel catalog and journey request with a cold cache', async ({ page }) => {
  const child = spawn('python', [path.resolve('tests/fixtures/cold_gateway_server.py')], {
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'TZ'].includes(key))),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const ready = await new Promise<{ port: number; date: string }>((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => reject(Error('Offline gateway startup timeout.')), 8000);
      child.once('error', () => { clearTimeout(timeout); reject(Error('Offline gateway could not start.')); });
      child.stdout!.on('data', (part: Buffer) => {
        buffer += part.toString();
        if (!buffer.includes('\n')) return;
        try {
          const value = JSON.parse(buffer.split('\n')[0]!);
          if (value.event !== 'offline_gateway_ready' || !Number.isInteger(value.port) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw Error();
          clearTimeout(timeout); resolve(value);
        } catch { clearTimeout(timeout); reject(Error('Invalid offline gateway startup.')); }
      });
    });
    const statuses: number[] = [];
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/')) statuses.push(response.status()); });
    const query = new URLSearchParams({ from: 'A', to: 'B', date: ready.date, time: '07:55', modes: 'bus', changes: '0' });
    await page.goto(`http://127.0.0.1:${ready.port}/#/plan?${query}`);
    await expect(page.locator('.journey-card')).toHaveCount(1);
    await expect(page.locator('.journey-card')).toContainText('Offline 420');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(statuses.sort()).toEqual([200, 200]);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
    }
  }
});
