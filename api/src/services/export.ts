import ExcelJS from 'exceljs';
import type { Event, Guest, GuestCompanion } from '@prisma/client';
import { isoDate } from '../lib/format.js';

export const EXPORT_COLUMNS = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  attendance: 'Status',
  partySize: 'Number of guests',
  primaryMeal: 'Main meal',
  primaryDietary: 'Allergies / dietary notes',
  dietaryTags: 'Dietary tags',
  companionsCount: 'Companions',
  extraEvents: 'Other events',
  answers: 'Answers',
  message: 'Message',
  notes: 'Host notes',
  source: 'Source',
  submittedAt: 'Submitted',
} as const;
export type ExportColumn = keyof typeof EXPORT_COLUMNS;
export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = ['fullName', 'email', 'attendance', 'partySize', 'primaryMeal', 'primaryDietary', 'companionsCount', 'message', 'submittedAt'];

type G = Guest & { companions: GuestCompanion[] };
const STATUS: Record<string, string> = { yes: 'Attending', no: 'Not attending', pending: 'Pending' };
const kv = (o: unknown) =>
  Object.entries((o ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

function cell(g: G, col: ExportColumn): string | number {
  switch (col) {
    case 'attendance':
      return STATUS[g.attendance] ?? g.attendance;
    case 'companionsCount':
      return g.companions.length;
    case 'dietaryTags':
      return g.dietaryTags.join(', ');
    case 'extraEvents':
      return kv(g.extraEvents);
    case 'answers':
      return kv(g.answers);
    case 'submittedAt':
      return g.submittedAt.toISOString().replace('T', ' ').slice(0, 16);
    case 'partySize':
      return g.partySize;
    default:
      return ((g as any)[col] ?? '') as string;
  }
}

/** Neutralise spreadsheet formula injection (cells starting with = + - @). */
function safe(v: string | number) {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildXlsx(event: Event, guests: G[], columns: ExportColumn[], includeHeader: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Invitation platform';
  wb.created = new Date();
  const ws = wb.addWorksheet('Guests');
  if (includeHeader) {
    ws.addRow([event.title]).font = { bold: true, size: 14 };
    ws.addRow([[isoDate(event.eventDate), event.venueName].filter(Boolean).join(' · ')]);
    ws.addRow([]);
  }
  const head = ws.addRow(columns.map((c) => EXPORT_COLUMNS[c]));
  head.font = { bold: true };
  for (const g of guests) ws.addRow(columns.map((c) => safe(cell(g, c))));
  ws.columns.forEach((c) => (c.width = 22));

  const cs = wb.addWorksheet('Companions');
  cs.addRow(['Main guest', 'Companion', 'Type', 'Meal', 'Allergies / dietary notes']).font = { bold: true };
  for (const g of guests) for (const c of g.companions) cs.addRow([g.fullName, c.fullName, c.type === 'child' ? 'Child' : 'Adult', c.meal ?? '', c.dietary ?? ''].map(safe));
  cs.columns.forEach((c) => (c.width = 24));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildCsv(guests: G[], columns: ExportColumn[]): string {
  const esc = (v: string | number) => {
    const s = String(safe(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(EXPORT_COLUMNS[c])).join(',')];
  for (const g of guests) lines.push(columns.map((c) => esc(cell(g, c))).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
