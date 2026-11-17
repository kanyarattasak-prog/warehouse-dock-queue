import React, { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from './lib/supabase';
import { getStoredTheme, setStoredTheme } from './lib/tokens';
import { UserRoleRecord } from './types';
import { TopNav } from './components/TopNav';
import { DriverPage } from './pages/DriverPage';
import { StaffPage } from './pages/StaffPage';
import { AdminPage } from './pages/AdminPage';
import { QrPage } from './pages/QrPage';
import { SetPasswordPage } from './pages/SetPasswordPage';

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout
const LAST_ACTIVITY_KEY = 'warehouse_admin_last_activity_v1';

function normalizePath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/staff' || clean === '/admin' || clean === '/qr' || clean === '/set-password') {
    return clean;
  }
  return '/';
}

export default function App() {
  const [path, setPath] = useState<string>(() => normalizePath(window.location.pathname));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getStoredTheme());

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRoleRecord | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [roleError, setRoleError] = useState('');
  const [idleNotice, setIdleNotice] = useState('');

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    setStoredTheme(theme);
  }, [theme]);

  const navigate = useCallback((nextPath: string) => {
    const normalized = normalizePath(nextPath);
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setPath(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Detect Supabase invite/recovery hash tokens
  useEffect(() => {
    const hash = window.location.hash || '';
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
      navigate('/set-password');
    }
  }, [navigate]);

  const loadSessionAndRole = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setSessionEmail(null);
      setSessionUserId(null);
      setUserRole(null);
      setAuthLoading(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (!user) {
        setSessionEmail(null);
        setSessionUserId(null);
        setUserRole(null);
        setRoleError('');
        setAuthLoading(false);
        return;
      }

      setSessionEmail(user.email || null);
      setSessionUserId(user.id);

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('user_id, email, role, is_active')
        .eq('user_id', user.id)
        .maybeSingle();

      if (roleData) {
        setUserRole(roleData as UserRoleRecord);
        setRoleError('');
      } else {
        setUserRole(null);
      }
    } catch {
      setUserRole(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    loadSessionAndRole();

    getSupabaseClient().then((supabase) => {
      if (!supabase) return;
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          navigate('/set-password');
        }
        loadSessionAndRole();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [loadSessionAndRole, navigate]);

  const handleSignOut = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      // ignore
    }
    setSessionEmail(null);
    setSessionUserId(null);
    setUserRole(null);
    setRoleError('');
  }, []);

  // Admin Session Idle Timeout (30 minutes of inactivity)
  useEffect(() => {
    if (!sessionUserId || userRole?.role !== 'admin') return;

    const now = Date.now();
    try {
      const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || '0');
      if (stored > 0 && now - stored > ADMIN_IDLE_TIMEOUT_MS) {
        setIdleNotice('เซสชันแอดมินหมดอายุเนื่องจากไม่มีการใช้งานนาน กรุณาเข้าสู่ระบบใหม่');
        handleSignOut();
        return;
      }
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // ignore
    }

    const updateActivity = () => {
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      } catch {
        // ignore
      }
      if (idleNotice) setIdleNotice('');
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    for (const ev of events) {
      window.addEventListener(ev, updateActivity, { passive: true });
    }

    const checker = window.setInterval(() => {
      try {
        const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || String(Date.now()));
        if (Date.now() - last > ADMIN_IDLE_TIMEOUT_MS) {
          setIdleNotice('เซสชันแอดมินหมดอายุเนื่องจากไม่มีการใช้งานนาน กรุณาเข้าสู่ระบบใหม่');
          handleSignOut();
        }
      } catch {
        // ignore
      }
    }, 30000);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, updateActivity);
      }
      window.clearInterval(checker);
    };
  }, [sessionUserId, userRole?.role, handleSignOut, idleNotice]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <TopNav
        currentPath={path}
        onNavigate={navigate}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      {path === '/' && <DriverPage />}
      {path === '/staff' && (
        <StaffPage
          sessionEmail={sessionEmail}
          userRole={userRole}
          authLoading={authLoading}
          roleError={roleError}
          onSignOut={handleSignOut}
          onRefreshAuth={loadSessionAndRole}
        />
      )}
      {path === '/admin' && (
        <AdminPage
          sessionEmail={sessionEmail}
          sessionUserId={sessionUserId}
          userRole={userRole}
          authLoading={authLoading}
          roleError={roleError}
          idleNotice={idleNotice}
          onSignOut={handleSignOut}
          onRefreshAuth={loadSessionAndRole}
          onNavigate={navigate}
        />
      )}
      {path === '/qr' && <QrPage userRole={userRole} />}
      {path === '/set-password' && (
        <SetPasswordPage
          sessionEmail={sessionEmail}
          onNavigate={navigate}
          onRefreshAuth={loadSessionAndRole}
        />
      )}
    </div>
  );
}
