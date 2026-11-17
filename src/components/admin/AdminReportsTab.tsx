import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { StaffBooking } from '../../types';
import { addDaysToDateStr, formatSlotRange, getBangkokNow } from '../../lib/time';
import { downloadCsvWithBom } from '../../lib/csv';

interface AdminReportsTabProps {
  bookings: StaffBooking[];
}

type PeriodMode = 'daily' | 'weekly' | 'monthly';

export function AdminReportsTab({ bookings }: AdminReportsTabProps) {
  const todayStr = getBangkokNow().dateStr;
  const [period, setPeriod] = useState<PeriodMode>('daily');
  const [refDate, setRefDate] = useState(todayStr);

  const range = useMemo(() => {
    if (period === 'daily') {
      return { start: refDate, end: refDate, label: `รายวัน (${refDate})` };
    }
    if (period === 'weekly') {
      const start = addDaysToDateStr(refDate, -6);
      return { start, end: refDate, label: `รายสัปดาห์ (${start} ถึง ${refDate})` };
    }
    const ym = refDate.slice(0, 7);
    return { start: `${ym}-01`, end: `${ym}-31`, label: `รายเดือน (${ym})` };
  }, [period, refDate]);

  const scopedBookings = useMemo(() => {
    return bookings.filter(
      (b) => !b.is_deleted && b.booking_date >= range.start && b.booking_date <= range.end
    );
  }, [bookings, range]);

  const summary = useMemo(() => {
    const total = scopedBookings.length;
    const noShow = scopedBookings.filter((b) => b.status === 'no_show').length;
    const noShowRate = total > 0 ? (noShow / total) * 100 : 0;

    const waitList: number[] = [];
    const loadList: number[] = [];
    const hourCounts = new Map<number, number>();

    for (const b of scopedBookings) {
      if (b.status !== 'cancelled') {
        hourCounts.set(b.slot_hour, (hourCounts.get(b.slot_hour) || 0) + 1);
      }
      if (b.arrived_at && b.called_at) {
        const diff = (new Date(b.called_at).getTime() - new Date(b.arrived_at).getTime()) / 60000;
        if (diff >= 0) waitList.push(diff);
      }
      if (b.loading_at && b.completed_at) {
        const diff = (new Date(b.completed_at).getTime() - new Date(b.loading_at).getTime()) / 60000;
        if (diff >= 0) loadList.push(diff);
      }
    }

    let peakHour: number | null = null;
    let peakCount = 0;
    for (const [h, cnt] of hourCounts.entries()) {
      if (cnt > peakCount) {
        peakCount = cnt;
        peakHour = h;
      }
    }

    const avgWait =
      waitList.length > 0 ? waitList.reduce((a, b) => a + b, 0) / waitList.length : null;
    const avgLoad =
      loadList.length > 0 ? loadList.reduce((a, b) => a + b, 0) / loadList.length : null;

    return { total, noShow, noShowRate, avgWait, avgLoad, peakHour, peakCount };
  }, [scopedBookings]);

  const companySummary = useMemo(() => {
    const map = new Map<
      string,
      { company: string; total: number; pickup: number; dropoff: number; completed: number; noShow: number; cancelled: number }
    >();

    for (const b of scopedBookings) {
      const name = b.company?.trim() || 'ไม่ระบุบริษัท';
      const cur = map.get(name) || {
        company: name,
        total: 0,
        pickup: 0,
        dropoff: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
      };
      cur.total++;
      if (b.job_type === 'pickup') cur.pickup++;
      else cur.dropoff++;
      if (b.status === 'completed') cur.completed++;
      if (b.status === 'no_show') cur.noShow++;
      if (b.status === 'cancelled') cur.cancelled++;
      map.set(name, cur);
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scopedBookings]);

  const handleExportCsv = () => {
    const headers = ['บริษัท', 'จำนวนคิวทั้งหมด', 'รับของ', 'ส่งของ', 'เสร็จสิ้น', 'ไม่มาตามนัด', 'ยกเลิก'];
    const rows = companySummary.map((r) => [
      r.company,
      r.total,
      r.pickup,
      r.dropoff,
      r.completed,
      r.noShow,
      r.cancelled,
    ]);
    downloadCsvWithBom(`report-${period}-${refDate}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {(
              [
                ['daily', 'รายวัน'],
                ['weekly', 'รายสัปดาห์'],
                ['monthly', 'รายเดือน'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPeriod(k)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium ${
                  period === k
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={refDate}
            onChange={(e) => e.target.value && setRefDate(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์รายงาน</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Printable Report Body */}
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            รายงานสรุปคิวรถหน้าโกดัง · {range.label}
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">จำนวนคิวทั้งหมด</p>
            <p className="mt-1 text-2xl font-bold font-mono-tabular">{summary.total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">อัตราไม่มาตามนัด</p>
            <p className="mt-1 text-2xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400">
              {summary.noShowRate.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">เวลารอเฉลี่ย</p>
            <p className="mt-1 text-2xl font-bold font-mono-tabular">
              {summary.avgWait !== null ? `${summary.avgWait.toFixed(1)} นาที` : '-'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">เวลาขึ้น/ลงของเฉลี่ย</p>
            <p className="mt-1 text-2xl font-bold font-mono-tabular">
              {summary.avgLoad !== null ? `${summary.avgLoad.toFixed(1)} นาที` : '-'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">ช่วงเวลาแน่นสุด</p>
            <p className="mt-1 text-lg font-bold font-mono-tabular">
              {summary.peakHour !== null ? formatSlotRange(summary.peakHour) : '-'}
            </p>
            {summary.peakHour !== null && (
              <p className="text-xs text-slate-500 tabular-nums">{summary.peakCount} คัน</p>
            )}
          </div>
        </div>

        {/* Company Summary Table */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              สรุปแยกตามบริษัท
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">บริษัท</th>
                  <th className="px-4 py-2.5 text-right font-medium">รวม</th>
                  <th className="px-4 py-2.5 text-right font-medium">รับของ</th>
                  <th className="px-4 py-2.5 text-right font-medium">ส่งของ</th>
                  <th className="px-4 py-2.5 text-right font-medium">เสร็จสิ้น</th>
                  <th className="px-4 py-2.5 text-right font-medium">ไม่มา</th>
                  <th className="px-4 py-2.5 text-right font-medium">ยกเลิก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {companySummary.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      ไม่มีข้อมูลในช่วงเวลาที่เลือก
                    </td>
                  </tr>
                ) : (
                  companySummary.map((r) => (
                    <tr key={r.company}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {r.company}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold">
                        {r.total}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular">{r.pickup}</td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular">{r.dropoff}</td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                        {r.completed}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular text-rose-700 dark:text-rose-400">
                        {r.noShow}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-500">
                        {r.cancelled}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
