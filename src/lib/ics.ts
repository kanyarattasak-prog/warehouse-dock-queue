import { MyBooking } from '../types';
import { formatSlotRange, slotStartEpochMs } from './time';
import { JOB_TYPE_LABELS } from './status';

function toIcsUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${sec}Z`;
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function downloadBookingIcs(booking: MyBooking, notifyMinutes: number = 30): void {
  const startMs = slotStartEpochMs(booking.booking_date, booking.slot_hour);
  const endMs = startMs + 60 * 60 * 1000;
  const alarmMinutes = Math.max(5, Math.min(180, notifyMinutes || 30));

  const summary = `คิวรถโกดัง: ${booking.license_plate} (${JOB_TYPE_LABELS[booking.job_type]})`;
  const descLines = [
    `ทะเบียนรถ: ${booking.license_plate}`,
    `คนขับ: ${booking.driver_name}`,
    booking.company ? `บริษัท: ${booking.company}` : null,
    `ประเภทงาน: ${JOB_TYPE_LABELS[booking.job_type]}`,
    `ช่วงเวลา: ${formatSlotRange(booking.slot_hour)} (เวลาประเทศไทย)`,
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Warehouse Queue System//TH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@warehouse-queue`,
    `DTSTAMP:${toIcsUtc(Date.now())}`,
    `DTSTART:${toIcsUtc(startMs)}`,
    `DTEND:${toIcsUtc(endMs)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(descLines)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`ใกล้ถึงคิวรถหน้าโกดัง (${booking.license_plate})`)}`,
    `TRIGGER:-PT${alarmMinutes}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `queue-${booking.booking_date}-${booking.license_plate.replace(/\s+/g, '_')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
