import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarPlus,
  CheckCircle2,
  Clock,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import {
  addDaysToDateStr,
  formatSlotRange,
  formatThaiDate,
  formatThaiDateTime,
  getBangkokNow,
  isSlotPastGracePeriod,
  minutesUntilSlot,
} from '../lib/time';
import {
  getClientFingerprint,
  getSavedTokenMap,
  getSavedTokens,
  getTokenForBooking,
  saveBookingToken,
} from '../lib/tokens';
import {
  getActiveDockNumbers,
  getDockName,
  JOB_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_TEXT_CLASSES,
} from '../lib/status';
import { downloadBookingIcs } from '../lib/ics';
import { playAlertSound, showBrowserNotification } from '../lib/audio';
import { JobType, MyBooking, PublicBooking, WarehouseSettings } from '../types';
import { LiveDocksGrid, DockOccupant } from '../components/LiveDocksGrid';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SetupNotice } from '../components/SetupNotice';

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

export function DriverPage() {
  const [settings, setSettings] = useState<WarehouseSettings>(DEFAULT_SETTINGS);
  const [selectedDate, setSelectedDate] = useState<string>(() => getBangkokNow().dateStr);
  const [publicBookings, setPublicBookings] = useState<PublicBooking[]>([]);
  const [liveOccupants, setLiveOccupants] = useState<DockOccupant[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Form state
  const [licensePlate, setLicensePlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [company, setCompany] = useState('');
  const [jobType, setJobType] = useState<JobType>('dropoff');
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Action state
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<MyBooking | null>(null);

  // Notification permission & tracking
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const alertedCalledRef = useRef<Set<string>>(new Set());
  const alertedReminderRef = useRef<Set<string>>(new Set());

  const todayStr = getBangkokNow().dateStr;

  const dateOptions = useMemo(() => {
    const count = Math.max(0, Math.min(60, settings.advance_days ?? 7));
    const list: string[] = [];
    for (let i = 0; i <= count; i++) {
      list.push(addDaysToDateStr(todayStr, i));
    }
    return list;
  }, [todayStr, settings.advance_days]);

  // Keep selectedDate within allowed range if settings change
  useEffect(() => {
    if (dateOptions.length > 0 && !dateOptions.includes(selectedDate)) {
      setSelectedDate(dateOptions[0]);
    }
  }, [dateOptions, selectedDate]);

  const fetchAllData = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setSetupError('กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ใน Secrets');
      setLoading(false);
      return;
    }

    try {
      const tokens = getSavedTokens();

      const [settingsRes, queueRes, liveDockRes, myRes] = await Promise.all([
        supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
        supabase
          .from('public_bookings_view')
          .select('*')
          .eq('booking_date', selectedDate)
          .order('slot_hour', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('public_bookings_view')
          .select('id, dock_number, license_plate, status, job_type, company')
          .in('status', ['called', 'loading']),
        tokens.length > 0
          ? supabase.rpc('get_my_bookings', { p_tokens: tokens })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (settingsRes.error) {
        setSetupError(
          'ไม่พบตารางข้อมูลใน Supabase กรุณานำไฟล์ supabase_schema.sql ไปรันใน SQL Editor ก่อนใช้งาน'
        );
        setLoading(false);
        return;
      }

      if (settingsRes.data) {
        const raw = settingsRes.data as WarehouseSettings;
        setSettings({
          ...DEFAULT_SETTINGS,
          ...raw,
          dock_names: Array.isArray(raw.dock_names) ? raw.dock_names : DEFAULT_SETTINGS.dock_names,
          closed_docks: Array.isArray(raw.closed_docks) ? raw.closed_docks : [],
          holidays: Array.isArray(raw.holidays) ? raw.holidays : [],
        });
      }

      if (!queueRes.error && queueRes.data) {
        setPublicBookings(queueRes.data as PublicBooking[]);
      }
      if (!liveDockRes.error && liveDockRes.data) {
        setLiveOccupants(liveDockRes.data as DockOccupant[]);
      }
      if (!myRes.error && Array.isArray(myRes.data)) {
        setMyBookings(myRes.data as MyBooking[]);
      }

      setSetupError(null);
      setLastUpdated(new Date().toISOString());
    } catch {
      setSetupError('ไม่สามารถเชื่อมต่อกับฐานข้อมูลได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    fetchAllData();
    const timer = window.setInterval(() => {
      fetchAllData();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [fetchAllData]);

  // Monitor alerts for myBookings (called-to-dock & pre-queue reminder)
  const calledMyQueues = useMemo(
    () => myBookings.filter((b) => b.status === 'called' && b.booking_date === todayStr),
    [myBookings, todayStr]
  );

  const reminderMyQueues = useMemo(() => {
    const notifyMin = settings.notify_minutes || 30;
    return myBookings.filter((b) => {
      if (b.booking_date !== todayStr) return false;
      if (b.status !== 'booked' && b.status !== 'arrived') return false;
      const minsLeft = minutesUntilSlot(b.booking_date, b.slot_hour);
      return minsLeft <= notifyMin && minsLeft >= -30;
    });
  }, [myBookings, todayStr, settings.notify_minutes]);

  useEffect(() => {
    for (const q of calledMyQueues) {
      if (!alertedCalledRef.current.has(q.id)) {
        alertedCalledRef.current.add(q.id);
        playAlertSound('called');
        const dockLabel = q.dock_number ? getDockName(settings, q.dock_number) : 'โดค';
        showBrowserNotification(
          `ถึงคิวแล้ว! เข้า ${dockLabel}`,
          `รถทะเบียน ${q.license_plate} กรุณานำรถเข้า ${dockLabel} ได้เลย`
        );
      }
    }
  }, [calledMyQueues, settings]);

  useEffect(() => {
    for (const q of reminderMyQueues) {
      if (!alertedReminderRef.current.has(q.id)) {
        alertedReminderRef.current.add(q.id);
        playAlertSound('reminder');
        const mins = minutesUntilSlot(q.booking_date, q.slot_hour);
        const text =
          mins > 0
            ? `เหลือเวลาอีก ${mins} นาทีก่อนถึงเวลานัด (${formatSlotRange(q.slot_hour)})`
            : `ถึงเวลานัดของคุณแล้ว (${formatSlotRange(q.slot_hour)})`;
        showBrowserNotification(`แจ้งเตือนคิวรถ ${q.license_plate}`, text);
      }
    }
  }, [reminderMyQueues]);

  const activeDockCount = useMemo(
    () => getActiveDockNumbers(settings).length,
    [settings]
  );

  const isSelectedHoliday = useMemo(
    () => (settings.holidays || []).includes(selectedDate),
    [settings.holidays, selectedDate]
  );

  // Slot capacities for selected date
  const slotList = useMemo(() => {
    const slots: Array<{
      hour: number;
      used: number;
      remaining: number;
      isPast: boolean;
      isFull: boolean;
      disabled: boolean;
    }> = [];

    for (let h = settings.open_hour; h < settings.close_hour; h++) {
      const used = publicBookings.filter(
        (b) => b.slot_hour === h && b.status !== 'cancelled' && b.status !== 'no_show'
      ).length;
      const remaining = Math.max(0, activeDockCount - used);
      const isPast = isSlotPastGracePeriod(selectedDate, h, 30);
      const isFull = remaining === 0;
      const disabled = isSelectedHoliday || isPast || isFull || activeDockCount === 0;
      slots.push({ hour: h, used, remaining, isPast, isFull, disabled });
    }
    return slots;
  }, [settings.open_hour, settings.close_hour, publicBookings, activeDockCount, selectedDate, isSelectedHoliday]);

  // Clear selectedHour if it becomes disabled
  useEffect(() => {
    if (selectedHour !== null) {
      const found = slotList.find((s) => s.hour === selectedHour);
      if (!found || found.disabled) {
        setSelectedHour(null);
      }
    }
  }, [slotList, selectedHour]);

  const myBookingById = useMemo(() => {
    const map = new Map<string, MyBooking>();
    for (const b of myBookings) {
      map.set(b.id, b);
    }
    return map;
  }, [myBookings]);

  const savedTokenMap = getSavedTokenMap();

  // Compute "มีคิวก่อนหน้า N คัน" for active queues on selectedDate
  const aheadCountById = useMemo(() => {
    const map = new Map<string, number>();
    let activeBefore = 0;
    for (const b of publicBookings) {
      if (b.status === 'booked' || b.status === 'arrived') {
        map.set(b.id, activeBefore);
        activeBefore++;
      }
    }
    return map;
  }, [publicBookings]);

  const handleRequestNotification = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch {
      // ignore
    }
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    const plate = licensePlate.trim();
    const driver = driverName.trim();
    const comp = company.trim();

    if (!plate) {
      setFormError('กรุณากรอกทะเบียนรถ');
      return;
    }
    if (plate.length > 20) {
      setFormError('ทะเบียนรถต้องไม่เกิน 20 ตัวอักษร');
      return;
    }
    if (!driver) {
      setFormError('กรุณากรอกชื่อคนขับ');
      return;
    }
    if (driver.length > 60) {
      setFormError('ชื่อคนขับต้องไม่เกิน 60 ตัวอักษร');
      return;
    }
    if (comp.length > 80) {
      setFormError('ชื่อบริษัทต้องไม่เกิน 80 ตัวอักษร');
      return;
    }
    if (isSelectedHoliday) {
      setFormError('วันที่เลือกเป็นวันหยุดโกดัง กรุณาเลือกวันอื่น');
      return;
    }
    if (selectedHour === null) {
      setFormError('กรุณาเลือกช่วงเวลาที่ต้องการจอง');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      setFormError('ระบบยังไม่ได้เชื่อมต่อฐานข้อมูล');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_booking', {
        p_booking_date: selectedDate,
        p_slot_hour: selectedHour,
        p_license_plate: plate,
        p_driver_name: driver,
        p_company: comp,
        p_job_type: jobType,
        p_client_key: getClientFingerprint(),
      });

      if (error) {
        setFormError(error.message || 'ไม่สามารถจองคิวได้ กรุณาลองใหม่');
        await fetchAllData();
        return;
      }

      const createdRow = Array.isArray(data) ? data[0] : data;
      if (createdRow?.id && createdRow?.secret_token) {
        saveBookingToken(createdRow.id, createdRow.secret_token);
      }

      setLicensePlate('');
      setDriverName('');
      setCompany('');
      setSelectedHour(null);
      setFormSuccess(
        `จองคิวสำเร็จ ทะเบียน ${createdRow?.license_plate || plate} เวลา ${formatSlotRange(
          createdRow?.slot_hour ?? selectedHour
        )}`
      );
      await fetchAllData();
    } catch {
      setFormError('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDriverAction = async (booking: MyBooking, action: 'arrived' | 'cancelled') => {
    setActionError('');
    const token = getTokenForBooking(booking.id) || booking.secret_token;
    if (!token) {
      setActionError('ไม่พบรหัสคิวของเครื่องนี้');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setActionBusyId(booking.id);
    try {
      const { error } = await supabase.rpc('driver_update_booking', {
        p_booking_id: booking.id,
        p_token: token,
        p_action: action,
      });

      if (error) {
        setActionError(error.message || 'ไม่สามารถดำเนินการได้');
        return;
      }

      setCancelTarget(null);
      await fetchAllData();
    } catch {
      setActionError('เกิดข้อผิดพลาดในการอัปเดตสถานะ');
    } finally {
      setActionBusyId(null);
    }
  };

  if (setupError) {
    return <SetupNotice message={setupError} />;
  }

  const activeMyBookingsTodayOrFuture = myBookings.filter(
    (b) => b.booking_date >= todayStr && b.status !== 'cancelled' && b.status !== 'completed' && b.status !== 'no_show'
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
      {/* Urgent Called-to-Dock Red Banners */}
      {calledMyQueues.map((q) => (
        <div
          key={`call-${q.id}`}
          role="alert"
          className="rounded-2xl border border-red-400 dark:border-red-700 bg-red-600 text-white p-4 sm:p-5 shadow-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <Truck className="w-6 h-6 shrink-0 mt-0.5" />
            <div>
              <p className="text-base sm:text-lg font-bold">
                ถึงคิวแล้ว เข้า{q.dock_number ? getDockName(settings, q.dock_number) : 'โดค'}
              </p>
              <p className="text-sm text-red-50 mt-0.5">
                ทะเบียน <span className="font-mono-tabular font-semibold">{q.license_plate}</span> ·{' '}
                {q.driver_name} · เวลา {formatSlotRange(q.slot_hour)}
              </p>
            </div>
          </div>
          <span className="text-xs font-medium bg-white/15 px-3 py-1.5 rounded-lg self-start sm:self-center whitespace-nowrap">
            กรุณานำรถเข้าเทียบโดคทันที
          </span>
        </div>
      ))}

      {/* Pre-Queue Amber/Yellow Reminder Banners */}
      {reminderMyQueues.map((q) => {
        const minsLeft = minutesUntilSlot(q.booking_date, q.slot_hour);
        return (
          <div
            key={`rem-${q.id}`}
            role="status"
            className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/70 text-amber-950 dark:text-amber-100 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm sm:text-base font-semibold">
                  {minsLeft > 0
                    ? `ใกล้ถึงคิวของคุณในอีก ${minsLeft} นาที`
                    : 'ถึงเวลานัดของคุณแล้ว'}
                </p>
                <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 mt-0.5">
                  ทะเบียน <span className="font-mono-tabular font-semibold">{q.license_plate}</span> ·{' '}
                  {formatSlotRange(q.slot_hour)} · สถานะ: {STATUS_LABELS[q.status]}
                </p>
              </div>
            </div>
            {q.status === 'booked' && (
              <button
                type="button"
                onClick={() => handleDriverAction(q, 'arrived')}
                disabled={actionBusyId === q.id}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium whitespace-nowrap transition-colors"
              >
                ฉันมาถึงแล้ว
              </button>
            )}
          </div>
        );
      })}

      {/* Page Title & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
            จองคิวรถหน้าโกดัง
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5 tabular-nums">
            เวลาประเทศไทย (Asia/Bangkok) · เปิดทำการ {String(settings.open_hour).padStart(2, '0')}:00 -{' '}
            {String(settings.close_hour).padStart(2, '0')}:00 น.
            {lastUpdated ? ` · อัปเดต ${formatThaiDateTime(lastUpdated)}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {notifPermission === 'default' && (
            <button
              type="button"
              onClick={handleRequestNotification}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Bell className="w-4 h-4" />
              <span>เปิดแจ้งเตือน</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchAllData()}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span>รีเฟรช</span>
          </button>
        </div>
      </div>

      {/* Horizontal Date Selector */}
      <section aria-label="เลือกวันที่จอง">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {dateOptions.map((d) => {
            const isActive = d === selectedDate;
            const isHol = (settings.holidays || []).includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 border transition-colors ${
                  isActive
                    ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                    : isHol
                      ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-100'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {formatThaiDate(d, true)}
                {isHol ? ' (วันหยุด)' : ''}
              </button>
            );
          })}
        </div>
      </section>

      {/* Live Dock Status Section */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            สถานะโดคหน้าโกดังขณะนี้
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            เปิดใช้งาน {activeDockCount} จาก {settings.dock_count} โดค
          </span>
        </div>
        <LiveDocksGrid settings={settings} occupants={liveOccupants} />
      </section>

      {/* Active Bookings Owned By This Device (Quick Access Cards) */}
      {activeMyBookingsTodayOrFuture.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            คิวของคุณในเครื่องนี้
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeMyBookingsTodayOrFuture.map((q) => (
              <div
                key={`my-${q.id}`}
                className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/25 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                      <span>คิวของคุณ</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatThaiDate(q.booking_date, true)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatSlotRange(q.slot_hour)}</span>
                    </div>
                    <p className="mt-1 text-lg font-bold font-mono-tabular text-slate-900 dark:text-white">
                      {q.license_plate}
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {q.driver_name}
                      {q.company ? ` · ${q.company}` : ''} · {JOB_TYPE_LABELS[q.job_type]}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-semibold ${STATUS_TEXT_CLASSES[q.status]}`}>
                      {STATUS_LABELS[q.status]}
                    </span>
                    {q.dock_number && (q.status === 'called' || q.status === 'loading') && (
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400 mt-0.5">
                        {getDockName(settings, q.dock_number)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {q.status === 'booked' && (
                    <button
                      type="button"
                      onClick={() => handleDriverAction(q, 'arrived')}
                      disabled={actionBusyId === q.id}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {actionBusyId === q.id ? 'กำลังบันทึก...' : 'ฉันมาถึงแล้ว'}
                    </button>
                  )}

                  {(q.status === 'booked' || q.status === 'arrived') && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(q)}
                      disabled={actionBusyId === q.id}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      ยกเลิกคิว
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => downloadBookingIcs(q, settings.notify_minutes)}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    <span>เพิ่มลงปฏิทิน</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          {actionError && (
            <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
          )}
        </section>
      )}

      {/* Main 2-Column Responsive Layout: Left Booking Form, Right Queue List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Booking Form */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              ฟอร์มจองคิวใหม่
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              สำหรับวันที่ {formatThaiDate(selectedDate, true)}
            </p>
          </div>

          {isSelectedHoliday ? (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-200">
              วันที่เลือกเป็นวันหยุดโกดัง ไม่เปิดรับจองคิว กรุณาเลือกวันอื่นด้านบน
            </div>
          ) : (
            <form onSubmit={handleSubmitBooking} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="driver-plate"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  ทะเบียนรถ <span className="text-red-600">*</span>
                </label>
                <input
                  id="driver-plate"
                  type="text"
                  required
                  maxLength={20}
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value)}
                  placeholder="เช่น 70-1234 กทม"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-base sm:text-sm font-mono-tabular text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="driver-name"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  ชื่อคนขับ <span className="text-red-600">*</span>
                </label>
                <input
                  id="driver-name"
                  type="text"
                  required
                  maxLength={60}
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="driver-company"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  บริษัท / ขนส่ง (ไม่บังคับ)
                </label>
                <input
                  id="driver-company"
                  type="text"
                  maxLength={80}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="เช่น บจก. ขนส่งไทย"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  ประเภทงาน
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  {(['dropoff', 'pickup'] as JobType[]).map((jt) => (
                    <button
                      key={jt}
                      type="button"
                      onClick={() => setJobType(jt)}
                      className={`min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                        jobType === jt
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {JOB_TYPE_LABELS[jt]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  เลือกช่วงเวลา <span className="text-red-600">*</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {slotList.map((slot) => {
                    const isSelected = selectedHour === slot.hour;
                    return (
                      <button
                        key={slot.hour}
                        type="button"
                        disabled={slot.disabled}
                        onClick={() => setSelectedHour(slot.hour)}
                        className={`min-h-[54px] px-2.5 py-2 rounded-xl border text-left transition-colors flex flex-col justify-center ${
                          slot.disabled
                            ? 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                            : isSelected
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:border-blue-500'
                        }`}
                      >
                        <span className="text-xs font-mono-tabular font-semibold whitespace-nowrap">
                          {formatSlotRange(slot.hour)}
                        </span>
                        <span
                          className={`text-xs mt-0.5 tabular-nums ${
                            slot.disabled
                              ? 'text-slate-400 dark:text-slate-500'
                              : isSelected
                                ? 'text-blue-100'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {slot.isPast
                            ? 'ผ่านแล้ว'
                            : slot.isFull
                              ? 'เต็ม'
                              : `ว่าง ${slot.remaining}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 flex items-start gap-2"
                >
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || activeDockCount === 0}
                className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-semibold text-sm transition-all disabled:opacity-50"
              >
                {submitting ? 'กำลังบันทึกการจอง...' : 'ยืนยันจองคิว'}
              </button>
            </form>
          )}
        </section>

        {/* Queue List for Selected Date */}
        <section className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                รายการคิววันที่ {formatThaiDate(selectedDate, true)}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                ทั้งหมด {publicBookings.length} คิว · เรียงตามเวลานัดและเวลาที่กดจอง
              </p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : publicBookings.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                ยังไม่มีคิวจองในวันที่เลือก
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                สามารถกรอกฟอร์มจองคิวด้านข้างเพื่อจองช่วงเวลาที่ว่างได้ทันที
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {publicBookings.map((item, idx) => {
                const isMine = Boolean(savedTokenMap[item.id] || myBookingById.has(item.id));
                const mineFull = myBookingById.get(item.id);
                const displayDriver = isMine && mineFull ? mineFull.driver_name : item.masked_driver_name;
                const aheadCount = aheadCountById.get(item.id);

                return (
                  <div
                    key={item.id}
                    className={`py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isMine ? 'bg-blue-50/40 dark:bg-blue-950/20 -mx-2 px-2 rounded-xl' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                          #{idx + 1}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular font-medium text-slate-700 dark:text-slate-300">
                          {formatSlotRange(item.slot_hour)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{JOB_TYPE_LABELS[item.job_type]}</span>
                        {item.is_walk_in && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>คิวหน้างาน</span>
                          </>
                        )}
                        {isMine && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              คิวของคุณ
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span className="text-base font-bold font-mono-tabular text-slate-900 dark:text-white">
                          {item.license_plate}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-200">
                          {displayDriver}
                        </span>
                        {item.company && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            ({item.company})
                          </span>
                        )}
                      </div>

                      {aheadCount !== undefined && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {aheadCount === 0
                            ? 'ไม่มีคิวก่อนหน้า (คิวถัดไป)'
                            : `มีคิวก่อนหน้า ${aheadCount} คัน`}
                        </p>
                      )}
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                      <div className="text-left sm:text-right">
                        <span className={`text-sm font-medium ${STATUS_TEXT_CLASSES[item.status]}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                        {item.dock_number && (item.status === 'called' || item.status === 'loading') && (
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                            {getDockName(settings, item.dock_number)}
                          </p>
                        )}
                      </div>

                      {isMine && mineFull && (
                        <div className="flex items-center gap-2">
                          {mineFull.status === 'booked' && (
                            <button
                              type="button"
                              onClick={() => handleDriverAction(mineFull, 'arrived')}
                              disabled={actionBusyId === mineFull.id}
                              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                            >
                              ฉันมาถึงแล้ว
                            </button>
                          )}
                          {(mineFull.status === 'booked' || mineFull.status === 'arrived') && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(mineFull)}
                              disabled={actionBusyId === mineFull.id}
                              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium whitespace-nowrap"
                            >
                              ยกเลิกคิว
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="ยืนยันการยกเลิกคิว"
        description={
          cancelTarget
            ? `ต้องการยกเลิกคิวรถทะเบียน ${cancelTarget.license_plate} เวลา ${formatSlotRange(
                cancelTarget.slot_hour
              )} ใช่หรือไม่?`
            : ''
        }
        confirmLabel="ยืนยันยกเลิกคิว"
        cancelLabel="เก็บคิวไว้"
        danger
        loading={Boolean(cancelTarget && actionBusyId === cancelTarget.id)}
        onConfirm={() => {
          if (cancelTarget) {
            handleDriverAction(cancelTarget, 'cancelled');
          }
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </main>
  );
}
