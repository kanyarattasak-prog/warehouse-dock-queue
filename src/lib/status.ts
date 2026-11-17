import { BookingStatus, JobType, WarehouseSettings } from '../types';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  booked: 'จองแล้ว',
  arrived: 'มาถึงแล้ว',
  called: 'ถึงคิว (เข้าโดคได้)',
  loading: 'กำลังขึ้น/ลงของ',
  completed: 'เสร็จสิ้น',
  no_show: 'ไม่มาตามนัด',
  cancelled: 'ยกเลิก',
};

export const STATUS_TEXT_CLASSES: Record<BookingStatus, string> = {
  booked: 'text-blue-700 dark:text-blue-400',
  arrived: 'text-amber-700 dark:text-amber-400',
  called: 'text-red-700 dark:text-red-400 font-semibold',
  loading: 'text-indigo-700 dark:text-indigo-400 font-semibold',
  completed: 'text-emerald-700 dark:text-emerald-400',
  no_show: 'text-rose-700 dark:text-rose-400',
  cancelled: 'text-slate-500 dark:text-slate-400',
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  pickup: 'รับของ',
  dropoff: 'ส่งของ',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  created: 'จองคิวใหม่',
  walk_in_created: 'เพิ่มคิวหน้างาน',
  status_changed: 'เปลี่ยนสถานะ',
  updated: 'แก้ไขข้อมูลคิว',
  deleted: 'ลบรายการ (Soft Delete)',
  settings_updated: 'แก้ไขการตั้งค่าโกดัง',
  user_invited: 'เชิญผู้ใช้ใหม่',
  user_role_changed: 'เปลี่ยนสิทธิ์ผู้ใช้',
  user_status_changed: 'เปลี่ยนสถานะบัญชีผู้ใช้',
  user_password_reset_sent: 'ส่งลิงก์รีเซ็ตรหัสผ่าน',
};

export const ACTOR_TYPE_LABELS: Record<string, string> = {
  driver: 'คนขับ',
  staff: 'เจ้าหน้าที่',
  admin: 'ผู้ดูแลระบบ',
  system: 'ระบบ',
};

export function getDockName(settings: Pick<WarehouseSettings, 'dock_names'> | null | undefined, dockNumber: number): string {
  const custom = settings?.dock_names?.[dockNumber - 1];
  return custom && custom.trim() ? custom.trim() : `โดค ${dockNumber}`;
}

export function getActiveDockNumbers(settings: Pick<WarehouseSettings, 'dock_count' | 'closed_docks'>): number[] {
  const closedSet = new Set(settings.closed_docks || []);
  const result: number[] = [];
  for (let i = 1; i <= settings.dock_count; i++) {
    if (!closedSet.has(i)) result.push(i);
  }
  return result;
}
