const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dublinInstant(date: string, time: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const candidates = [wall, wall - 3600000].filter(epoch => {
    const parts = formatter.formatToParts(epoch), get = (type: string) => parts.find(p => p.type === type)!.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}` === `${date}T${time}`;
  });
  if (candidates.length !== 1) throw Error('This Ireland clock change time is nonexistent or ambiguous. Choose another time.');
  return candidates[0]!;
}
export function scheduleClock(seconds: number, reference?: string): string {
  if (!reference) return `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
  const epoch = Date.parse(reference) + seconds * 1000, parts = formatter.formatToParts(epoch), get = (type: string) => parts.find(p => p.type === type)!.value;
  const time = `${get('hour')}:${get('minute')}`, date = `${get('year')}-${get('month')}-${get('day')}`;
  try { dublinInstant(date, time); return time; } catch {
    const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', timeZoneName: 'shortOffset' }).formatToParts(epoch).find(p => p.type === 'timeZoneName')!.value;
    return `${time} (${offset === 'GMT+0' ? 'GMT' : offset})`;
  }
}
export function scheduleDaySuffix(seconds: number, reference?: string): string {
  let days = Math.floor(seconds / 86400);
  if (reference) {
    const localDay = (epoch: number) => {
      const parts = formatter.formatToParts(epoch), get = (type: string) => parts.find(p => p.type === type)!.value;
      return Date.parse(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
    };
    days = (localDay(Date.parse(reference) + seconds * 1000) - localDay(Date.parse(reference))) / 86400000;
  }
  return days ? ` (+${days} day${days === 1 ? '' : 's'})` : '';
}
