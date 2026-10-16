const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');

export function buildIcs(input: { uid: string; title: string; date: string; startTime?: string | null; durationHours?: number; timezone: string; location?: string | null; description?: string | null; url?: string | null }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const d = input.date.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//invitation-platform//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${input.uid}`, `DTSTAMP:${stamp}`];
  if (input.startTime && /^\d{2}:\d{2}$/.test(input.startTime)) {
    const [h, m] = input.startTime.split(':').map(Number) as [number, number];
    const endH = h + (input.durationHours ?? 6);
    const pad = (n: number) => String(n).padStart(2, '0');
    lines.push(`DTSTART;TZID=${input.timezone}:${d}T${pad(h)}${pad(m)}00`);
    if (endH < 24) lines.push(`DTEND;TZID=${input.timezone}:${d}T${pad(endH)}${pad(m)}00`);
    else lines.push(`DURATION:PT${input.durationHours ?? 6}H`);
  } else {
    const next = new Date(`${input.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`);
  }
  lines.push(`SUMMARY:${esc(input.title)}`);
  if (input.location) lines.push(`LOCATION:${esc(input.location)}`);
  if (input.description) lines.push(`DESCRIPTION:${esc(input.description)}`);
  if (input.url) lines.push(`URL:${input.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
