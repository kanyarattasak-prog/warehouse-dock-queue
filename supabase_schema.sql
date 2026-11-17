-- ============================================================================
-- ระบบจองคิวรถหน้าโกดัง (Warehouse Dock Queue Booking System)
-- ไฟล์ SQL ก้อนเดียวสำหรับรันใน Supabase > SQL Editor > Run
-- เขตเวลาหลัก: Asia/Bangkok
-- ============================================================================

-- 1. ส่วนขยายที่จำเป็น
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. ตารางตั้งค่าระบบ (settings) - เปิด RLS ทันที
CREATE TABLE IF NOT EXISTS public.settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dock_count integer NOT NULL DEFAULT 3 CHECK (dock_count BETWEEN 1 AND 12),
  dock_names jsonb NOT NULL DEFAULT '["โดค 1","โดค 2","โดค 3"]'::jsonb,
  closed_docks integer[] NOT NULL DEFAULT '{}',
  open_hour integer NOT NULL DEFAULT 8 CHECK (open_hour BETWEEN 0 AND 22),
  close_hour integer NOT NULL DEFAULT 17 CHECK (close_hour BETWEEN 1 AND 23),
  advance_days integer NOT NULL DEFAULT 7 CHECK (advance_days BETWEEN 0 AND 60),
  notify_minutes integer NOT NULL DEFAULT 30 CHECK (notify_minutes BETWEEN 5 AND 180),
  holidays date[] NOT NULL DEFAULT '{}',
  public_app_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT settings_open_before_close CHECK (close_hour > open_hour)
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- 3. ตารางสิทธิ์ผู้ใช้แยกต่างหาก (user_roles) - เปิด RLS ทันที
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. ตารางการจองคิว (bookings) - เปิด RLS ทันที
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date date NOT NULL,
  slot_hour integer NOT NULL CHECK (slot_hour BETWEEN 0 AND 23),
  license_plate text NOT NULL CHECK (char_length(btrim(license_plate)) BETWEEN 1 AND 20),
  driver_name text NOT NULL CHECK (char_length(btrim(driver_name)) BETWEEN 1 AND 60),
  company text NOT NULL DEFAULT '' CHECK (char_length(company) <= 80),
  job_type text NOT NULL CHECK (job_type IN ('pickup', 'dropoff')),
  status text NOT NULL DEFAULT 'booked' CHECK (
    status IN ('booked', 'arrived', 'called', 'loading', 'completed', 'no_show', 'cancelled')
  ),
  dock_number integer NULL CHECK (dock_number IS NULL OR (dock_number BETWEEN 1 AND 12)),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  is_walk_in boolean NOT NULL DEFAULT false,
  secret_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NULL,
  deleted_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  arrived_at timestamptz NULL,
  called_at timestamptz NULL,
  loading_at timestamptz NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  no_show_at timestamptz NULL
);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bookings_date_slot
  ON public.bookings (booking_date, slot_hour)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_bookings_created_at
  ON public.bookings (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_secret_token
  ON public.bookings (secret_token);

-- 5. ตารางบันทึกประวัติ / Audit Log (booking_events) - เปิด RLS ทันที
CREATE TABLE IF NOT EXISTS public.booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('booking', 'settings', 'user')),
  entity_id text NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('driver', 'staff', 'admin', 'system')),
  actor_email text NULL,
  old_data jsonb NULL,
  new_data jsonb NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_booking_events_booking_id
  ON public.booking_events (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_events_created_at
  ON public.booking_events (created_at DESC);

-- 6. ตารางจำกัดอัตราการจอง (Rate Limit) - เปิด RLS ทันที
CREATE TABLE IF NOT EXISTS public.booking_rate_limits (
  id bigserial PRIMARY KEY,
  client_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_booking_rate_limits_key_time
  ON public.booking_rate_limits (client_key, created_at DESC);

-- 7. ใส่ค่าตั้งต้นของตาราง settings
INSERT INTO public.settings (
  id, dock_count, dock_names, closed_docks, open_hour, close_hour, advance_days, notify_minutes, holidays, public_app_url
)
VALUES (
  1,
  3,
  '["โดค 1","โดค 2","โดค 3"]'::jsonb,
  '{}',
  8,
  17,
  7,
  30,
  '{}',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- 8. ฟังก์ชันตรวจสอบสิทธิ์ (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_active = true
        AND ur.role = p_role
    );
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.has_role('staff') OR public.has_role('admin');
$$;

CREATE OR REPLACE FUNCTION public.current_actor_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(btrim(current_setting('app.actor_email', true)), ''),
    (SELECT ur.email FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1),
    NULLIF(auth.jwt() ->> 'email', '')
  );
$$;

-- 9. ฟังก์ชันช่วยจัดรูปแบบข้อมูล (Mask ชื่อคนขับ & นับโดคที่เปิดใช้งาน)
CREATE OR REPLACE FUNCTION public.mask_driver_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text := btrim(coalesce(p_name, ''));
  v_len integer := char_length(v_clean);
BEGIN
  IF v_len = 0 THEN
    RETURN '***';
  ELSIF v_len <= 2 THEN
    RETURN left(v_clean, 1) || '***';
  ELSE
    RETURN left(v_clean, 2) || '***';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_active_docks(p_dock_count integer, p_closed_docks integer[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT count(*)::integer
  FROM generate_series(1, greatest(0, p_dock_count)) AS d(num)
  WHERE NOT (d.num = ANY(coalesce(p_closed_docks, '{}')));
$$;

-- 10. นโยบาย RLS และการกำหนดสิทธิ์ตาราง
REVOKE ALL ON public.bookings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.bookings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.settings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
REVOKE ALL ON public.booking_rate_limits FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.booking_events FROM anon, authenticated;

-- settings policies
DROP POLICY IF EXISTS settings_select_all ON public.settings;
CREATE POLICY settings_select_all
  ON public.settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- user_roles policies
DROP POLICY IF EXISTS user_roles_select_self_or_admin ON public.user_roles;
CREATE POLICY user_roles_select_self_or_admin
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role('admin'));

-- bookings policies (ไม่มี policy สำหรับ anon และห้ามเขียนตรงจาก client)
DROP POLICY IF EXISTS bookings_select_staff_or_admin ON public.bookings;
CREATE POLICY bookings_select_staff_or_admin
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    public.has_role('admin')
    OR (public.has_role('staff') AND is_deleted = false)
  );

-- booking_events policies (อ่านได้เฉพาะเจ้าหน้าที่/แอดมิน และห้ามแก้ไข/ลบโดยเด็ดขาด)
DROP POLICY IF EXISTS booking_events_select_staff_or_admin ON public.booking_events;
CREATE POLICY booking_events_select_staff_or_admin
  ON public.booking_events
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS booking_events_no_update ON public.booking_events;
CREATE POLICY booking_events_no_update
  ON public.booking_events
  FOR UPDATE
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS booking_events_no_delete ON public.booking_events;
CREATE POLICY booking_events_no_delete
  ON public.booking_events
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- 11. View สาธารณะสำหรับหน้าคนขับ (ไม่มี secret_token, ไม่มี notes, ซ่อนชื่อคนขับบางส่วน)
DROP VIEW IF EXISTS public.public_bookings_view;
CREATE VIEW public.public_bookings_view AS
SELECT
  b.id,
  b.booking_date,
  b.slot_hour,
  b.license_plate,
  public.mask_driver_name(b.driver_name) AS masked_driver_name,
  b.company,
  b.job_type,
  b.status,
  b.dock_number,
  b.is_walk_in,
  b.created_at,
  b.arrived_at,
  b.called_at,
  b.loading_at,
  b.completed_at
FROM public.bookings b
WHERE b.is_deleted = false;

GRANT SELECT ON public.public_bookings_view TO anon, authenticated;

-- 12. Trigger ป้องกันการแก้ไข/ลบ Audit Log และ Trigger บันทึกประวัติอัตโนมัติ
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ไม่อนุญาตให้แก้ไขหรือลบประวัติการใช้งาน (Audit Log)';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_booking_events_mutation ON public.booking_events;
CREATE TRIGGER trg_prevent_booking_events_mutation
  BEFORE UPDATE OR DELETE ON public.booking_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_mutation();

CREATE OR REPLACE FUNCTION public.trg_bookings_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor_type text;
  v_actor_email text;
  v_reason text;
  v_event_type text;
  v_old_json jsonb;
  v_new_json jsonb;
BEGIN
  v_actor_type := COALESCE(
    NULLIF(current_setting('app.actor_type', true), ''),
    CASE
      WHEN public.has_role('admin') THEN 'admin'
      WHEN public.has_role('staff') THEN 'staff'
      ELSE 'system'
    END
  );
  v_actor_email := public.current_actor_email();
  v_reason := NULLIF(btrim(current_setting('app.audit_reason', true)), '');

  IF TG_OP = 'INSERT' THEN
    v_event_type := CASE WHEN NEW.is_walk_in THEN 'walk_in_created' ELSE 'created' END;
    v_new_json := to_jsonb(NEW) - 'secret_token';

    INSERT INTO public.booking_events (
      booking_id, entity_type, entity_id, event_type, actor_type, actor_email, old_data, new_data, reason
    ) VALUES (
      NEW.id, 'booking', NEW.id::text, v_event_type, v_actor_type, v_actor_email, NULL, v_new_json, v_reason
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_deleted = false AND NEW.is_deleted = true THEN
      v_event_type := 'deleted';
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event_type := 'status_changed';
    ELSE
      v_event_type := 'updated';
    END IF;

    v_old_json := to_jsonb(OLD) - 'secret_token';
    v_new_json := to_jsonb(NEW) - 'secret_token';

    INSERT INTO public.booking_events (
      booking_id, entity_type, entity_id, event_type, actor_type, actor_email, old_data, new_data, reason
    ) VALUES (
      NEW.id, 'booking', NEW.id::text, v_event_type, v_actor_type, v_actor_email, v_old_json, v_new_json, v_reason
    );
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_audit_log ON public.bookings;
CREATE TRIGGER trg_bookings_audit_log
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bookings_audit();

CREATE OR REPLACE FUNCTION public.trg_settings_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor_email text := public.current_actor_email();
BEGIN
  INSERT INTO public.booking_events (
    booking_id, entity_type, entity_id, event_type, actor_type, actor_email, old_data, new_data, reason
  ) VALUES (
    NULL,
    'settings',
    '1',
    'settings_updated',
    CASE WHEN auth.uid() IS NOT NULL THEN 'admin' ELSE 'system' END,
    v_actor_email,
    to_jsonb(OLD),
    to_jsonb(NEW),
    NULLIF(btrim(current_setting('app.audit_reason', true)), '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settings_audit_log ON public.settings;
CREATE TRIGGER trg_settings_audit_log
  AFTER UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_settings_audit();

-- 13. ฟังก์ชัน RPC ฝั่งคนขับ: จองคิว (ตรวจกติกาทั้งหมด + Advisory Lock + Rate Limit)
CREATE OR REPLACE FUNCTION public.create_booking(
  p_booking_date date,
  p_slot_hour integer,
  p_license_plate text,
  p_driver_name text,
  p_company text DEFAULT '',
  p_job_type text DEFAULT 'dropoff',
  p_client_key text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  booking_date date,
  slot_hour integer,
  license_plate text,
  driver_name text,
  company text,
  job_type text,
  status text,
  secret_token text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_settings public.settings%ROWTYPE;
  v_now_bkk timestamp;
  v_today_bkk date;
  v_slot_start timestamp;
  v_plate text := btrim(coalesce(p_license_plate, ''));
  v_driver text := btrim(coalesce(p_driver_name, ''));
  v_company text := btrim(coalesce(p_company, ''));
  v_job_type text := btrim(coalesce(p_job_type, ''));
  v_active_docks integer;
  v_slot_count integer;
  v_rate_key text;
  v_recent_count integer;
  v_inserted public.bookings%ROWTYPE;
BEGIN
  -- ตรวจรูปแบบและความยาวข้อมูล
  IF char_length(v_plate) < 1 OR char_length(v_plate) > 20 THEN
    RAISE EXCEPTION 'กรุณากรอกทะเบียนรถให้ถูกต้อง (1-20 ตัวอักษร)';
  END IF;
  IF char_length(v_driver) < 1 OR char_length(v_driver) > 60 THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อคนขับให้ถูกต้อง (1-60 ตัวอักษร)';
  END IF;
  IF char_length(v_company) > 80 THEN
    RAISE EXCEPTION 'ชื่อบริษัทต้องไม่เกิน 80 ตัวอักษร';
  END IF;
  IF v_job_type NOT IN ('pickup', 'dropoff') THEN
    RAISE EXCEPTION 'ประเภทงานไม่ถูกต้อง (ต้องเป็น รับของ หรือ ส่งของ)';
  END IF;

  -- โหลดการตั้งค่า
  SELECT * INTO v_settings FROM public.settings WHERE public.settings.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบการตั้งค่าโกดัง';
  END IF;

  -- เวลาปัจจุบันตามเขตเวลา Asia/Bangkok
  v_now_bkk := timezone('Asia/Bangkok', now());
  v_today_bkk := v_now_bkk::date;

  -- ตรวจวันที่จอง (วันนี้ ถึง +N วัน)
  IF p_booking_date IS NULL OR p_booking_date < v_today_bkk THEN
    RAISE EXCEPTION 'ไม่สามารถจองคิวย้อนหลังได้';
  END IF;
  IF p_booking_date > (v_today_bkk + v_settings.advance_days) THEN
    RAISE EXCEPTION 'จองล่วงหน้าได้ไม่เกิน % วัน', v_settings.advance_days;
  END IF;

  -- ตรวจวันหยุด
  IF p_booking_date = ANY(v_settings.holidays) THEN
    RAISE EXCEPTION 'วันที่เลือกเป็นวันหยุดโกดัง ไม่เปิดรับจอง';
  END IF;

  -- ตรวจชั่วโมงเปิด-ปิด
  IF p_slot_hour IS NULL OR p_slot_hour < v_settings.open_hour OR p_slot_hour >= v_settings.close_hour THEN
    RAISE EXCEPTION 'ช่วงเวลาที่เลือกอยู่นอกเวลาเปิดทำการ (%:00-%:00)',
      lpad(v_settings.open_hour::text, 2, '0'),
      lpad(v_settings.close_hour::text, 2, '0');
  END IF;

  -- ตรวจเวลาที่ผ่านไปแล้วเกิน 30 นาที
  v_slot_start := p_booking_date::timestamp + make_interval(hours => p_slot_hour);
  IF v_now_bkk > (v_slot_start + interval '30 minutes') THEN
    RAISE EXCEPTION 'ช่วงเวลานี้ผ่านไปแล้วเกิน 30 นาที กรุณาเลือกเวลาอื่น';
  END IF;

  -- จำกัดอัตราการจองเบื้องต้น (Rate Limit)
  DELETE FROM public.booking_rate_limits WHERE booking_rate_limits.created_at < now() - interval '15 minutes';
  v_rate_key := COALESCE(NULLIF(btrim(p_client_key), ''), 'plate:' || lower(v_plate));

  SELECT count(*)::integer INTO v_recent_count
  FROM public.booking_rate_limits rl
  WHERE rl.client_key = v_rate_key
    AND rl.created_at >= now() - interval '10 minutes';

  IF v_recent_count >= 6 THEN
    RAISE EXCEPTION 'ทำรายการจองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
  END IF;

  -- Advisory Lock ต่อวัน+ช่วงเวลา กันจองซ้อนพร้อมกัน
  PERFORM pg_advisory_xact_lock(hashtext('booking:' || p_booking_date::text || ':' || p_slot_hour::text));

  -- กันทะเบียนรถเดียวกันจองซ้ำในวันและเวลาเดียวกัน
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.booking_date = p_booking_date
      AND b.slot_hour = p_slot_hour
      AND lower(btrim(b.license_plate)) = lower(v_plate)
      AND b.is_deleted = false
      AND b.status IN ('booked', 'arrived', 'called', 'loading')
  ) THEN
    RAISE EXCEPTION 'ทะเบียนรถนี้จองในช่วงเวลาดังกล่าวไว้แล้ว';
  END IF;

  -- นับจำนวนโดคที่เปิดใช้งานจริง
  v_active_docks := public.count_active_docks(v_settings.dock_count, v_settings.closed_docks);
  IF v_active_docks <= 0 THEN
    RAISE EXCEPTION 'ขณะนี้ไม่มีโดคเปิดให้บริการ';
  END IF;

  -- นับจำนวนคิวที่ยังไม่ยกเลิก/ไม่มา
  SELECT count(*)::integer INTO v_slot_count
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND b.slot_hour = p_slot_hour
    AND b.is_deleted = false
    AND b.status NOT IN ('cancelled', 'no_show');

  IF v_slot_count >= v_active_docks THEN
    RAISE EXCEPTION 'ช่วงเวลานี้เต็มแล้ว เลือกเวลาอื่น';
  END IF;

  INSERT INTO public.booking_rate_limits (client_key) VALUES (v_rate_key);

  PERFORM set_config('app.actor_type', 'driver', true);
  PERFORM set_config('app.actor_email', '', true);
  PERFORM set_config('app.audit_reason', '', true);

  INSERT INTO public.bookings (
    booking_date, slot_hour, license_plate, driver_name, company, job_type, status, is_walk_in
  )
  VALUES (
    p_booking_date, p_slot_hour, v_plate, v_driver, v_company, v_job_type, 'booked', false
  )
  RETURNING * INTO v_inserted;

  RETURN QUERY
  SELECT
    v_inserted.id,
    v_inserted.booking_date,
    v_inserted.slot_hour,
    v_inserted.license_plate,
    v_inserted.driver_name,
    v_inserted.company,
    v_inserted.job_type,
    v_inserted.status,
    v_inserted.secret_token,
    v_inserted.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking(date, integer, text, text, text, text, text) TO anon, authenticated;

-- 14. ฟังก์ชัน RPC ดึงคิวของเครื่องคนขับด้วย token
CREATE OR REPLACE FUNCTION public.get_my_bookings(p_tokens text[])
RETURNS TABLE (
  id uuid,
  booking_date date,
  slot_hour integer,
  license_plate text,
  driver_name text,
  company text,
  job_type text,
  status text,
  dock_number integer,
  secret_token text,
  created_at timestamptz,
  arrived_at timestamptz,
  called_at timestamptz,
  loading_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT
    b.id,
    b.booking_date,
    b.slot_hour,
    b.license_plate,
    b.driver_name,
    b.company,
    b.job_type,
    b.status,
    b.dock_number,
    b.secret_token,
    b.created_at,
    b.arrived_at,
    b.called_at,
    b.loading_at,
    b.completed_at
  FROM public.bookings b
  WHERE b.is_deleted = false
    AND coalesce(array_length(p_tokens, 1), 0) > 0
    AND b.secret_token = ANY(p_tokens)
  ORDER BY b.booking_date ASC, b.slot_hour ASC, b.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_bookings(text[]) TO anon, authenticated;

-- 15. ฟังก์ชัน RPC คนขับแจ้งมาถึง / ยกเลิกคิว (ต้องมี token ตรงกัน)
CREATE OR REPLACE FUNCTION public.driver_update_booking(
  p_booking_id uuid,
  p_token text,
  p_action text
)
RETURNS TABLE (
  id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  IF p_action NOT IN ('arrived', 'cancelled') THEN
    RAISE EXCEPTION 'คำสั่งไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการคิวนี้';
  END IF;

  IF coalesce(nullif(btrim(p_token), ''), '') = '' OR v_booking.secret_token <> p_token THEN
    RAISE EXCEPTION 'รหัสคิวไม่ถูกต้อง ไม่มีสิทธิ์ดำเนินการ';
  END IF;

  PERFORM set_config('app.actor_type', 'driver', true);
  PERFORM set_config('app.actor_email', '', true);

  IF p_action = 'arrived' THEN
    IF v_booking.status <> 'booked' THEN
      RAISE EXCEPTION 'แจ้งมาถึงได้เฉพาะคิวที่อยู่ในสถานะ จองแล้ว เท่านั้น';
    END IF;
    PERFORM set_config('app.audit_reason', 'คนขับกดแจ้งมาถึงหน้าโกดัง', true);
    UPDATE public.bookings
    SET status = 'arrived',
        arrived_at = COALESCE(arrived_at, now()),
        updated_at = now()
    WHERE public.bookings.id = p_booking_id;
  ELSIF p_action = 'cancelled' THEN
    IF v_booking.status NOT IN ('booked', 'arrived') THEN
      RAISE EXCEPTION 'ยกเลิกคิวได้เฉพาะสถานะ จองแล้ว หรือ มาถึงแล้ว เท่านั้น';
    END IF;
    PERFORM set_config('app.audit_reason', 'คนขับยกเลิกคิวด้วยตนเอง', true);
    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_at = now()
    WHERE public.bookings.id = p_booking_id;
  END IF;

  RETURN QUERY SELECT p_booking_id, (SELECT b2.status FROM public.bookings b2 WHERE b2.id = p_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_update_booking(uuid, text, text) TO anon, authenticated;

-- 16. ฟังก์ชัน RPC ฝั่งเจ้าหน้าที่: เปลี่ยนสถานะและจัดสรรโดคอัตโนมัติ
CREATE OR REPLACE FUNCTION public.staff_update_status(
  p_booking_id uuid,
  p_new_status text,
  p_notes text DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_free_dock integer;
  v_actor_type text;
  v_updated public.bookings%ROWTYPE;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เจ้าหน้าที่';
  END IF;

  IF p_new_status NOT IN ('arrived', 'called', 'loading', 'completed', 'no_show') THEN
    RAISE EXCEPTION 'สถานะเป้าหมายไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการคิวนี้';
  END IF;

  -- ตรวจลำดับสถานะสำหรับเจ้าหน้าที่
  IF p_new_status = 'arrived' AND v_booking.status <> 'booked' THEN
    RAISE EXCEPTION 'เปลี่ยนเป็น มาถึงแล้ว ได้เฉพาะจากสถานะ จองแล้ว';
  ELSIF p_new_status = 'called' AND v_booking.status NOT IN ('booked', 'arrived') THEN
    RAISE EXCEPTION 'เรียกคิวได้เฉพาะคิวที่ จองแล้ว หรือ มาถึงแล้ว';
  ELSIF p_new_status = 'loading' AND v_booking.status <> 'called' THEN
    RAISE EXCEPTION 'เริ่มขึ้น/ลงของได้เฉพาะคิวที่เรียกเข้าโดคแล้ว';
  ELSIF p_new_status = 'completed' AND v_booking.status NOT IN ('called', 'loading') THEN
    RAISE EXCEPTION 'เสร็จสิ้นได้เฉพาะคิวที่กำลังเข้าโดคหรือขึ้น/ลงของ';
  ELSIF p_new_status = 'no_show' AND v_booking.status NOT IN ('booked', 'arrived', 'called') THEN
    RAISE EXCEPTION 'บันทึกไม่มาตามนัดไม่ได้จากสถานะปัจจุบัน';
  END IF;

  v_actor_type := CASE WHEN public.has_role('admin') THEN 'admin' ELSE 'staff' END;
  PERFORM set_config('app.actor_type', v_actor_type, true);
  PERFORM set_config('app.actor_email', coalesce(public.current_actor_email(), ''), true);
  PERFORM set_config('app.audit_reason', '', true);

  IF p_new_status = 'called' THEN
    PERFORM pg_advisory_xact_lock(hashtext('dock_assignment'));
    SELECT * INTO v_settings FROM public.settings WHERE id = 1;

    SELECT d.num INTO v_free_dock
    FROM generate_series(1, v_settings.dock_count) AS d(num)
    WHERE NOT (d.num = ANY(coalesce(v_settings.closed_docks, '{}')))
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings occ
        WHERE occ.is_deleted = false
          AND occ.status IN ('called', 'loading')
          AND occ.dock_number = d.num
          AND occ.id <> p_booking_id
      )
    ORDER BY d.num ASC
    LIMIT 1;

    IF v_free_dock IS NULL THEN
      RAISE EXCEPTION 'โดคเต็ม รอให้มีโดคว่างก่อนเรียกคิว';
    END IF;

    UPDATE public.bookings
    SET status = 'called',
        dock_number = v_free_dock,
        arrived_at = COALESCE(arrived_at, now()),
        called_at = COALESCE(called_at, now()),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_updated;

  ELSIF p_new_status = 'arrived' THEN
    UPDATE public.bookings
    SET status = 'arrived',
        arrived_at = COALESCE(arrived_at, now()),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_updated;

  ELSIF p_new_status = 'loading' THEN
    UPDATE public.bookings
    SET status = 'loading',
        loading_at = COALESCE(loading_at, now()),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_updated;

  ELSIF p_new_status = 'completed' THEN
    UPDATE public.bookings
    SET status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_updated;

  ELSIF p_new_status = 'no_show' THEN
    UPDATE public.bookings
    SET status = 'no_show',
        dock_number = NULL,
        no_show_at = COALESCE(no_show_at, now()),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_updated;
  END IF;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_update_status(uuid, text, text) TO authenticated;

-- 17. ฟังก์ชัน RPC ฝั่งเจ้าหน้าที่: เพิ่มคิวหน้างาน (Walk-in) ผ่านกติกาตรวจโดคเดียวกัน
CREATE OR REPLACE FUNCTION public.staff_create_walkin(
  p_booking_date date,
  p_slot_hour integer,
  p_license_plate text,
  p_driver_name text,
  p_company text DEFAULT '',
  p_job_type text DEFAULT 'dropoff',
  p_notes text DEFAULT ''
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_settings public.settings%ROWTYPE;
  v_now_bkk timestamp;
  v_today_bkk date;
  v_plate text := btrim(coalesce(p_license_plate, ''));
  v_driver text := btrim(coalesce(p_driver_name, ''));
  v_company text := btrim(coalesce(p_company, ''));
  v_job_type text := btrim(coalesce(p_job_type, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_active_docks integer;
  v_slot_count integer;
  v_actor_type text;
  v_inserted public.bookings%ROWTYPE;
BEGIN
  IF NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เจ้าหน้าที่';
  END IF;

  IF char_length(v_plate) < 1 OR char_length(v_plate) > 20 THEN
    RAISE EXCEPTION 'กรุณากรอกทะเบียนรถให้ถูกต้อง (1-20 ตัวอักษร)';
  END IF;
  IF char_length(v_driver) < 1 OR char_length(v_driver) > 60 THEN
    RAISE EXCEPTION 'กรุณากรอกชื่อคนขับให้ถูกต้อง (1-60 ตัวอักษร)';
  END IF;
  IF char_length(v_company) > 80 THEN
    RAISE EXCEPTION 'ชื่อบริษัทต้องไม่เกิน 80 ตัวอักษร';
  END IF;
  IF char_length(v_notes) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร';
  END IF;
  IF v_job_type NOT IN ('pickup', 'dropoff') THEN
    RAISE EXCEPTION 'ประเภทงานไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_settings FROM public.settings WHERE id = 1;
  v_now_bkk := timezone('Asia/Bangkok', now());
  v_today_bkk := v_now_bkk::date;

  IF p_booking_date IS NULL OR p_booking_date < v_today_bkk THEN
    RAISE EXCEPTION 'ไม่สามารถเพิ่มคิวย้อนหลังได้';
  END IF;
  IF p_booking_date > (v_today_bkk + v_settings.advance_days) THEN
    RAISE EXCEPTION 'กำหนดวันเกินขอบเขต % วัน', v_settings.advance_days;
  END IF;
  IF p_booking_date = ANY(v_settings.holidays) THEN
    RAISE EXCEPTION 'วันที่เลือกเป็นวันหยุดโกดัง';
  END IF;
  IF p_slot_hour IS NULL OR p_slot_hour < v_settings.open_hour OR p_slot_hour >= v_settings.close_hour THEN
    RAISE EXCEPTION 'ช่วงเวลาอยู่นอกเวลาเปิดทำการ';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('booking:' || p_booking_date::text || ':' || p_slot_hour::text));

  v_active_docks := public.count_active_docks(v_settings.dock_count, v_settings.closed_docks);
  IF v_active_docks <= 0 THEN
    RAISE EXCEPTION 'ขณะนี้ไม่มีโดคเปิดให้บริการ';
  END IF;

  SELECT count(*)::integer INTO v_slot_count
  FROM public.bookings b
  WHERE b.booking_date = p_booking_date
    AND b.slot_hour = p_slot_hour
    AND b.is_deleted = false
    AND b.status NOT IN ('cancelled', 'no_show');

  IF v_slot_count >= v_active_docks THEN
    RAISE EXCEPTION 'ช่วงเวลานี้เต็มแล้ว ไม่สามารถเพิ่มคิวหน้างานได้';
  END IF;

  v_actor_type := CASE WHEN public.has_role('admin') THEN 'admin' ELSE 'staff' END;
  PERFORM set_config('app.actor_type', v_actor_type, true);
  PERFORM set_config('app.actor_email', coalesce(public.current_actor_email(), ''), true);
  PERFORM set_config('app.audit_reason', 'เพิ่มคิวหน้างาน (Walk-in)', true);

  INSERT INTO public.bookings (
    booking_date, slot_hour, license_plate, driver_name, company, job_type, status, notes, is_walk_in, arrived_at
  )
  VALUES (
    p_booking_date, p_slot_hour, v_plate, v_driver, v_company, v_job_type, 'arrived', v_notes, true, now()
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_create_walkin(date, integer, text, text, text, text, text) TO authenticated;

-- 18. ฟังก์ชัน RPC ฝั่งแอดมิน: แก้ไข / ย้ายวัน-เวลา / ย้อนสถานะ (บังคับเหตุผล)
CREATE OR REPLACE FUNCTION public.admin_update_booking(
  p_booking_id uuid,
  p_booking_date date,
  p_slot_hour integer,
  p_license_plate text,
  p_driver_name text,
  p_company text,
  p_job_type text,
  p_status text,
  p_dock_number integer,
  p_notes text,
  p_reason text
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_old public.bookings%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_now_bkk timestamp;
  v_today_bkk date;
  v_plate text := btrim(coalesce(p_license_plate, ''));
  v_driver text := btrim(coalesce(p_driver_name, ''));
  v_company text := btrim(coalesce(p_company, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_active_docks integer;
  v_slot_count integer;
  v_dock integer := p_dock_number;
  v_schedule_changed boolean;
  v_reactivated boolean;
  v_updated public.bookings%ROWTYPE;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น';
  END IF;

  IF char_length(v_reason) = 0 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลในการแก้ไขข้อมูลหรือสถานะ';
  END IF;

  IF char_length(v_plate) < 1 OR char_length(v_plate) > 20 THEN
    RAISE EXCEPTION 'ทะเบียนรถไม่ถูกต้อง (1-20 ตัวอักษร)';
  END IF;
  IF char_length(v_driver) < 1 OR char_length(v_driver) > 60 THEN
    RAISE EXCEPTION 'ชื่อคนขับไม่ถูกต้อง (1-60 ตัวอักษร)';
  END IF;
  IF char_length(v_company) > 80 THEN
    RAISE EXCEPTION 'ชื่อบริษัทต้องไม่เกิน 80 ตัวอักษร';
  END IF;
  IF char_length(v_notes) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร';
  END IF;
  IF p_job_type NOT IN ('pickup', 'dropoff') THEN
    RAISE EXCEPTION 'ประเภทงานไม่ถูกต้อง';
  END IF;
  IF p_status NOT IN ('booked', 'arrived', 'called', 'loading', 'completed', 'no_show', 'cancelled') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_old
  FROM public.bookings b
  WHERE b.id = p_booking_id AND b.is_deleted = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการคิวนี้';
  END IF;

  SELECT * INTO v_settings FROM public.settings WHERE id = 1;
  v_now_bkk := timezone('Asia/Bangkok', now());
  v_today_bkk := v_now_bkk::date;

  v_schedule_changed := (p_booking_date IS DISTINCT FROM v_old.booking_date) OR (p_slot_hour IS DISTINCT FROM v_old.slot_hour);
  v_reactivated := (v_old.status IN ('cancelled', 'no_show')) AND (p_status NOT IN ('cancelled', 'no_show'));

  -- ถ้าย้ายวัน-เวลา หรือดึงคิวที่ยกเลิก/ไม่มากลับมาใช้งาน ต้องตรวจกติกาโดคฝั่งเซิร์ฟเวอร์
  IF (v_schedule_changed OR v_reactivated) AND p_status NOT IN ('cancelled', 'no_show') THEN
    IF p_booking_date < v_today_bkk THEN
      RAISE EXCEPTION 'ไม่สามารถย้ายคิวไปวันที่ผ่านมาแล้วได้';
    END IF;
    IF p_booking_date > (v_today_bkk + v_settings.advance_days) THEN
      RAISE EXCEPTION 'ย้ายคิวได้ไม่เกิน % วันล่วงหน้า', v_settings.advance_days;
    END IF;
    IF p_booking_date = ANY(v_settings.holidays) THEN
      RAISE EXCEPTION 'วันที่เลือกเป็นวันหยุดโกดัง';
    END IF;
    IF p_slot_hour < v_settings.open_hour OR p_slot_hour >= v_settings.close_hour THEN
      RAISE EXCEPTION 'ช่วงเวลาอยู่นอกเวลาเปิดทำการ';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('booking:' || p_booking_date::text || ':' || p_slot_hour::text));

    v_active_docks := public.count_active_docks(v_settings.dock_count, v_settings.closed_docks);
    IF v_active_docks <= 0 THEN
      RAISE EXCEPTION 'ขณะนี้ไม่มีโดคเปิดให้บริการ';
    END IF;

    SELECT count(*)::integer INTO v_slot_count
    FROM public.bookings b
    WHERE b.booking_date = p_booking_date
      AND b.slot_hour = p_slot_hour
      AND b.is_deleted = false
      AND b.status NOT IN ('cancelled', 'no_show')
      AND b.id <> p_booking_id;

    IF v_slot_count >= v_active_docks THEN
      RAISE EXCEPTION 'ช่วงเวลาปลายทางเต็มแล้ว ไม่สามารถย้ายคิวได้';
    END IF;
  END IF;

  -- จัดการโดคเมื่อสถานะเป็น called / loading
  IF p_status IN ('called', 'loading') THEN
    PERFORM pg_advisory_xact_lock(hashtext('dock_assignment'));
    IF v_dock IS NULL THEN
      SELECT d.num INTO v_dock
      FROM generate_series(1, v_settings.dock_count) AS d(num)
      WHERE NOT (d.num = ANY(coalesce(v_settings.closed_docks, '{}')))
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings occ
          WHERE occ.is_deleted = false
            AND occ.status IN ('called', 'loading')
            AND occ.dock_number = d.num
            AND occ.id <> p_booking_id
        )
      ORDER BY d.num ASC
      LIMIT 1;
      IF v_dock IS NULL THEN
        RAISE EXCEPTION 'โดคเต็ม รอให้มีโดคว่างก่อนกำหนดเข้าโดค';
      END IF;
    ELSE
      IF v_dock < 1 OR v_dock > v_settings.dock_count OR (v_dock = ANY(coalesce(v_settings.closed_docks, '{}'))) THEN
        RAISE EXCEPTION 'โดคที่เลือกไม่พร้อมใช้งาน';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.bookings occ
        WHERE occ.is_deleted = false
          AND occ.status IN ('called', 'loading')
          AND occ.dock_number = v_dock
          AND occ.id <> p_booking_id
      ) THEN
        RAISE EXCEPTION 'โดค % มีรถใช้งานอยู่แล้ว', v_dock;
      END IF;
    END IF;
  ELSIF p_status IN ('booked', 'arrived', 'cancelled', 'no_show') THEN
    v_dock := NULL;
  END IF;

  PERFORM set_config('app.actor_type', 'admin', true);
  PERFORM set_config('app.actor_email', coalesce(public.current_actor_email(), ''), true);
  PERFORM set_config('app.audit_reason', v_reason, true);

  UPDATE public.bookings
  SET booking_date = p_booking_date,
      slot_hour = p_slot_hour,
      license_plate = v_plate,
      driver_name = v_driver,
      company = v_company,
      job_type = p_job_type,
      status = p_status,
      dock_number = v_dock,
      notes = v_notes,
      arrived_at = CASE WHEN p_status IN ('arrived','called','loading','completed') THEN COALESCE(arrived_at, now()) WHEN p_status = 'booked' THEN NULL ELSE arrived_at END,
      called_at = CASE WHEN p_status IN ('called','loading','completed') THEN COALESCE(called_at, now()) WHEN p_status IN ('booked','arrived') THEN NULL ELSE called_at END,
      loading_at = CASE WHEN p_status IN ('loading','completed') THEN COALESCE(loading_at, now()) WHEN p_status IN ('booked','arrived','called') THEN NULL ELSE loading_at END,
      completed_at = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE NULL END,
      no_show_at = CASE WHEN p_status = 'no_show' THEN COALESCE(no_show_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid, date, integer, text, text, text, text, text, integer, text, text) TO authenticated;

-- 19. ฟังก์ชัน RPC ฝั่งแอดมิน: ลบคิวแบบ Soft Delete (บังคับเหตุผล)
CREATE OR REPLACE FUNCTION public.admin_soft_delete_booking(
  p_booking_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น';
  END IF;

  IF char_length(v_reason) = 0 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลในการลบรายการ';
  END IF;

  PERFORM set_config('app.actor_type', 'admin', true);
  PERFORM set_config('app.actor_email', coalesce(public.current_actor_email(), ''), true);
  PERFORM set_config('app.audit_reason', v_reason, true);

  UPDATE public.bookings
  SET is_deleted = true,
      deleted_at = now(),
      deleted_reason = v_reason,
      updated_at = now()
  WHERE id = p_booking_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการคิว หรือถูกลบไปแล้ว';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_soft_delete_booking(uuid, text) TO authenticated;

-- 20. ฟังก์ชัน RPC ฝั่งแอดมิน: อัปเดตการตั้งค่าโกดัง
CREATE OR REPLACE FUNCTION public.admin_update_settings(
  p_dock_count integer,
  p_dock_names jsonb,
  p_closed_docks integer[],
  p_open_hour integer,
  p_close_hour integer,
  p_advance_days integer,
  p_notify_minutes integer,
  p_holidays date[],
  p_public_app_url text DEFAULT NULL,
  p_reason text DEFAULT 'อัปเดตการตั้งค่าโกดัง'
)
RETURNS public.settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_updated public.settings%ROWTYPE;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น';
  END IF;

  IF p_dock_count < 1 OR p_dock_count > 12 THEN
    RAISE EXCEPTION 'จำนวนโดคต้องอยู่ระหว่าง 1 ถึง 12';
  END IF;
  IF p_open_hour < 0 OR p_open_hour > 22 OR p_close_hour < 1 OR p_close_hour > 23 OR p_close_hour <= p_open_hour THEN
    RAISE EXCEPTION 'เวลาเปิด-ปิดไม่ถูกต้อง';
  END IF;
  IF p_advance_days < 0 OR p_advance_days > 60 THEN
    RAISE EXCEPTION 'จำนวนวันจองล่วงหน้าต้องอยู่ระหว่าง 0 ถึง 60 วัน';
  END IF;
  IF p_notify_minutes < 5 OR p_notify_minutes > 180 THEN
    RAISE EXCEPTION 'เวลาแจ้งเตือนต้องอยู่ระหว่าง 5 ถึง 180 นาที';
  END IF;

  PERFORM set_config('app.actor_type', 'admin', true);
  PERFORM set_config('app.actor_email', coalesce(public.current_actor_email(), ''), true);
  PERFORM set_config('app.audit_reason', coalesce(nullif(btrim(p_reason), ''), 'อัปเดตการตั้งค่าโกดัง'), true);

  UPDATE public.settings
  SET dock_count = p_dock_count,
      dock_names = coalesce(p_dock_names, '[]'::jsonb),
      closed_docks = coalesce(p_closed_docks, '{}'),
      open_hour = p_open_hour,
      close_hour = p_close_hour,
      advance_days = p_advance_days,
      notify_minutes = p_notify_minutes,
      holidays = coalesce(p_holidays, '{}'),
      public_app_url = CASE WHEN p_public_app_url IS NULL THEN public_app_url ELSE btrim(p_public_app_url) END,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_settings(integer, jsonb, integer[], integer, integer, integer, integer, date[], text, text) TO authenticated;

-- ============================================================================
-- ขั้นตอนกำหนดสิทธิ์แอดมินคนแรก (รันหลังจากสร้างผู้ใช้ใน Authentication > Users แล้ว)
-- แทนที่ 'Admin01@gmail.com' ด้วยอีเมลแอดมินที่คุณสร้างไว้ (หากใช้อีเมลอื่น)
-- ============================================================================
/*
INSERT INTO public.user_roles (user_id, email, role, is_active)
SELECT id, email, 'admin', true
FROM auth.users
WHERE lower(email) = lower('Admin01@gmail.com')
ON CONFLICT (user_id) DO UPDATE
SET role = 'admin', is_active = true, email = EXCLUDED.email, updated_at = now();
*/
