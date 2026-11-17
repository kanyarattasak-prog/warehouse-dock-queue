import React, { useMemo, useState } from 'react';
import { BookingEvent, StaffBooking, WarehouseSettings } from '../../types';
import {
  addDaysToDateStr,
  formatSlotRange,
  getBangkokNow,
  isoToBangkokDateStr,
} from '../../lib/time';
import { getActiveDockNumbers } from '../../lib/status';
import { LiveDocksGrid } from '../LiveDocksGrid';

interface AdminDashboardTabProps {
  settings: WarehouseSettings;
  bookings: StaffBooking[];
  events: BookingEvent[];
}

export function AdminDashboardTab({ settings, bookings, events }: AdminDashboardTabProps) {
  const todayStr = getBangkokNow().dateStr;
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

  const activeBookings = useMemo(() => bookings.filter((b) => !b.is_deleted), [bookings]);

  const todayBookings = useMemo(
    () => activeBookings.filter((b) => b.booking_date === todayStr),
    [activeBookings, todayStr]
  );

  const liveOccupants = useMemo(
    () => activeBookings.filter((b) => b.status === 'called' || b.status === 'loading'),
    [activeBookings]
  );

  const todayStats = useMemo(() => {
    const total = todayBookings.length;
    const arrived = todayBookings.filter((b) => b.status === 'arrived').length;
    const loading = todayBookings.filter((b) => b.status === 'loading').length;
    const completed = todayBookings.filter((b) => b.status === 'completed').length;
    const noShow = todayBookings.filter((b) => b.status === 'no_show').length;
    const cancelled = todayBookings.filter((b) => b.status === 'cancelled').length;
    return { total, arrived, loading, completed, noShow, cancelled };
  }, [todayBookings]);

  // Calculate metrics from booking_events (with accurate state transition timestamps)
  const metrics = useMemo(() => {
    const totalAll = activeBookings.length;
    const noShowAll = activeBookings.filter((b) => b.status === 'no_show').length;
    const noShowRate = totalAll > 0 ? (noShowAll / totalAll) * 100 : 0;

    // Group booking_events by booking_id to compute wait time (arrived -> called) and loading time (loading -> completed)
    const eventMap = new Map<string, { arrivedAt?: number; calledAt?: number; loadingAt?: number; completedAt?: number }>();
    const sortedEvents = [...events]
      .filter((ev) => ev.entity_type === 'booking' && ev.booking_id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const ev of sortedEvents) {
      const bid = ev.booking_id!;
      const entry = eventMap.get(bid) || {};
      const t = new Date(ev.created_at).getTime();
      const newStatus = (ev.new_data as { status?: string } | null)?.status;

      if (newStatus === 'arrived' && !entry.arrivedAt) entry.arrivedAt = t;
      if (newStatus === 'called' && !entry.calledAt) entry.calledAt = t;
      if (newStatus === 'loading' && !entry.loadingAt) entry.loadingAt = t;
      if (newStatus === 'completed' && !entry.completedAt) entry.completedAt = t;
      eventMap.set(bid, entry);
    }

    const waitDurationsMin: number[] = [];
    const loadDurationsMin: number[] = [];

    for (const b of activeBookings) {
      const evTimes = eventMap.get(b.id);
      const arrivedMs = evTimes?.arrivedAt ?? (b.arrived_at ? new Date(b.arrived_at).getTime() : undefined);
      const calledMs = evTimes?.calledAt ?? (b.called_at ? new Date(b.called_at).getTime() : undefined);
      const loadingMs = evTimes?.loadingAt ?? (b.loading_at ? new Date(b.loading_at).getTime() : undefined);
      const completedMs = evTimes?.completedAt ?? (b.completed_at ? new Date(b.completed_at).getTime() : undefined);

      if (arrivedMs && calledMs && calledMs >= arrivedMs) {
        waitDurationsMin.push((calledMs - arrivedMs) / 60000);
      }
      if (loadingMs && completedMs && completedMs >= loadingMs) {
        loadDurationsMin.push((completedMs - loadingMs) / 60000);
      }
    }

    const avgWaitMin =
      waitDurationsMin.length > 0
        ? waitDurationsMin.reduce((s, v) => s + v, 0) / waitDurationsMin.length
        : null;
    const avgLoadMin =
      loadDurationsMin.length > 0
        ? loadDurationsMin.reduce((s, v) => s + v, 0) / loadDurationsMin.length
        : null;

    // Dock utilization today
    const activeDockCount = getActiveDockNumbers(settings).length;
    const operatingHours = Math.max(1, settings.close_hour - settings.open_hour);
    const totalDockSlotCapacity = activeDockCount * operatingHours;
    const utilizedToday = todayBookings.filter(
      (b) => b.status !== 'cancelled' && b.status !== 'no_show'
    ).length;
    const dockUtilRate =
      totalDockSlotCapacity > 0 ? Math.min(100, (utilizedToday / totalDockSlotCapacity) * 100) : 0;

    // Pickup vs Dropoff ratio
    const pickupCount = activeBookings.filter((b) => b.job_type === 'pickup').length;
    const dropoffCount = activeBookings.filter((b) => b.job_type === 'dropoff').length;
    const pickupPct = totalAll > 0 ? (pickupCount / totalAll) * 100 : 0;
    const dropoffPct = totalAll > 0 ? (dropoffCount / totalAll) * 100 : 0;

    return {
      totalAll,
      noShowAll,
      noShowRate,
      avgWaitMin,
      avgLoadMin,
      dockUtilRate,
      pickupCount,
      dropoffCount,
      pickupPct,
      dropoffPct,
    };
  }, [activeBookings, events, settings, todayBookings]);

  // Hourly chart data for today
  const hourlySeries = useMemo(() => {
    const rows: Array<{ hour: number; label: string; count: number }> = [];
    for (let h = settings.open_hour; h < settings.close_hour; h++) {
      const count = todayBookings.filter(
        (b) => b.slot_hour === h && b.status !== 'cancelled'
      ).length;
      rows.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        count,
      });
    }
    return rows;
  }, [todayBookings, settings.open_hour, settings.close_hour]);

  const maxHourly = Math.max(1, ...hourlySeries.map((r) => r.count));

  // Trend 7 / 30 days
  const trendSeries = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const b of activeBookings) {
      if (b.status === 'cancelled') continue;
      const d = b.booking_date || isoToBangkokDateStr(b.created_at);
      countMap.set(d, (countMap.get(d) || 0) + 1);
    }

    const rows: Array<{ date: string; shortLabel: string; count: number }> = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = addDaysToDateStr(todayStr, -i);
      const [, m, day] = d.split('-');
      rows.push({
        date: d,
        shortLabel: `${Number(day)}/${Number(m)}`,
        count: countMap.get(d) || 0,
      });
    }
    return rows;
  }, [activeBookings, trendDays, todayStr]);

  const maxTrend = Math.max(1, ...trendSeries.map((r) => r.count));

  // Top 10 companies
  const topCompanies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of activeBookings) {
      const name = b.company?.trim() || 'ไม่ระบุบริษัท';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [activeBookings]);

  const kpiCards = [
    { label: 'จองวันนี้ทั้งหมด', value: todayStats.total, tone: 'text-slate-900 dark:text-white' },
    { label: 'มาถึงแล้ว', value: todayStats.arrived, tone: 'text-amber-700 dark:text-amber-400' },
    { label: 'กำลังขึ้น/ลงของ', value: todayStats.loading, tone: 'text-indigo-700 dark:text-indigo-400' },
    { label: 'เสร็จสิ้น', value: todayStats.completed, tone: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'ไม่มาตามนัด', value: todayStats.noShow, tone: 'text-rose-700 dark:text-rose-400' },
    { label: 'ยกเลิก', value: todayStats.cancelled, tone: 'text-slate-500 dark:text-slate-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Today KPI Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
          >
            <p className="text-xs text-slate-500 dark:text-slate-400">{card.label}</p>
            <p className={`mt-1.5 text-2xl font-bold font-mono-tabular ${card.tone}`}>
              {card.value}
            </p>
          </div>
        ))}
      </section>

      {/* Live Docks */}
      <section className="space-y-2.5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          สถานะโดคสด
        </h2>
        <LiveDocksGrid settings={settings} occupants={liveOccupants} />
      </section>

      {/* Operational Metrics Calculated from booking_events */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">อัตราไม่มาตามนัด</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-rose-700 dark:text-rose-400">
            {metrics.noShowRate.toFixed(1)}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {metrics.noShowAll} จาก {metrics.totalAll} คิว
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">เวลารอเฉลี่ย (มาถึง → เรียกคิว)</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900 dark:text-white">
            {metrics.avgWaitMin !== null ? `${metrics.avgWaitMin.toFixed(1)} นาที` : '-'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">คำนวณจากประวัติเหตุการณ์</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">เวลาขึ้น/ลงของเฉลี่ย</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900 dark:text-white">
            {metrics.avgLoadMin !== null ? `${metrics.avgLoadMin.toFixed(1)} นาที` : '-'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">เริ่มขึ้นลงของ → เสร็จสิ้น</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">อัตราใช้โดควันนี้</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-blue-700 dark:text-blue-400">
            {metrics.dockUtilRate.toFixed(1)}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            เทียบความจุรายชั่วโมงวันนี้
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">สัดส่วน รับของ / ส่งของ</p>
          <p className="mt-1 text-xl font-bold font-mono-tabular text-slate-900 dark:text-white">
            {metrics.pickupPct.toFixed(0)}% / {metrics.dropoffPct.toFixed(0)}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            รับ {metrics.pickupCount} · ส่ง {metrics.dropoffCount}
          </p>
        </div>
      </section>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly Chart */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              กราฟจองรายชั่วโมงวันนี้
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {formatSlotRange(settings.open_hour).slice(0, 5)}–{String(settings.close_hour).padStart(2, '0')}:00
            </span>
          </div>

          <div className="space-y-2">
            {hourlySeries.map((row) => (
              <div key={row.hour} className="flex items-center gap-3">
                <span className="w-12 text-xs font-mono-tabular text-slate-600 dark:text-slate-300 shrink-0">
                  {row.label}
                </span>
                <div className="flex-1 h-6 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-500 rounded-md transition-all"
                    style={{ width: `${(row.count / maxHourly) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-xs font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Trend 7/30 Days Chart */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              แนวโน้มการจองย้อนหลัง {trendDays} วัน
            </h3>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setTrendDays(d)}
                  className={`px-3 py-1 rounded-md text-xs font-medium ${
                    trendDays === d
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {d} วัน
                </button>
              ))}
            </div>
          </div>

          <div className="h-56 flex items-end gap-1 pt-6">
            {trendSeries.map((item) => {
              const heightPct = Math.max(4, (item.count / maxTrend) * 100);
              return (
                <div
                  key={item.date}
                  className="flex-1 flex flex-col items-center justify-end h-full group"
                  title={`${item.date}: ${item.count} คิว`}
                >
                  <span className="text-[10px] font-mono-tabular text-slate-600 dark:text-slate-300 mb-1">
                    {item.count > 0 ? item.count : ''}
                  </span>
                  <div
                    className="w-full max-w-[28px] rounded-t-md bg-indigo-600 dark:bg-indigo-500 transition-all"
                    style={{ height: `${heightPct}%` }}
                  />
                  {(trendDays === 7 || Number(item.shortLabel.split('/')[0]) % 5 === 0 || item.date === todayStr) && (
                    <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-1.5 whitespace-nowrap">
                      {item.shortLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Top 10 Frequent Companies */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          บริษัทที่จองคิวบ่อยที่สุด 10 อันดับ
        </h3>
        {topCompanies.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">ยังไม่มีข้อมูลการจอง</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium w-12">อันดับ</th>
                  <th className="py-2 text-left font-medium">ชื่อบริษัท</th>
                  <th className="py-2 text-right font-medium">จำนวนคิว</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topCompanies.map((c, idx) => (
                  <tr key={c.name}>
                    <td className="py-2.5 font-mono-tabular text-slate-500 dark:text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {c.name}
                    </td>
                    <td className="py-2.5 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {c.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
