import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search, Trash2, X } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase';
import {
  formatSlotRange,
  formatThaiDate,
  formatThaiDateTime,
  isoToBangkokDateStr,
} from '../../lib/time';
import {
  ACTOR_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  getDockName,
  JOB_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_TEXT_CLASSES,
} from '../../lib/status';
import { downloadCsvWithBom } from '../../lib/csv';
import {
  BookingEvent,
  BookingStatus,
  JobType,
  StaffBooking,
  WarehouseSettings,
} from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';

interface AdminBookingsTabProps {
  settings: WarehouseSettings;
  bookings: StaffBooking[];
  events: BookingEvent[];
  onRefresh: () => Promise<void>;
}

type SortKey =
  | 'created_at'
  | 'booking_date'
  | 'slot_hour'
  | 'license_plate'
  | 'driver_name'
  | 'company'
  | 'job_type'
  | 'status'
  | 'dock_number';

export function AdminBookingsTab({
  settings,
  bookings,
  events,
  onRefresh,
}: AdminBookingsTabProps) {
  const [search, setSearch] = useState('');
  const [filterBookingDate, setFilterBookingDate] = useState('');
  const [filterCreatedDate, setFilterCreatedDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterJobType, setFilterJobType] = useState('all');
  const [filterDock, setFilterDock] = useState('all');

  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Drawer / Modal state for editing selected row
  const [selected, setSelected] = useState<StaffBooking | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editHour, setEditHour] = useState(8);
  const [editPlate, setEditPlate] = useState('');
  const [editDriver, setEditDriver] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editJobType, setEditJobType] = useState<JobType>('dropoff');
  const [editStatus, setEditStatus] = useState<BookingStatus>('booked');
  const [editDock, setEditDock] = useState<string>('');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Confirm dialogs
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const activeBookings = useMemo(() => bookings.filter((b) => !b.is_deleted), [bookings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeBookings
      .filter((b) => {
        if (filterBookingDate && b.booking_date !== filterBookingDate) return false;
        if (filterCreatedDate && isoToBangkokDateStr(b.created_at) !== filterCreatedDate) return false;
        if (filterStatus !== 'all' && b.status !== filterStatus) return false;
        if (filterJobType !== 'all' && b.job_type !== filterJobType) return false;
        if (filterDock !== 'all') {
          if (filterDock === 'none' && b.dock_number !== null) return false;
          if (filterDock !== 'none' && String(b.dock_number || '') !== filterDock) return false;
        }
        if (q) {
          const hay = `${b.license_plate} ${b.driver_name} ${b.company}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case 'created_at':
            cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            break;
          case 'booking_date':
            cmp = a.booking_date.localeCompare(b.booking_date);
            break;
          case 'slot_hour':
            cmp = a.slot_hour - b.slot_hour;
            break;
          case 'dock_number':
            cmp = (a.dock_number || 0) - (b.dock_number || 0);
            break;
          default:
            cmp = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'th');
        }
        return sortAsc ? cmp : -cmp;
      });
  }, [
    activeBookings,
    search,
    filterBookingDate,
    filterCreatedDate,
    filterStatus,
    filterJobType,
    filterDock,
    sortKey,
    sortAsc,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectedEvents = useMemo(() => {
    if (!selected) return [];
    return events
      .filter((ev) => ev.booking_id === selected.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [events, selected]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key !== 'created_at');
    }
    setPage(1);
  };

  const openDetailDrawer = (b: StaffBooking) => {
    setSelected(b);
    setEditDate(b.booking_date);
    setEditHour(b.slot_hour);
    setEditPlate(b.license_plate);
    setEditDriver(b.driver_name);
    setEditCompany(b.company || '');
    setEditJobType(b.job_type);
    setEditStatus(b.status);
    setEditDock(b.dock_number ? String(b.dock_number) : '');
    setEditNotes(b.notes || '');
    setEditReason('');
    setSaveError('');
  };

  const handleValidateAndAskConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    if (!editPlate.trim() || !editDriver.trim()) {
      setSaveError('กรุณากรอกทะเบียนรถและชื่อคนขับ');
      return;
    }
    if (!editReason.trim()) {
      setSaveError('กรุณาระบุเหตุผลในการแก้ไขหรือย้อนสถานะ');
      return;
    }
    setConfirmSaveOpen(true);
  };

  const executeAdminUpdate = async () => {
    if (!selected) return;
    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setSaving(true);
    setSaveError('');
    try {
      const { error } = await supabase.rpc('admin_update_booking', {
        p_booking_id: selected.id,
        p_booking_date: editDate,
        p_slot_hour: editHour,
        p_license_plate: editPlate.trim(),
        p_driver_name: editDriver.trim(),
        p_company: editCompany.trim(),
        p_job_type: editJobType,
        p_status: editStatus,
        p_dock_number: editDock ? Number(editDock) : null,
        p_notes: editNotes.trim(),
        p_reason: editReason.trim(),
      });

      if (error) {
        setSaveError(error.message || 'ไม่สามารถบันทึกการแก้ไขได้');
        setConfirmSaveOpen(false);
        return;
      }

      setConfirmSaveOpen(false);
      setSelected(null);
      await onRefresh();
    } catch {
      setSaveError('เกิดข้อผิดพลาดในการเชื่อมต่อ');
      setConfirmSaveOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const executeSoftDelete = async (reason: string) => {
    if (!deleteTarget) return;
    const supabase = await getSupabaseClient();
    if (!supabase) return;

    setDeleting(true);
    setDeleteError('');
    try {
      const { error } = await supabase.rpc('admin_soft_delete_booking', {
        p_booking_id: deleteTarget.id,
        p_reason: reason,
      });

      if (error) {
        setDeleteError(error.message || 'ไม่สามารถลบรายการได้');
        return;
      }

      setDeleteTarget(null);
      if (selected?.id === deleteTarget.id) setSelected(null);
      await onRefresh();
    } catch {
      setDeleteError('เกิดข้อผิดพลาดในการลบรายการ');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'เวลาที่กดจอง',
      'วันที่นัด',
      'ช่วงเวลา',
      'ทะเบียนรถ',
      'ชื่อคนขับ',
      'บริษัท',
      'ประเภทงาน',
      'สถานะ',
      'โดค',
      'หมายเหตุ',
    ];
    const rows = filtered.map((b) => [
      formatThaiDateTime(b.created_at),
      b.booking_date,
      formatSlotRange(b.slot_hour),
      b.license_plate,
      b.driver_name,
      b.company || '',
      JOB_TYPE_LABELS[b.job_type],
      STATUS_LABELS[b.status],
      b.dock_number ? getDockName(settings, b.dock_number) : '-',
      b.notes || '',
    ]);
    downloadCsvWithBom(`bookings-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const slotHours = Array.from(
    { length: Math.max(1, settings.close_hour - settings.open_hour) },
    (_, i) => settings.open_hour + i
  );

  const renderSortHeader = (key: SortKey, label: string) => (
    <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
      >
        <span>{label}</span>
        {sortKey === key &&
          (sortAsc ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Filters & Search Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาทะเบียนรถ, ชื่อคนขับ, บริษัท..."
              className="w-full min-h-[42px] pl-10 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2 self-start lg:self-auto whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV ({filtered.length})</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              วันที่นัด
            </label>
            <input
              type="date"
              value={filterBookingDate}
              onChange={(e) => {
                setFilterBookingDate(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              วันที่กดจอง
            </label>
            <input
              type="date"
              value={filterCreatedDate}
              onChange={(e) => {
                setFilterCreatedDate(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              สถานะ
            </label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="all">ทุกสถานะ</option>
              {(Object.keys(STATUS_LABELS) as BookingStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              ประเภทงาน
            </label>
            <select
              value={filterJobType}
              onChange={(e) => {
                setFilterJobType(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="all">ทั้งหมด</option>
              <option value="dropoff">ส่งของ</option>
              <option value="pickup">รับของ</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              โดค
            </label>
            <select
              value={filterDock}
              onChange={(e) => {
                setFilterDock(e.target.value);
                setPage(1);
              }}
              className="w-full min-h-[38px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="all">ทุกโดค</option>
              <option value="none">ยังไม่ระบุโดค</option>
              {Array.from({ length: settings.dock_count }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {getDockName(settings, d)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <tr>
                {renderSortHeader('created_at', 'เวลาที่กดจอง')}
                {renderSortHeader('booking_date', 'วันที่นัด')}
                {renderSortHeader('slot_hour', 'ช่วงเวลา')}
                {renderSortHeader('license_plate', 'ทะเบียน')}
                {renderSortHeader('driver_name', 'ชื่อคนขับ')}
                {renderSortHeader('company', 'บริษัท')}
                {renderSortHeader('job_type', 'ประเภทงาน')}
                {renderSortHeader('status', 'สถานะ')}
                {renderSortHeader('dock_number', 'โดค')}
                <th className="px-3 py-2.5 text-left font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    ไม่พบรายการจองตามตัวกรอง
                  </td>
                </tr>
              ) : (
                pageItems.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => openDetailDrawer(b)}
                    className="cursor-pointer hover:bg-blue-50/40 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                      {formatThaiDateTime(b.created_at)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular text-slate-700 dark:text-slate-200">
                      {formatThaiDate(b.booking_date, false)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular text-slate-800 dark:text-slate-200">
                      {formatSlotRange(b.slot_hour)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular font-semibold text-slate-900 dark:text-white">
                      {b.license_plate}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-800 dark:text-slate-200">
                      {b.driver_name}
                    </td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate text-slate-600 dark:text-slate-300">
                      {b.company || '-'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {JOB_TYPE_LABELS[b.job_type]}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${STATUS_TEXT_CLASSES[b.status]}`}>
                      {STATUS_LABELS[b.status]}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono-tabular text-slate-700 dark:text-slate-300">
                      {b.dock_number ? getDockName(settings, b.dock_number) : '-'}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate text-slate-500 dark:text-slate-400">
                      {b.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span className="tabular-nums">
            แสดง {pageItems.length} จาก {filtered.length} รายการ (หน้า {safePage}/{totalPages})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      </div>

      {/* Row Detail, Edit & Timeline Drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl h-full overflow-y-auto bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  รายละเอียดคิว {selected.license_plate}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular mt-0.5">
                  กดจองเมื่อ {formatThaiDateTime(selected.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="ปิด"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Edit Form */}
            <form onSubmit={handleValidateAndAskConfirm} className="space-y-3.5" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    วันที่นัด
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    ช่วงเวลา
                  </label>
                  <select
                    value={editHour}
                    onChange={(e) => setEditHour(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  >
                    {slotHours.map((h) => (
                      <option key={h} value={h}>
                        {formatSlotRange(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    ทะเบียนรถ
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={editPlate}
                    onChange={(e) => setEditPlate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    ชื่อคนขับ
                  </label>
                  <input
                    type="text"
                    maxLength={60}
                    value={editDriver}
                    onChange={(e) => setEditDriver(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    บริษัท
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    ประเภทงาน
                  </label>
                  <select
                    value={editJobType}
                    onChange={(e) => setEditJobType(e.target.value as JobType)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    <option value="dropoff">ส่งของ</option>
                    <option value="pickup">รับของ</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    สถานะ (สามารถย้อนสถานะหรือยกเลิกได้)
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as BookingStatus)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    {(Object.keys(STATUS_LABELS) as BookingStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    โดค
                  </label>
                  <select
                    value={editDock}
                    onChange={(e) => setEditDock(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    <option value="">กำหนดอัตโนมัติ / ไม่ระบุ</option>
                    {Array.from({ length: settings.dock_count }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d)}>
                        {getDockName(settings, d)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  หมายเหตุ
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  เหตุผลในการแก้ไข / ย้ายวัน-เวลา / เปลี่ยนสถานะ <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="ระบุเหตุผลที่จะบันทึกในประวัติ (Audit Log)..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>

              {saveError && (
                <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError('');
                    setDeleteTarget(selected);
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>ลบรายการ</span>
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                >
                  บันทึกการเปลี่ยนแปลง
                </button>
              </div>
            </form>

            {/* Timeline */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ประวัติเหตุการณ์ (Timeline)
              </h4>
              {selectedEvents.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">ยังไม่มีประวัติเหตุการณ์</p>
              ) : (
                <ol className="space-y-3">
                  {selectedEvents.map((ev) => {
                    const oldStatus = (ev.old_data as { status?: BookingStatus } | null)?.status;
                    const newStatus = (ev.new_data as { status?: BookingStatus } | null)?.status;
                    return (
                      <li
                        key={ev.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                          </span>
                          <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                            {formatThaiDateTime(ev.created_at)}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">
                          ผู้ทำ: {ACTOR_TYPE_LABELS[ev.actor_type] || ev.actor_type}
                          {ev.actor_email ? ` (${ev.actor_email})` : ''}
                        </p>
                        {oldStatus && newStatus && oldStatus !== newStatus && (
                          <p className="text-slate-700 dark:text-slate-200">
                            สถานะ: {STATUS_LABELS[oldStatus] || oldStatus} →{' '}
                            {STATUS_LABELS[newStatus] || newStatus}
                          </p>
                        )}
                        {ev.reason && (
                          <p className="text-slate-600 dark:text-slate-300">เหตุผล: {ev.reason}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSaveOpen}
        title="ยืนยันการแก้ไขข้อมูลคิว"
        description={`ต้องการบันทึกการเปลี่ยนแปลงคิว ${selected?.license_plate || ''} ด้วยเหตุผล "${editReason}" ใช่หรือไม่?`}
        confirmLabel="ยืนยันบันทึก"
        loading={saving}
        onConfirm={executeAdminUpdate}
        onCancel={() => setConfirmSaveOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="ยืนยันการลบรายการคิว (Soft Delete)"
        description={
          deleteError
            ? deleteError
            : `ต้องการลบคิวทะเบียน ${deleteTarget?.license_plate || ''} ออกจากรายการจองใช่หรือไม่? ประวัติการลบจะถูกเก็บไว้ใน Audit Log`
        }
        confirmLabel="ยืนยันลบรายการ"
        danger
        requireReason
        reasonLabel="เหตุผลในการลบ (บังคับ)"
        loading={deleting}
        onConfirm={executeSoftDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
      />
    </div>
  );
}
