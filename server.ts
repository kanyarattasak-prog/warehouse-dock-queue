import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

interface AuthenticatedRequest extends Request {
  adminUser?: {
    id: string;
    email: string;
  };
}

function cleanEnvValue(val: string | undefined): string {
  return (val || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const cleaned = cleanEnvValue(raw);
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    return parsed.origin;
  } catch {
    return cleaned.replace(/\/rest\/v1\/?.*$/i, '').replace(/\/+$/, '');
  }
}

function getSupabaseEnv() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const anonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  const serviceRoleKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, anonKey, serviceRoleKey };
}

function createAdminClient(): SupabaseClient | null {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createAnonClient(): SupabaseClient | null {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return null;
  }
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getOriginFromRequest(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('http')) {
    return origin.replace(/\/$/, '');
  }
  const appUrl = (process.env.APP_URL || '').trim();
  if (appUrl && appUrl !== 'MY_APP_URL' && appUrl.startsWith('http')) {
    return appUrl.replace(/\/$/, '');
  }
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${host}`;
}

function derivePublishedAppUrl(): string {
  const appUrl = (process.env.APP_URL || '').trim();
  if (!appUrl || appUrl === 'MY_APP_URL') {
    return '';
  }
  return appUrl.replace('https://ais-dev-', 'https://ais-pre-').replace(/\/$/, '');
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const supabaseAdmin = createAdminClient();
    if (!supabaseAdmin) {
      res.status(503).json({
        error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน Secrets ของเซิร์ฟเวอร์',
      });
      return;
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ' });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'ไม่พบโทเคนยืนยันตัวตน' });
      return;
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'เซสชันไม่ถูกต้องหรือหมดอายุแล้ว' });
      return;
    }

    const user = userData.user as typeof userData.user & { banned_until?: string | null };
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      res.status(403).json({ error: 'บัญชีนี้ถูกปิดการใช้งาน' });
      return;
    }

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role, is_active, email')
      .eq('user_id', user.id)
      .maybeSingle();

    if (roleError || !roleRow || !roleRow.is_active || roleRow.role !== 'admin') {
      res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (เฉพาะผู้ดูแลระบบเท่านั้น)' });
      return;
    }

    req.adminUser = {
      id: user.id,
      email: roleRow.email || user.email || '',
    };
    next();
  } catch {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์' });
  }
}

async function countActiveAdmins(supabaseAdmin: SupabaseClient): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true);

  if (error) {
    throw new Error('ไม่สามารถตรวจสอบจำนวนแอดมินได้');
  }
  return count || 0;
}

async function logUserAuditEvent(
  supabaseAdmin: SupabaseClient,
  params: {
    entityId: string;
    eventType: string;
    actorEmail: string;
    oldData: Record<string, unknown> | null;
    newData: Record<string, unknown> | null;
    reason: string;
  }
) {
  await supabaseAdmin.from('booking_events').insert({
    booking_id: null,
    entity_type: 'user',
    entity_id: params.entityId,
    event_type: params.eventType,
    actor_type: 'admin',
    actor_email: params.actorEmail,
    old_data: params.oldData,
    new_data: params.newData,
    reason: params.reason,
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/public-config', (_req, res) => {
    const { url, anonKey } = getSupabaseEnv();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      publishedAppUrl: derivePublishedAppUrl(),
    });
  });

  // Admin-only User Management Routes
  app.get('/api/admin/users', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const supabaseAdmin = createAdminClient()!;
      const [authListRes, rolesRes] = await Promise.all([
        supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 }),
        supabaseAdmin.from('user_roles').select('*').order('created_at', { ascending: true }),
      ]);

      if (authListRes.error) {
        res.status(500).json({ error: 'ไม่สามารถดึงรายชื่อผู้ใช้จากระบบยืนยันตัวตนได้' });
        return;
      }
      if (rolesRes.error) {
        res.status(500).json({ error: 'ไม่สามารถดึงตารางสิทธิ์ผู้ใช้ได้' });
        return;
      }

      const roleMap = new Map((rolesRes.data || []).map((r) => [r.user_id, r]));
      const users = (authListRes.data?.users || [])
        .filter((u) => roleMap.has(u.id))
        .map((u) => {
          const r = roleMap.get(u.id)!;
          const bannedUntil = (u as typeof u & { banned_until?: string | null }).banned_until;
          const isBanned = Boolean(bannedUntil && new Date(bannedUntil) > new Date());
          return {
            user_id: u.id,
            email: r.email || u.email || '',
            role: r.role as 'admin' | 'staff',
            is_active: Boolean(r.is_active) && !isBanned,
            last_sign_in_at: u.last_sign_in_at || null,
            created_at: u.created_at,
            email_confirmed_at: u.email_confirmed_at || null,
          };
        });

      res.json({ users });
    } catch {
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการโหลดรายชื่อผู้ใช้' });
    }
  });

  app.post('/api/admin/users/invite', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const supabaseAdmin = createAdminClient()!;
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || 'staff').trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
        return;
      }
      if (role !== 'staff' && role !== 'admin') {
        res.status(400).json({ error: 'สิทธิ์ผู้ใช้ต้องเป็น staff หรือ admin เท่านั้น' });
        return;
      }

      const origin = getOriginFromRequest(req);
      const redirectTo = `${origin}/set-password`;

      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { invited_role: role },
      });

      if (inviteError || !inviteData?.user) {
        const msg = inviteError?.message?.toLowerCase() || '';
        if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
          res.status(409).json({ error: 'อีเมลนี้มีบัญชีอยู่ในระบบแล้ว' });
          return;
        }
        res.status(400).json({ error: inviteError?.message || 'ไม่สามารถส่งคำเชิญทางอีเมลได้' });
        return;
      }

      const invitedUser = inviteData.user;
      const { error: roleInsertError } = await supabaseAdmin.from('user_roles').upsert(
        {
          user_id: invitedUser.id,
          email,
          role,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

      if (roleInsertError) {
        res.status(500).json({ error: 'เชิญผู้ใช้แล้ว แต่ไม่สามารถบันทึกสิทธิ์ลงฐานข้อมูลได้' });
        return;
      }

      await logUserAuditEvent(supabaseAdmin, {
        entityId: invitedUser.id,
        eventType: 'user_invited',
        actorEmail: req.adminUser!.email,
        oldData: null,
        newData: { email, role, is_active: true },
        reason: 'แอดมินส่งคำเชิญทางอีเมล',
      });

      res.status(201).json({
        ok: true,
        user: {
          user_id: invitedUser.id,
          email,
          role,
          is_active: true,
        },
      });
    } catch {
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเชิญผู้ใช้' });
    }
  });

  app.patch('/api/admin/users/:id/role', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const supabaseAdmin = createAdminClient()!;
      const targetUserId = String(req.params.id || '').trim();
      const newRole = String(req.body?.role || '').trim();

      if (!targetUserId) {
        res.status(400).json({ error: 'ไม่พบรหัสผู้ใช้' });
        return;
      }
      if (newRole !== 'staff' && newRole !== 'admin') {
        res.status(400).json({ error: 'สิทธิ์ต้องเป็น staff หรือ admin เท่านั้น' });
        return;
      }

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('user_roles')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (fetchError || !existing) {
        res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });
        return;
      }

      if (existing.role === 'admin' && existing.is_active && newRole !== 'admin') {
        const activeAdmins = await countActiveAdmins(supabaseAdmin);
        if (activeAdmins <= 1) {
          res.status(400).json({ error: 'ห้ามลดสิทธิ์แอดมินคนสุดท้ายของระบบ' });
          return;
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from('user_roles')
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq('user_id', targetUserId);

      if (updateError) {
        res.status(500).json({ error: 'ไม่สามารถอัปเดตสิทธิ์ผู้ใช้ได้' });
        return;
      }

      await logUserAuditEvent(supabaseAdmin, {
        entityId: targetUserId,
        eventType: 'user_role_changed',
        actorEmail: req.adminUser!.email,
        oldData: { email: existing.email, role: existing.role },
        newData: { email: existing.email, role: newRole },
        reason: 'แอดมินเปลี่ยนสิทธิ์ผู้ใช้',
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเปลี่ยนสิทธิ์ผู้ใช้' });
    }
  });

  app.patch('/api/admin/users/:id/status', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const supabaseAdmin = createAdminClient()!;
      const targetUserId = String(req.params.id || '').trim();
      const isActive = Boolean(req.body?.is_active);

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('user_roles')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (fetchError || !existing) {
        res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });
        return;
      }

      if (!isActive && existing.role === 'admin' && existing.is_active) {
        const activeAdmins = await countActiveAdmins(supabaseAdmin);
        if (activeAdmins <= 1) {
          res.status(400).json({ error: 'ห้ามปิดใช้งานแอดมินคนสุดท้ายของระบบ' });
          return;
        }
      }

      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        ban_duration: isActive ? 'none' : '876000h',
      });

      if (authUpdateError) {
        res.status(500).json({ error: 'ไม่สามารถอัปเดตสถานะในระบบยืนยันตัวตนได้' });
        return;
      }

      const { error: roleUpdateError } = await supabaseAdmin
        .from('user_roles')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('user_id', targetUserId);

      if (roleUpdateError) {
        res.status(500).json({ error: 'ไม่สามารถบันทึกสถานะผู้ใช้ได้' });
        return;
      }

      await logUserAuditEvent(supabaseAdmin, {
        entityId: targetUserId,
        eventType: 'user_status_changed',
        actorEmail: req.adminUser!.email,
        oldData: { email: existing.email, is_active: existing.is_active },
        newData: { email: existing.email, is_active: isActive },
        reason: isActive ? 'แอดมินเปิดใช้งานบัญชี' : 'แอดมินปิดใช้งานบัญชี',
      });

      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะผู้ใช้' });
    }
  });

  app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const supabaseAdmin = createAdminClient()!;
      const supabaseAnon = createAnonClient();
      const targetUserId = String(req.params.id || '').trim();

      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('user_roles')
        .select('email')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (fetchError || !existing?.email) {
        res.status(404).json({ error: 'ไม่พบอีเมลของผู้ใช้' });
        return;
      }

      if (!supabaseAnon) {
        res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_ANON_KEY' });
        return;
      }

      const origin = getOriginFromRequest(req);
      const { error: resetError } = await supabaseAnon.auth.resetPasswordForEmail(existing.email, {
        redirectTo: `${origin}/set-password`,
      });

      if (resetError) {
        res.status(400).json({ error: resetError.message || 'ไม่สามารถส่งลิงก์รีเซ็ตรหัสผ่านได้' });
        return;
      }

      await logUserAuditEvent(supabaseAdmin, {
        entityId: targetUserId,
        eventType: 'user_password_reset_sent',
        actorEmail: req.adminUser!.email,
        oldData: null,
        newData: { email: existing.email },
        reason: 'แอดมินส่งลิงก์รีเซ็ตรหัสผ่าน',
      });

      res.json({ ok: true, message: `ส่งลิงก์รีเซ็ตรหัสผ่านไปยัง ${existing.email} แล้ว` });
    } catch {
      res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งลิงก์รีเซ็ตรหัสผ่าน' });
    }
  });

  // Vite dev middleware or production static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
