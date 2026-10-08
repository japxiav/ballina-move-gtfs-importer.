import type { Calendar, CalendarException } from './types.ts';
const dateRx = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(value:string):boolean {
  if(!dateRx.test(value))return false;
  const dt=new Date(value+'T00:00:00Z');
  return !Number.isNaN(dt.getTime())&&dt.toISOString().slice(0,10)===value;
}
export function activeService(serviceId:string,date:string,calendars:Calendar[],exceptions:CalendarException[]):boolean {
  if(!validDate(date))throw new Error('invalid_service_date');
  const exception=exceptions.find(x=>x.serviceId===serviceId&&x.date===date);
  if(exception)return exception.type===1;
  const rule=calendars.find(x=>x.serviceId===serviceId);
  if(!rule||date<rule.startDate||date>rule.endDate)return false;
  return rule.weekdays[new Date(date+'T00:00:00Z').getUTCDay()]===true;
}
/** Calendar arithmetic for GTFS service dates; UTC is used ONLY for date math. */
export function offsetServiceDate(day:string,offset:number):string {
  if(!validDate(day)||!Number.isInteger(offset)||Math.abs(offset)>2)throw new Error('invalid_service_date_offset');
  const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
export function parseGtfsTime(time:string):number {
  const match=/^(\d{1,3}):(\d{2}):(\d{2})$/.exec(time);
  if(!match)throw new Error('invalid_gtfs_time');
  const h=Number(match[1]),m=Number(match[2]),s=Number(match[3]);
  if(h>99||m>59||s>59)throw new Error('invalid_gtfs_time');
  return h*3600+m*60+s;
}
export function displayServiceTime(seconds:number):string {
  if(!Number.isFinite(seconds)||seconds<0)throw new Error('invalid_service_seconds');
  const whole=Math.floor(seconds);
  const d=Math.floor(whole/86400);
  const h=Math.floor(whole%86400/3600);
  const m=Math.floor(whole%3600/60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}${d?` (+${d}d)`:''}`;
}
/** Used only to WARN on transition dates: this prototype never claims timezone-safe UTC ETAs on DST boundaries. */
export function dstTransitionDay(date:string):boolean {
  if(!validDate(date))throw new Error('invalid_service_date');
  const [yy,mm,dd]=date.split('-').map(Number);
  if(mm!==3&&mm!==10)return false;
  const dayOfWeek=new Date(Date.UTC(yy!,mm!-1,dd!)).getUTCDay();
  const daysInMonth=new Date(Date.UTC(yy!,mm!,0)).getUTCDate();
  return dayOfWeek===0 && dd!+7>daysInMonth;
}
