import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface SetupNoticeProps {
  message: string;
}

export function SetupNotice({ message }: SetupNoticeProps) {
  return (
    <div className="max-w-2xl mx-auto my-8 px-4">
      <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
              ยังเชื่อมต่อฐานข้อมูล Supabase ไม่สมบูรณ์
            </h2>
            <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">{message}</p>
            <ol className="text-xs text-amber-800 dark:text-amber-300 list-decimal pl-4 space-y-1 pt-1">
              <li>ตั้งค่า Secrets ของ Supabase ในระบบ (URL, Anon Key และ Service Key ฝั่งเซิร์ฟเวอร์)</li>
              <li>นำสคริปต์จากไฟล์ supabase_schema.sql ไปรันใน Supabase SQL Editor</li>
              <li>รีเฟรชหน้าเว็บนี้อีกครั้ง</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
