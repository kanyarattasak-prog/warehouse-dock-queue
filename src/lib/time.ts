export const BANGKOK_TZ = 'Asia/Bangkok';

export interface BangkokNowParts {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  epochMs: number;
}

export function getBangkokNow(baseDate: Date = new Date()): BangkokNowParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(baseDate);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    dateStr,
    year,
    month,
    day,
    hour,
    minute,
    second,
    epochMs: baseDate.getTime(),
  };
}

export function addDaysToDateStr(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getBangkokDateOffset(offsetDays: number): string {
  const now = getBangkokNow();
  return addDaysToDateStr(now.dateStr, offsetDays);
}

export function slotStartEpochMs(dateStr: string, slotHour: number): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Asia/Bangkok is UTC+7 year-round (no DST)
  return Date.UTC(y, m - 1, d, slotHour - 7, 0, 0, 0);
}

export function minutesUntilSlot(dateStr: string, slotHour: number, nowMs: number = Date.now()): number {
  const targetMs = slotStartEpochMs(dateStr, slotHour);
  return Math.round((targetMs - nowMs) / 60000);
}

export function isSlotPastGracePeriod(dateStr: string, slotHour: number, graceMinutes: number = 30): boolean {
  const startMs = slotStartEpochMs(dateStr, slotHour);
  return Date.now() > startMs + graceMinutes * 60 * 1000;
}

export function formatSlotRange(hour: number): string {
  const start = `${String(hour).padStart(2, '0')}:00`;
  const end = `${String(hour + 1).padStart(2, '0')}:00`;
  return `${start} - ${end}`;
}

const THAI_DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

export function formatThaiDate(dateStr: string, withRelative: boolean = true): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '-';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = THAI_DAYS_SHORT[dt.getUTCDay()];
  const monthName = THAI_MONTHS_SHORT[m - 1];
  const shortText = `${dayName} ${d} ${monthName}`;

  if (!withRelative) {
    return `${d} ${monthName} ${y + 543}`;
  }

  const today = getBangkokNow().dateStr;
  const tomorrow = addDaysToDateStr(today, 1);
  if (dateStr === today) return `วันนี้ · ${shortText}`;
  if (dateStr === tomorrow) return `พรุ่งนี้ · ${shortText}`;
  return shortText;
}

export function formatThaiDateFull(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '-';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = THAI_DAYS_SHORT[dt.getUTCDay()];
  const monthName = THAI_MONTHS_SHORT[m - 1];
  return `${dayName} ${d} ${monthName} ${y + 543}`;
}

export function formatThaiDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '-';
  const p = getBangkokNow(dt);
  const monthName = THAI_MONTHS_SHORT[p.month - 1];
  return `${p.day} ${monthName} ${p.year + 543} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function formatTimeOnlyBkk(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '-';
  const p = getBangkokNow(dt);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

export function isoToBangkokDateStr(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '';
  return getBangkokNow(dt).dateStr;
}
