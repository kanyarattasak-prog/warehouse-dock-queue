import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { BookingEvent, StaffBooking, UserRoleRecord, WarehouseSettings } from '../types';
import { AuthLoginCard } from '../components/AuthLoginCard';
import { SetupNotice } from '../components/SetupNotice';
import { AdminDashboardTab } from '../components/admin/AdminDashboardTab';
import { AdminBookingsTab } from '../components/admin/AdminBookingsTab';
import { AdminUsersTab } from '../components/admin/AdminUsersTab';
import { AdminSettingsTab } from '../components/admin/AdminSettingsTab';
import { AdminAuditTab } from '../components/admin/AdminAuditTab';
import { AdminReportsTab } from '../components/admin/AdminReportsTab';

interface AdminPageProps {
  sessionEmail: string | null;
  sessionUserId: string | null;
  userRole: UserRoleRecord | null;
  authLoading: boolean;
  roleError: string;
  idleNotice: string;
  onSignOut: () => Promise<void>;
  onRefreshAuth: () => Promise<void>;
  onNavigate: (path: string) => void;
}

type AdminTab = 'dashboard' | 'bookings' | 'users' | 'settings' | 'audit' | 'reports';

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'dashboard', label: 'แดชบอร์ด' },
  { id: 'bookings', label: 'รายการจอง' },
  { id: 'users', label: 'ผู้ใช้และสิทธิ์' },
  { id: 'settings', label: 'ตั้งค่า' },
  { id: 'audit', label: 'ประวัติ (Audit Log)' },
  { id: 'reports', label: 'รายงาน' },
];

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

export function AdminPage({
  sessionEmail,
  sessionUserId,
  userRole,
  authLoading,
  roleError,
  idleNotice,
  onSignOut,
  onRefreshAuth,
  onNavigate,
}: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [settings, setSettings] = useState<WarehouseSettings>(DEFAULT_SETTINGS);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  const isAdmin = Boolean(userRole?.is_active) && userRole?.role === 'admin';

  const fetchAdminData = useCallback(async () => {
    if (!isAdmin) return;
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setSetupError('กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ใน Secrets');
      setLoading(false);
      return;
    }

    try {
      const [settingsRes, bookingsRes, eventsRes] = await Promise.all([
        supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
        supabase
          .from('bookings')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase
          .from('booking_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(2000),
      ]);

      if (settingsRes.error || bookingsRes.error || eventsRes.error) {
        setSetupError('ไม่สามารถโหลดข้อมูลหลังบ้านได้ กรุณาตรวจสอบ SQL Schema และสิทธิ์ Admin');
        setLoading(false);
        return;
      }

      if (settingsRes.data) {
        setSettings(settingsRes.data as WarehouseSettings);
      }
      if (bookingsRes.data) {
        setBookings(bookingsRes.data as StaffBooking[]);
      }
      if (eventsRes.data) {
        setEvents(eventsRes.data as BookingEvent[]);
      }
      setSetupError(null);
    } catch {
      setSetupError('เกิดข้อผิดพลาดในการโหลดข้อมูลแอดมิน');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    fetchAdminData();
    const timer = window.setInterval(fetchAdminData, 15000);
    return () => window.clearInterval(timer);
  }, [isAdmin, fetchAdminData]);

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
        title="เข้าสู่ระบบผู้ดูแลระบบ (Admin)"
        subtitle="สำหรับผู้ดูแลระบบโกดังเท่านั้น"
        externalError={idleNotice || roleError}
        onSuccess={onRefreshAuth}
      />
    );
  }

  if (!isAdmin) {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h1 className="text-lg font-bold text-red-700 dark:text-red-400">
            ไม่มีสิทธิ์เข้าถึงหน้าแอดมิน
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            บัญชี <span className="font-medium">{sessionEmail}</span> ไม่มีสิทธิ์ผู้ดูแลระบบ (Admin)
            {!userRole && (
              <span className="block mt-2 text-xs text-amber-700 dark:text-amber-400">
                ยังไม่มีข้อมูลสิทธิ์ของบัญชีนี้ในตาราง user_roles หากเป็นแอดมินคนแรก กรุณารันคำสั่งกำหนด role &apos;admin&apos; ใน Supabase SQL Editor
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {userRole?.role === 'staff' && userRole.is_active && (
              <button
                type="button"
                onClick={() => onNavigate('/staff')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium"
              >
                ไปหน้าเจ้าหน้าที่
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (setupError) {
    return <SetupNotice message={setupError} />;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
      {/* Admin Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            ระบบหลังบ้านแอดมิน
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            ผู้ดูแลระบบ: {sessionEmail}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchAdminData}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span>รีเฟรช</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-medium text-red-700 dark:text-red-400 inline-flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800 no-print">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`min-h-[42px] px-4 rounded-t-xl text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-900 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="space-y-3 py-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <AdminDashboardTab settings={settings} bookings={bookings} events={events} />
          )}
          {activeTab === 'bookings' && (
            <AdminBookingsTab
              settings={settings}
              bookings={bookings}
              events={events}
              onRefresh={fetchAdminData}
            />
          )}
          {activeTab === 'users' && (
            <AdminUsersTab currentUserId={sessionUserId} onRefreshAudit={fetchAdminData} />
          )}
          {activeTab === 'settings' && (
            <AdminSettingsTab settings={settings} onRefresh={fetchAdminData} />
          )}
          {activeTab === 'audit' && <AdminAuditTab events={events} />}
          {activeTab === 'reports' && <AdminReportsTab bookings={bookings} />}
        </>
      )}
    </main>
  );
}
