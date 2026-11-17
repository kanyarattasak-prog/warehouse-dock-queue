import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { BookingEvent } from '../../types';
import { formatThaiDateTime, isoToBangkokDateStr } from '../../lib/time';
import { ACTOR_TYPE_LABELS, EVENT_TYPE_LABELS } from '../../lib/status';
import { downloadCsvWithBom } from '../../lib/csv';

interface AdminAuditTabProps {
  events: BookingEvent[];
}

function summarizeDiff(ev: BookingEvent): string {
  if (ev.entity_type === 'booking') {
    const oldObj = (ev.old_data || {}) as Record<string, unknown>;
    const newObj = (ev.new_data || {}) as Record<string, unknown>;
    const plate = String(newObj.license_plate || oldObj.license_plate || '');
    const changes: string[] = [];

    if (oldObj.status !== newObj.status && (oldObj.status || newObj.status)) {
      changes.push(`สถานะ: ${oldObj.status || '-'} → ${newObj.status || '-'}`);
    }
    if (oldObj.booking_date !== newObj.booking_date && oldObj.booking_date) {
      changes.push(`วัน: ${oldObj.booking_date} → ${newObj.booking_date}`);
    }
    if (oldObj.slot_hour !== newObj.slot_hour && oldObj.slot_hour !== undefined) {
      changes.push(`เวลา: ${oldObj.slot_hour}:00 → ${newObj.slot_hour}:00`);
    }
    if (oldObj.dock_number !== newObj.dock_number && newObj.dock_number) {
      changes.push(`โดค: ${oldObj.dock_number || '-'} → ${newObj.dock_number}`);
    }
    if (ev.event_type === 'deleted') {
      changes.push('ลบออกจากรายการหลัก (Soft Delete)');
    }
    return `${plate ? `[${plate}] ` : ''}${changes.join(', ') || 'บันทึกข้อมูล'}`;
  }

  if (ev.entity_type === 'settings') {
    const oldS = (ev.old_data || {}) as Record<string, unknown>;
    const newS = (ev.new_data || {}) as Record<string, unknown>;
    return `โดค: ${oldS.dock_count ?? '-'} → ${newS.dock_count ?? '-'}, เวลาเปิด-ปิด: ${newS.open_hour ?? '-'}-${newS.close_hour ?? '-'}`;
  }

  const oldU = (ev.old_data || {}) as Record<string, unknown>;
  const newU = (ev.new_data || {}) as Record<string, unknown>;
  const email = String(newU.email || oldU.email || '');
  return `${email} (${JSON.stringify(newU)})`;
}

export function AdminAuditTab({ events }: AdminAuditTabProps) {
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('all');
  const [actorType, setActorType] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (eventType !== 'all' && ev.event_type !== eventType) return false;
      if (actorType !== 'all' && ev.actor_type !== actorType) return false;
      if (dateFilter && isoToBangkokDateStr(ev.created_at) !== dateFilter) return false;
      if (q) {
        const hay = `${ev.actor_email || ''} ${ev.reason || ''} ${ev.entity_id} ${JSON.stringify(
          ev.new_data || {}
        )} ${JSON.stringify(ev.old_data || {})}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, eventType, actorType, dateFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleExportCsv = () => {
    const headers = ['เวลา', 'ผู้ทำ', 'อีเมลผู้ทำ', 'เหตุการณ์', 'รายละเอียดค่าเดิม→ใหม่', 'เหตุผล'];
    const rows = filtered.map((ev) => [
      formatThaiDateTime(ev.created_at),
      ACTOR_TYPE_LABELS[ev.actor_type] || ev.actor_type,
      ev.actor_email || '-',
      EVENT_TYPE_LABELS[ev.event_type] || ev.event_type,
      summarizeDiff(ev),
      ev.reason || '-',
    ]);
    downloadCsvWithBom(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              ประวัติการใช้งานระบบ (Audit Log)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              บันทึกอัตโนมัติด้วย Database Trigger ไม่สามารถแก้ไขหรือลบย้อนหลังได้
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium inline-flex items-center gap-2 self-start md:self-auto whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV ({filtered.length})</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาทะเบียน อีเมล เหตุผล..."
              className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>

          <select
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setPage(1);
            }}
            className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="all">ทุกเหตุการณ์</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={actorType}
            onChange={(e) => {
              setActorType(e.target.value);
              setPage(1);
            }}
            className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="all">ผู้ทำทั้งหมด</option>
            {Object.entries(ACTOR_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">เวลา</th>
                <th className="px-3 py-2.5 text-left font-medium">ผู้ทำ</th>
                <th className="px-3 py-2.5 text-left font-medium">เหตุการณ์</th>
                <th className="px-3 py-2.5 text-left font-medium">ค่าเดิม → ค่าใหม่</th>
                <th className="px-3 py-2.5 text-left font-medium">เหตุผล</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    ไม่พบประวัติเหตุการณ์
                  </td>
                </tr>
              ) : (
                pageItems.map((ev) => (
                  <tr key={ev.id}>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                      {formatThaiDateTime(ev.created_at)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                      {ACTOR_TYPE_LABELS[ev.actor_type] || ev.actor_type}
                      {ev.actor_email ? (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {ev.actor_email}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">
                      {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                    </td>
                    <td className="px-3 py-2.5 max-w-md text-xs text-slate-700 dark:text-slate-300">
                      {summarizeDiff(ev)}
                    </td>
                    <td className="px-3 py-2.5 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                      {ev.reason || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span className="tabular-nums">
            แสดง {pageItems.length} จาก {filtered.length} รายการ (หน้า {safePage}/{totalPages})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
