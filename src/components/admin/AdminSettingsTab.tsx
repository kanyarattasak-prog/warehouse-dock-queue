import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase';
import { formatThaiDateFull } from '../../lib/time';
import { WarehouseSettings } from '../../types';

interface AdminSettingsTabProps {
  settings: WarehouseSettings;
  onRefresh: () => Promise<void>;
}

export function AdminSettingsTab({ settings, onRefresh }: AdminSettingsTabProps) {
  const [dockCount, setDockCount] = useState(settings.dock_count);
  const [dockNames, setDockNames] = useState<string[]>(settings.dock_names || []);
  const [closedDocks, setClosedDocks] = useState<number[]>(settings.closed_docks || []);
  const [openHour, setOpenHour] = useState(settings.open_hour);
  const [closeHour, setCloseHour] = useState(settings.close_hour);
  const [advanceDays, setAdvanceDays] = useState(settings.advance_days);
  const [notifyMinutes, setNotifyMinutes] = useState(settings.notify_minutes);
  const [holidays, setHolidays] = useState<string[]>(settings.holidays || []);
  const [publicAppUrl, setPublicAppUrl] = useState(settings.public_app_url || '');
  const [newHoliday, setNewHoliday] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setDockCount(settings.dock_count);
    setDockNames(settings.dock_names || []);
    setClosedDocks(settings.closed_docks || []);
    setOpenHour(settings.open_hour);
    setCloseHour(settings.close_hour);
    setAdvanceDays(settings.advance_days);
    setNotifyMinutes(settings.notify_minutes);
    setHolidays(settings.holidays || []);
    setPublicAppUrl(settings.public_app_url || '');
  }, [settings]);

  const handleDockCountChange = (val: number) => {
    const clamped = Math.max(1, Math.min(12, val));
    setDockCount(clamped);
    setDockNames((prev) => {
      const next = [...prev];
      while (next.length < clamped) {
        next.push(`โดค ${next.length + 1}`);
      }
      return next;
    });
    setClosedDocks((prev) => prev.filter((d) => d <= clamped));
  };

  const toggleClosedDock = (dockNum: number) => {
    setClosedDocks((prev) =>
      prev.includes(dockNum) ? prev.filter((d) => d !== dockNum) : [...prev, dockNum].sort((a, b) => a - b)
    );
  };

  const handleAddHoliday = () => {
    if (!newHoliday) return;
    if (!holidays.includes(newHoliday)) {
      setHolidays((prev) => [...prev, newHoliday].sort());
    }
    setNewHoliday('');
  };

  const handleRemoveHoliday = (d: string) => {
    setHolidays((prev) => prev.filter((h) => h !== d));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (closeHour <= openHour) {
      setError('เวลาปิดทำการต้องมากกว่าเวลาเปิดทำการ');
      return;
    }

    const normalizedNames: string[] = [];
    for (let i = 0; i < dockCount; i++) {
      const name = (dockNames[i] || '').trim();
      normalizedNames.push(name || `โดค ${i + 1}`);
    }

    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setSaving(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_update_settings', {
        p_dock_count: dockCount,
        p_dock_names: normalizedNames,
        p_closed_docks: closedDocks.filter((d) => d >= 1 && d <= dockCount),
        p_open_hour: openHour,
        p_close_hour: closeHour,
        p_advance_days: advanceDays,
        p_notify_minutes: notifyMinutes,
        p_holidays: holidays,
        p_public_app_url: publicAppUrl.trim(),
        p_reason: 'อัปเดตการตั้งค่าโกดังจากหน้าแอดมิน',
      });

      if (rpcError) {
        setError(rpcError.message || 'ไม่สามารถบันทึกการตั้งค่าได้');
        return;
      }

      setSuccess('บันทึกการตั้งค่าเรียบร้อยแล้ว (มีผลกับหน้าคนขับภายใน ~10 วินาที)');
      await onRefresh();
    } catch {
      setError('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      {/* Operating Hours & Rules */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          เวลาทำการและการจองล่วงหน้า
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              ชั่วโมงเปิดทำการ
            </label>
            <select
              value={openHour}
              onChange={(e) => setOpenHour(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            >
              {Array.from({ length: 23 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              ชั่วโมงปิดทำการ
            </label>
            <select
              value={closeHour}
              onChange={(e) => setCloseHour(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            >
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              จองล่วงหน้าได้ (วัน)
            </label>
            <input
              type="number"
              min={0}
              max={60}
              value={advanceDays}
              onChange={(e) => setAdvanceDays(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              แจ้งเตือนก่อนถึงคิว (นาที)
            </label>
            <input
              type="number"
              min={5}
              max={180}
              value={notifyMinutes}
              onChange={(e) => setNotifyMinutes(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>
      </section>

      {/* Dock Configuration */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              ตั้งค่าโดค (1–12 โดค)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              กำหนดจำนวนโดค ชื่อโดค และปิดโดคชั่วคราว (ความจุจองต่อชั่วโมงจะปรับตามโดคที่เปิดใช้งานทันที)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              จำนวนโดค:
            </label>
            <input
              type="number"
              min={1}
              max={12}
              value={dockCount}
              onChange={(e) => handleDockCountChange(Number(e.target.value))}
              className="w-20 min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: dockCount }, (_, idx) => {
            const dockNum = idx + 1;
            const isClosed = closedDocks.includes(dockNum);
            return (
              <div
                key={dockNum}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono-tabular font-semibold text-slate-500 dark:text-slate-400">
                    โดค #{dockNum}
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isClosed}
                      onChange={() => toggleClosedDock(dockNum)}
                      className="rounded border-slate-300"
                    />
                    <span>ปิดชั่วคราว</span>
                  </label>
                </div>
                <input
                  type="text"
                  maxLength={30}
                  value={dockNames[idx] ?? `โดค ${dockNum}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDockNames((prev) => {
                      const next = [...prev];
                      next[idx] = val;
                      return next;
                    });
                  }}
                  placeholder={`โดค ${dockNum}`}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Holidays */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            วันหยุดโกดัง
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            วันที่ระบุไว้จะไม่สามารถจองคิวใหม่ได้ทั้งฝั่งหน้าเว็บและ API
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
          <button
            type="button"
            onClick={handleAddHoliday}
            className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่มวันหยุด</span>
          </button>
        </div>

        {holidays.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">ยังไม่ได้กำหนดวันหยุด</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
            {holidays.map((h) => (
              <div key={h} className="px-3.5 py-2.5 flex items-center justify-between text-sm">
                <span>
                  <span className="font-mono-tabular mr-2">{h}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    ({formatThaiDateFull(h)})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveHoliday(h)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  aria-label={`ลบวันหยุด ${h}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Public App URL for QR */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
        <label className="block text-sm font-semibold text-slate-900 dark:text-white">
          URL หน้าแรกสำหรับป้าย QR Code (/qr)
        </label>
        <input
          type="url"
          value={publicAppUrl}
          onChange={(e) => setPublicAppUrl(e.target.value)}
          placeholder="https://your-published-domain.run.app"
          className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          หากเว้นว่าง ระบบจะใช้ URL ที่เผยแพร่จริง (Published URL) โดยอัตโนมัติ
        </p>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {success}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[48px] px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}</span>
        </button>
      </div>
    </form>
  );
}
