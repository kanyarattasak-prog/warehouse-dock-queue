import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

interface SetPasswordPageProps {
  sessionEmail: string | null;
  onNavigate: (path: string) => void;
  onRefreshAuth: () => Promise<void>;
}

export function SetPasswordPage({
  sessionEmail,
  onNavigate,
  onRefreshAuth,
}: SetPasswordPageProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (password !== confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setSaving(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) {
        setError(updateErr.message || 'ไม่สามารถตั้งรหัสผ่านได้ ลิงก์อาจหมดอายุแล้ว');
        return;
      }

      setDone(true);
      await onRefreshAuth();
    } catch {
      setError('เกิดข้อผิดพลาดในการตั้งรหัสผ่าน');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-5 shadow-sm">
        <div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
            <KeyRound className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            ตั้งรหัสผ่านเข้าใช้งาน
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {sessionEmail
              ? `สำหรับบัญชี ${sessionEmail}`
              : 'กรุณาเปิดหน้านี้จากลิงก์คำเชิญหรือลิงก์รีเซ็ตรหัสผ่านในอีเมลของคุณ'}
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-800 dark:text-emerald-200">
              ตั้งรหัสผ่านเรียบร้อยแล้ว คุณสามารถเข้าใช้งานระบบได้ทันที
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('/staff')}
                className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                ไปหน้าเจ้าหน้าที่
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/admin')}
                className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                ไปหน้าแอดมิน
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                ยืนยันรหัสผ่านใหม่
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={saving || !sessionEmail}
              className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่าน'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
