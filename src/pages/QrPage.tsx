import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, Save } from 'lucide-react';
import { getPublicConfig, getSupabaseClient } from '../lib/supabase';
import { UserRoleRecord, WarehouseSettings } from '../types';

interface QrPageProps {
  userRole: UserRoleRecord | null;
}

const FALLBACK_PUBLISHED_URL =
  'https://ais-pre-w4bod3gngahnrl2r3m72ru-880892154293.asia-northeast1.run.app';

export function QrPage({ userRole }: QrPageProps) {
  const [settings, setSettings] = useState<WarehouseSettings | null>(null);
  const [targetUrl, setTargetUrl] = useState<string>(FALLBACK_PUBLISHED_URL);
  const [editUrl, setEditUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  const isAdmin = Boolean(userRole?.is_active) && userRole?.role === 'admin';

  const loadTargetUrl = useCallback(async () => {
    const [cfg, supabase] = await Promise.all([getPublicConfig(), getSupabaseClient()]);
    let defaultPublished = cfg.publishedAppUrl;

    if (!defaultPublished && typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (origin.includes('ais-dev-')) {
        defaultPublished = origin.replace('https://ais-dev-', 'https://ais-pre-');
      } else if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        defaultPublished = origin;
      } else {
        defaultPublished = FALLBACK_PUBLISHED_URL;
      }
    }

    if (supabase) {
      const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
      if (data) {
        const s = data as WarehouseSettings;
        setSettings(s);
        const finalUrl = (s.public_app_url || '').trim() || defaultPublished || FALLBACK_PUBLISHED_URL;
        setTargetUrl(finalUrl);
        setEditUrl(finalUrl);
        return;
      }
    }

    const fallback = defaultPublished || FALLBACK_PUBLISHED_URL;
    setTargetUrl(fallback);
    setEditUrl(fallback);
  }, []);

  useEffect(() => {
    loadTargetUrl();
  }, [loadTargetUrl]);

  useEffect(() => {
    if (!targetUrl) return;
    QRCode.toDataURL(targetUrl, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [targetUrl]);

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg('');
    setSaveError('');

    const clean = editUrl.trim().replace(/\/$/, '');
    if (!clean || !/^https?:\/\//i.test(clean)) {
      setSaveError('กรุณากรอก URL ที่ขึ้นต้นด้วย http:// หรือ https://');
      return;
    }

    const supabase = await getSupabaseClient();
    if (!supabase || !settings) return;

    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_update_settings', {
        p_dock_count: settings.dock_count,
        p_dock_names: settings.dock_names,
        p_closed_docks: settings.closed_docks,
        p_open_hour: settings.open_hour,
        p_close_hour: settings.close_hour,
        p_advance_days: settings.advance_days,
        p_notify_minutes: settings.notify_minutes,
        p_holidays: settings.holidays,
        p_public_app_url: clean,
        p_reason: 'อัปเดต URL สำหรับป้าย QR Code',
      });

      if (error) {
        setSaveError(error.message || 'ไม่สามารถบันทึก URL ได้');
        return;
      }

      setTargetUrl(clean);
      setSaveMsg('บันทึก URL สำหรับ QR Code เรียบร้อยแล้ว');
      await loadTargetUrl();
    } catch {
      setSaveError('เกิดข้อผิดพลาดในการบันทึก URL');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPng = async () => {
    if (!targetUrl) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // White poster background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle frame
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 6;
      ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

      // Title
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 64px "IBM Plex Sans Thai", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('สแกนเพื่อจองคิวรถ', canvas.width / 2, 165);

      ctx.fillStyle = '#475569';
      ctx.font = '500 32px "IBM Plex Sans Thai", sans-serif';
      ctx.fillText('ระบบจองคิวรถหน้าโกดัง', canvas.width / 2, 225);

      // High-res QR
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, targetUrl, {
        width: 880,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      ctx.drawImage(qrCanvas, (canvas.width - 880) / 2, 280, 880, 880);

      // URL footer text (auto-fit single line if reasonably long)
      ctx.fillStyle = '#1e293b';
      let fontSize = 26;
      ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
      const maxTextWidth = canvas.width - 140;
      while (ctx.measureText(targetUrl).width > maxTextWidth && fontSize > 16) {
        fontSize -= 1;
        ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
      }
      if (ctx.measureText(targetUrl).width <= maxTextWidth) {
        ctx.fillText(targetUrl, canvas.width / 2, 1270);
      } else {
        const half = Math.ceil(targetUrl.length / 2);
        ctx.fillText(targetUrl.slice(0, half), canvas.width / 2, 1255);
        ctx.fillText(targetUrl.slice(half), canvas.width / 2, 1292);
      }

      ctx.fillStyle = '#64748b';
      ctx.font = '400 26px "IBM Plex Sans Thai", sans-serif';
      ctx.fillText('ไม่ต้องติดตั้งแอป · ใช้งานได้ทันทีผ่านมือถือ', canvas.width / 2, 1370);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = 'warehouse-queue-qr.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // Fallback to direct QR image if canvas fails
    }
  };

  const requiresGoogleLoginUrl =
    targetUrl.includes('ai.studio/') || targetUrl.includes('ais-dev-');

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Action Bar (hidden on print) */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            ป้าย QR Code หน้าโกดัง
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            สำหรับพิมพ์ติดจุดรับรถหน้าโกดังเพื่อให้คนขับสแกนจองคิว
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPng}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>ดาวน์โหลด PNG</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์ป้าย</span>
          </button>
        </div>
      </div>

      {/* Printable Poster Card */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white text-slate-900 p-8 sm:p-12 text-center shadow-sm print:shadow-none print:border-slate-300">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          สแกนเพื่อจองคิวรถ
        </h2>
        <p className="mt-2 text-base text-slate-600">
          ระบบจองคิวรถหน้าโกดัง · ใช้ได้ทันทีไม่ต้องโหลดแอป
        </p>

        <div className="my-8 flex justify-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR Code สำหรับจองคิวรถหน้าโกดัง"
              className="w-72 h-72 sm:w-88 sm:h-88 border border-slate-200 rounded-2xl p-3 bg-white"
            />
          ) : (
            <div className="w-72 h-72 rounded-2xl bg-slate-100 animate-pulse" />
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-slate-500">ลิงก์หน้าจองคิว</p>
          <p className="text-sm sm:text-base font-mono-tabular font-semibold text-slate-900 break-all">
            {targetUrl}
          </p>
        </div>
      </section>

      {requiresGoogleLoginUrl && (
        <section
          role="alert"
          className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs sm:text-sm text-red-800 dark:text-red-200 space-y-1 no-print"
        >
          <p className="font-semibold">
            คำเตือน: URL ปัจจุบัน ({targetUrl.includes('ai.studio/') ? 'ai.studio' : 'ais-dev'}) จะบังคับให้คนขับล็อกอิน Google
          </p>
          <p>
            ลิงก์จากปุ่ม Share (ai.studio/apps/...) เปิดเข้าแพลตฟอร์ม AI Studio ซึ่งต้องใช้บัญชี Google — หากต้องการให้คนขับสแกนแล้วจองได้เลยไม่ต้องล็อกอิน ให้กดปุ่ม{' '}
            <strong>Publish</strong> (Deploy เป็น Cloud Run แบบ Public) แล้วนำ URL รูปแบบ{' '}
            <span className="font-mono-tabular">https://...run.app</span> มาบันทึกในช่องด้านล่างนี้แทนครับ
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs sm:text-sm text-amber-900 dark:text-amber-200 space-y-1.5 no-print">
        <p className="font-semibold">หมายเหตุก่อนนำป้าย QR ไปสแกนบนมือถือ:</p>
        <p>
          1. หากกดสแกนแล้วยังขึ้นหน้าว่าง, Error 404 หรือติดล็อกอิน Google ให้กดปุ่ม{' '}
          <strong>Publish</strong> ที่มุมบนเพื่อ Deploy แอปขึ้น Cloud Run (เลือกเปิด Public / Allow unauthenticated)
        </p>
        <p>
          2. นำ URL จริงที่ได้หลัง Publish (เช่น <span className="font-mono-tabular">https://...run.app</span>) มาบันทึกในช่องด้านล่างนี้ แล้วลองสแกนด้วยโหมดไม่ระบุตัวตน (Incognito) เพื่อยืนยันว่าไม่ต้องล็อกอิน Google ครับ
        </p>
        <div className="pt-1">
          <a
            href={targetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center font-semibold underline text-amber-950 dark:text-amber-100"
          >
            คลิกเพื่อทดสอบเปิดลิงก์ปลายทางของ QR
          </a>
        </div>
      </section>

      {/* Admin-only URL editor */}
      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 no-print">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            ตั้งค่า URL หน้าแรกสำหรับ QR Code (เฉพาะแอดมิน)
          </h3>
          <form onSubmit={handleSaveUrl} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="url"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
            />
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก...' : 'บันทึก URL'}</span>
            </button>
          </form>
          {saveError && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
          {saveMsg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{saveMsg}</p>}
        </section>
      )}
    </main>
  );
}
