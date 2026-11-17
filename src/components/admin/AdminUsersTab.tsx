import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, X } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase';
import { formatThaiDateTime } from '../../lib/time';
import { AdminUserItem } from '../../types';

interface AdminUsersTabProps {
  currentUserId: string | null;
  onRefreshAudit: () => Promise<void>;
}

export function AdminUsersTab({ currentUserId, onRefreshAudit }: AdminUsersTabProps) {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'admin'>('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const getAccessToken = async (): Promise<string | null> => {
    const supabase = await getSupabaseClient();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  const fetchUsers = useCallback(async () => {
    setError('');
    const token = await getAccessToken();
    if (!token) {
      setError('ไม่พบเซสชันผู้ดูแลระบบ');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้');
        return;
      }
      setUsers(json.users || []);
    } catch {
      setError('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const activeAdminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setNotice('');

    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setInviteError('กรุณากรอกอีเมล');
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    setInviting(true);
    try {
      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: cleanEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        setInviteError(json.error || 'ไม่สามารถเชิญผู้ใช้ได้');
        return;
      }

      setInviteOpen(false);
      setInviteEmail('');
      setNotice(`ส่งอีเมลเชิญไปยัง ${cleanEmail} แล้ว (ผู้ถูกเชิญจะได้รับลิงก์ตั้งรหัสผ่านเอง)`);
      await fetchUsers();
      await onRefreshAudit();
    } catch {
      setInviteError('เกิดข้อผิดพลาดในการส่งคำเชิญ');
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (u: AdminUserItem, newRole: 'staff' | 'admin') => {
    if (u.role === newRole) return;
    setError('');
    setNotice('');

    const token = await getAccessToken();
    if (!token) return;

    setBusyUserId(u.user_id);
    try {
      const res = await fetch(`/api/admin/users/${u.user_id}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'ไม่สามารถเปลี่ยนสิทธิ์ได้');
        return;
      }
      setNotice(`อัปเดตสิทธิ์ของ ${u.email} เป็น ${newRole} แล้ว`);
      await fetchUsers();
      await onRefreshAudit();
    } catch {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleToggleStatus = async (u: AdminUserItem) => {
    setError('');
    setNotice('');
    const nextActive = !u.is_active;

    const token = await getAccessToken();
    if (!token) return;

    setBusyUserId(u.user_id);
    try {
      const res = await fetch(`/api/admin/users/${u.user_id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: nextActive }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'ไม่สามารถเปลี่ยนสถานะบัญชีได้');
        return;
      }
      setNotice(`${nextActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}บัญชี ${u.email} แล้ว`);
      await fetchUsers();
      await onRefreshAudit();
    } catch {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (u: AdminUserItem) => {
    setError('');
    setNotice('');
    const token = await getAccessToken();
    if (!token) return;

    setBusyUserId(u.user_id);
    try {
      const res = await fetch(`/api/admin/users/${u.user_id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้');
        return;
      }
      setNotice(json.message || `ส่งลิงก์รีเซ็ตรหัสผ่านไปยัง ${u.email} แล้ว`);
      await onRefreshAudit();
    } catch {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            ผู้ใช้และสิทธิ์การเข้าถึง
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            จัดการบัญชีเจ้าหน้าที่และแอดมินผ่านรันไทม์ฝั่งเซิร์ฟเวอร์ (ระบบปิดการสมัครสมาชิกสาธารณะ)
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setInviteError('');
            setInviteOpen(true);
          }}
          className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>เชิญผู้ใช้ใหม่ทางอีเมล</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {notice}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left font-medium">อีเมล</th>
                <th className="px-4 py-3 text-left font-medium">สิทธิ์ (Role)</th>
                <th className="px-4 py-3 text-left font-medium">สถานะบัญชี</th>
                <th className="px-4 py-3 text-left font-medium">เข้าใช้งานล่าสุด</th>
                <th className="px-4 py-3 text-right font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    กำลังโหลดรายชื่อผู้ใช้...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    ไม่พบรายชื่อผู้ใช้
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isLastActiveAdmin =
                    u.role === 'admin' && u.is_active && activeAdminCount <= 1;
                  const isSelf = u.user_id === currentUserId;
                  return (
                    <tr key={u.user_id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {u.email}
                        {isSelf && (
                          <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                            (คุณ)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`สิทธิ์ของ ${u.email}`}
                          value={u.role}
                          disabled={busyUserId === u.user_id || isLastActiveAdmin}
                          onChange={(e) =>
                            handleChangeRole(u, e.target.value as 'staff' | 'admin')
                          }
                          className="min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs disabled:opacity-50"
                        >
                          <option value="staff">เจ้าหน้าที่ (staff)</option>
                          <option value="admin">แอดมิน (admin)</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium ${
                            u.is_active
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {u.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                        {u.last_sign_in_at ? formatThaiDateTime(u.last_sign_in_at) : 'ยังไม่เคยเข้าใช้'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyUserId === u.user_id || (u.is_active && isLastActiveAdmin)}
                            onClick={() => handleToggleStatus(u)}
                            className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                          >
                            {u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                          </button>
                          <button
                            type="button"
                            disabled={busyUserId === u.user_id}
                            onClick={() => handleResetPassword(u)}
                            className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>ส่งรีเซ็ตรหัสผ่าน</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite User Modal */}
      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                เชิญเจ้าหน้าที่ / แอดมินใหม่
              </h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              ระบบจะส่งอีเมลคำเชิญเพื่อให้ผู้รับกดลิงก์และตั้งรหัสผ่านของตนเอง
            </p>

            <form onSubmit={handleInvite} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  อีเมลผู้รับคำเชิญ *
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="staff01@company.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  สิทธิ์ (Role)
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'staff' | 'admin')}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                >
                  <option value="staff">เจ้าหน้าที่ (staff) — จัดการคิวหน้างาน</option>
                  <option value="admin">แอดมิน (admin) — เข้าถึงหลังบ้านทั้งหมด</option>
                </select>
              </div>

              {inviteError && (
                <p className="text-sm text-red-600 dark:text-red-400">{inviteError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {inviting ? 'กำลังส่งคำเชิญ...' : 'ส่งคำเชิญ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
