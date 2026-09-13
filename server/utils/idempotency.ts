export const TIME_ZONE = 'America/Sao_Paulo';
export const DEFAULT_HOURS = ['08:00', '11:00', '14:00', '17:00', '20:00'];

// Facebook scheduling needs a small operational lead time. A slot that is still
// technically in the future can become unavailable while copy generation,
// preview loading and the native scheduling dialog are running.
export const MIN_SCHEDULING_LEAD_MS = 5 * 60 * 1000;

export function normalizeGroupUrl(groupUrl: string): string {
  return (groupUrl || '').trim().replace(/\/+$/, '');
}

export function normalizeScheduledAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return (value || '').trim();
  }
  return parsed.toISOString();
}

export function calculatePublicationIdempotencyKey(productId: string, groupUrl: string, scheduledAt: string): string {
  return `${(productId || '').trim()}:${normalizeGroupUrl(groupUrl)}:${normalizeScheduledAt(scheduledAt)}`;
}

export function localIso(date: string, time: string): string {
  const target = new Date(`${date}T${time}:00-03:00`);

  // Do not create/reuse a queue item for a slot that can become past before
  // Facebook reaches its native time selector. Returning an already-past value
  // lets SchedulerService's existing future-slot guard skip it and continue to
  // the next configured daily slot without creating a bad publication.
  if (target.getTime() <= Date.now() + MIN_SCHEDULING_LEAD_MS) {
    return new Date(0).toISOString();
  }

  return target.toISOString();
}

export function localDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function localTimeString(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function monthDates(year: number, month: number): string[] {
  const result: string[] = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    result.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return result;
}
