import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Plus, RefreshCw, X } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import {
  addDaysToDateStr,
  formatSlotRange,
  formatThaiDate,
  getBangkokNow,
} from '../lib/time';
import {
  getActiveDockNumbers,
  getDockName,
  JOB_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_TEXT_CLASSES,
} from '../lib/status';
import {
  BookingStatus,
  JobType,
  StaffBooking,
  UserRoleRecord,
  WarehouseSettings,
} from '../types';
import { AuthLoginCard } from '../components/AuthLoginCard';
import { LiveDocksGrid } from '../components/LiveDocksGrid';
import { SetupNotice } from '../components/SetupNotice';

interface StaffPageProps {
  sessionEmail: string | null;
  userRole: UserRoleRecord | null;
  authLoading: boolean;
  roleError: string;
  onSignOut: () => Promise<void>;
  onRefreshAuth: () => Promise<void>;
}

const DEFAULT_SETTINGS: WarehouseSettings = {
  id: 1,
  dock_count: 3,
  dock_names: ['โดค 1', 'โดค 2', 'โดค 3'],
  closed_docks: [],
  open_hour: 8,
  close_hour: 17,
  advance_days: 7,
  notify_minutes: 30,
  holidays: [],
  public_app_url: '',
  updated_at: '',
};

export function StaffPage({
  sessionEmail,
  userRole,
  authLoading,
  roleError,
  onSignOut,
  onRefreshAuth,
}: StaffPageProps) {
  const todayStr = getBangkokNow().dateStr;
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [settings, setSettings] = useState<WarehouseSettings>(DEFAULT_SETTINGS);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [liveOccupants, setLiveOccupants] = useState<StaffBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Walk-in modal state
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkPlate, setWalkPlate] = useState('');
  const [walkDriver, setWalkDriver] = useState('');
  const [walkCompany, setWalkCompany] = useState('');
  const [walkJobType, setWalkJobType] = useState<JobType>('dropoff');
  const [walkHour, setWalkHour] = useState<number>(() => getBangkokNow().hour);
  const [walkNotes, setWalkNotes] = useState('');
  const [walkSubmitting, setWalkSubmitting] = useState(false);
  const [walkError, setWalkError] = useState('');

  const hasStaffAccess =
    Boolean(userRole?.is_active) && (userRole?.role === 'staff' || userRole?.role === 'admin');

  const fetchStaffData = useCallback(async () => {
    if (!hasStaffAccess) return;
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setSetupError('กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ใน Secrets');
      setLoading(false);
      return;
    }

    try {
      const [settingsRes, bookingsRes, liveRes] = await Promise.all([
        supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
        supabase
          .from('bookings')
          .select('*')
          .eq('booking_date', selectedDate)
          .eq('is_deleted', false)
          .order('slot_hour', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('bookings')
          .select('*')
          .eq('is_deleted', false)
          .in('status', ['called', 'loading']),
      ]);

      if (settingsRes.error || bookingsRes.error) {
        setSetupError('ไม่สามารถโหลดข้อมูลคิวได้ กรุณาตรวจสอบสิทธิ์หรือ SQL Schema');
        setLoading(false);
        return;
      }

      if (settingsRes.data) {
        setSettings(settingsRes.data as WarehouseSettings);
      }
      if (bookingsRes.data) {
        setBookings(bookingsRes.data as StaffBooking[]);
      }
      if (liveRes.data) {
        setLiveOccupants(liveRes.data as StaffBooking[]);
      }
      setSetupError(null);
    } catch {
      setActionError('ไม่สามารถโหลดข้อมูลล่าสุดได้');
    } finally {
      setLoading(false);
    }
  }, [hasStaffAccess, selectedDate]);

  useEffect(() => {
    if (!hasStaffAccess) return;
    setLoading(true);
    fetchStaffData();
    const timer = window.setInterval(fetchStaffData, 10000);
    return () => window.clearInterval(timer);
  }, [hasStaffAccess, fetchStaffData]);

  const handleStatusChange = async (bookingId: string, newStatus: BookingStatus) => {
    setActionError('');
    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setBusyId(bookingId);
    try {
      const { error } = await supabase.rpc('staff_update_status', {
        p_booking_id: bookingId,
        p_new_status: newStatus,
      });

      if (error) {
        setActionError(error.message || 'ไม่สามารถเปลี่ยนสถานะคิวได้');
        return;
      }

      await fetchStaffData();
    } catch {
      setActionError('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setBusyId(null);
    }
  };

  const openWalkInModal = () => {
    const nowHour = getBangkokNow().hour;
    const clampedHour = Math.max(settings.open_hour, Math.min(settings.close_hour - 1, nowHour));
    setWalkPlate('');
    setWalkDriver('');
    setWalkCompany('');
    setWalkJobType('dropoff');
    setWalkHour(clampedHour);
    setWalkNotes('');
    setWalkError('');
    setWalkInOpen(true);
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalkError('');

    const plate = walkPlate.trim();
    const driver = walkDriver.trim();
    if (!plate || !driver) {
      setWalkError('กรุณากรอกทะเบียนรถและชื่อคนขับ');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setWalkSubmitting(true);
    try {
      const { error } = await supabase.rpc('staff_create_walkin', {
        p_booking_date: selectedDate,
        p_slot_hour: walkHour,
        p_license_plate: plate,
        p_driver_name: driver,
        p_company: walkCompany.trim(),
        p_job_type: walkJobType,
        p_notes: walkNotes.trim(),
      });

      if (error) {
        setWalkError(error.message || 'ไม่สามารถเพิ่มคิวหน้างานได้');
        return;
      }

      setWalkInOpen(false);
      await fetchStaffData();
    } catch {
      setWalkError('เกิดข้อผิดพลาดในการเพิ่มคิวหน้างาน');
    } finally {
      setWalkSubmitting(false);
    }
  };

  const activeDocks = useMemo(() => getActiveDockNumbers(settings), [settings]);

  const slotHours = useMemo(() => {
    const list: number[] = [];
    for (let h = settings.open_hour; h < settings.close_hour; h++) {
      list.push(h);
    }
    return list;
  }, [settings.open_hour, settings.close_hour]);

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return bookings;
    return bookings.filter((b) => b.status === statusFilter);
  }, [bookings, statusFilter]);

  if (authLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="h-32 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </main>
    );
  }

  if (!sessionEmail) {
    return (
      <AuthLoginCard
        title="เข้าสู่ระบบเจ้าหน้าที่"
        subtitle="เฉพาะเจ้าหน้าที่โกดังและผู้ดูแลระบบเท่านั้น"
        externalError={roleError}
        onSuccess={onRefreshAuth}
      />
    );
  }

  if (!hasStaffAccess) {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h1 className="text-lg font-bold text-red-700 dark:text-red-400">
            บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            บัญชี <span className="font-medium">{sessionEmail}</span> ยังไม่ได้รับสิทธิ์ staff หรือถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-medium"
          >
            ออกจากระบบ
          </button>
        </div>
      </main>
    );
  }

  if (setupError) {
    return <SetupNotice message={setupError} />;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50">
            จัดการคิวหน้างาน (เจ้าหน้าที่)
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            เข้าสู่ระบบโดย {sessionEmail} · สิทธิ์: {userRole?.role === 'admin' ? 'แอดมิน' : 'เจ้าหน้าที่'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openWalkInModal}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มคิวหน้างาน</span>
          </button>
          <button
            type="button"
            onClick={fetchStaffData}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span>รีเฟรช</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </div>

      {/* Date Controls & Status Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedDate(todayStr)}
            className={`min-h-[40px] px-3.5 rounded-xl text-sm font-medium border ${
              selectedDate === todayStr
                ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            วันนี้
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(addDaysToDateStr(todayStr, 1))}
            className={`min-h-[40px] px-3.5 rounded-xl text-sm font-medium border ${
              selectedDate === addDaysToDateStr(todayStr, 1)
                ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            พรุ่งนี้
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            aria-label="เลือกวันที่"
          />
          <span className="text-sm text-slate-600 dark:text-slate-300 ml-1">
            {formatThaiDate(selectedDate, true)}
          </span>
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
          aria-label="กรองสถานะ"
        >
          <option value="all">ทุกสถานะ ({bookings.length})</option>
          {(Object.keys(STATUS_LABELS) as BookingStatus[]).map((st) => (
            <option key={st} value={st}>
              {STATUS_LABELS[st]} ({bookings.filter((b) => b.status === st).length})
            </option>
          ))}
        </select>
      </div>

      {/* Live Docks */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            สถานะโดคขณะนี้
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            เปิดใช้งาน {activeDocks.length} โดค
          </span>
        </div>
        <LiveDocksGrid settings={settings} occupants={liveOccupants} compact />
      </section>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-2"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError('')}
            className="text-xs font-semibold underline"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Queue List */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            ไม่มีรายการคิวในเงื่อนไขที่เลือก
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredBookings.map((b) => (
              <div
                key={b.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                      {formatSlotRange(b.slot_hour)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{JOB_TYPE_LABELS[b.job_type]}</span>
                    {b.is_walk_in && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          คิวหน้างาน
                        </span>
                      </>
                    )}
                    {b.dock_number && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {getDockName(settings, b.dock_number)}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-base font-bold font-mono-tabular text-slate-900 dark:text-white">
                      {b.license_plate}
                    </span>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {b.driver_name}
                    </span>
                    {b.company && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {b.company}
                      </span>
                    )}
                  </div>

                  {b.notes && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      หมายเหตุ: {b.notes}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className={`text-sm mr-2 ${STATUS_TEXT_CLASSES[b.status]}`}>
                    {STATUS_LABELS[b.status]}
                  </span>

                  {b.status === 'booked' && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleStatusChange(b.id, 'arrived')}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      มาถึงแล้ว
                    </button>
                  )}

                  {(b.status === 'booked' || b.status === 'arrived') && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleStatusChange(b.id, 'called')}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      เรียกคิว
                    </button>
                  )}

                  {b.status === 'called' && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleStatusChange(b.id, 'loading')}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      เริ่มขึ้น-ลงของ
                    </button>
                  )}

                  {(b.status === 'called' || b.status === 'loading') && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleStatusChange(b.id, 'completed')}
                      className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      เสร็จสิ้น
                    </button>
                  )}

                  {(b.status === 'booked' || b.status === 'arrived' || b.status === 'called') && (
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => handleStatusChange(b.id, 'no_show')}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium whitespace-nowrap disabled:opacity-50"
                    >
                      ไม่มา
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Walk-in Modal */}
      {walkInOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                เพิ่มคิวหน้างาน (Walk-in)
              </h2>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWalkIn} className="mt-4 space-y-3.5" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    ทะเบียนรถ *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={walkPlate}
                    onChange={(e) => setWalkPlate(e.target.value)}
                    placeholder="70-9999 กทม"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    ชื่อคนขับ *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={walkDriver}
                    onChange={(e) => setWalkDriver(e.target.value)}
                    placeholder="ชื่อคนขับ"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    บริษัท
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={walkCompany}
                    onChange={(e) => setWalkCompany(e.target.value)}
                    placeholder="ชื่อบริษัท (ถ้ามี)"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    ช่วงเวลา ({formatThaiDate(selectedDate, true)})
                  </label>
                  <select
                    value={walkHour}
                    onChange={(e) => setWalkHour(Number(e.target.value))}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-mono-tabular"
                  >
                    {slotHours.map((h) => {
                      const used = bookings.filter(
                        (b) => b.slot_hour === h && b.status !== 'cancelled' && b.status !== 'no_show'
                      ).length;
                      const rem = Math.max(0, activeDocks.length - used);
                      return (
                        <option key={h} value={h}>
                          {formatSlotRange(h)} (ว่าง {rem})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  ประเภทงาน
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  {(['dropoff', 'pickup'] as JobType[]).map((jt) => (
                    <button
                      key={jt}
                      type="button"
                      onClick={() => setWalkJobType(jt)}
                      className={`min-h-[40px] rounded-lg text-sm font-medium ${
                        walkJobType === jt
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {JOB_TYPE_LABELS[jt]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  หมายเหตุ
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={walkNotes}
                  onChange={(e) => setWalkNotes(e.target.value)}
                  placeholder="บันทึกเพิ่มเติม..."
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>

              {walkError && (
                <p className="text-sm text-red-600 dark:text-red-400">{walkError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={walkSubmitting}
                  className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {walkSubmitting ? 'กำลังบันทึก...' : 'บันทึกคิวหน้างาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
