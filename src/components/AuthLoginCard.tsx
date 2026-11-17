import React, { useState } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

interface AuthLoginCardProps {
  title: string;
  subtitle: string;
  externalError?: string;
  onSuccess?: () => void;
}

export function AuthLoginCard({ title, subtitle, externalError = '', onSuccess }: AuthLoginCardProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      setError('ระบบยังไม่ได้เชื่อมต่อ Supabase');
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) {
        // Never reveal whether email exists in database
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        return;
      }

      if (onSuccess) onSuccess();
    } catch {
      setError('ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = externalError || error;

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-1.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">{title}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
            >
              อีเมล
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5"
            >
              รหัสผ่าน
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {displayError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300"
            >
              {displayError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <LogIn className="w-4 h-4" />
            <span>{submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</span>
          </button>
        </form>
      </div>
    </main>
  );
}
