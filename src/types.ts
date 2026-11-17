export type JobType = 'pickup' | 'dropoff';

export type BookingStatus =
  | 'booked'
  | 'arrived'
  | 'called'
  | 'loading'
  | 'completed'
  | 'no_show'
  | 'cancelled';

export interface WarehouseSettings {
  id: number;
  dock_count: number;
  dock_names: string[];
  closed_docks: number[];
  open_hour: number;
  close_hour: number;
  advance_days: number;
  notify_minutes: number;
  holidays: string[];
  public_app_url: string;
  updated_at: string;
}

export interface PublicBooking {
  id: string;
  booking_date: string;
  slot_hour: number;
  license_plate: string;
  masked_driver_name: string;
  company: string;
  job_type: JobType;
  status: BookingStatus;
  dock_number: number | null;
  is_walk_in: boolean;
  created_at: string;
  arrived_at: string | null;
  called_at: string | null;
  loading_at: string | null;
  completed_at: string | null;
}

export interface MyBooking {
  id: string;
  booking_date: string;
  slot_hour: number;
  license_plate: string;
  driver_name: string;
  company: string;
  job_type: JobType;
  status: BookingStatus;
  dock_number: number | null;
  secret_token: string;
  created_at: string;
  arrived_at: string | null;
  called_at: string | null;
  loading_at: string | null;
  completed_at: string | null;
}

export interface StaffBooking {
  id: string;
  booking_date: string;
  slot_hour: number;
  license_plate: string;
  driver_name: string;
  company: string;
  job_type: JobType;
  status: BookingStatus;
  dock_number: number | null;
  notes: string;
  is_walk_in: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_reason: string | null;
  created_at: string;
  updated_at: string;
  arrived_at: string | null;
  called_at: string | null;
  loading_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
}

export interface BookingEvent {
  id: string;
  booking_id: string | null;
  entity_type: 'booking' | 'settings' | 'user';
  entity_id: string;
  event_type: string;
  actor_type: 'driver' | 'staff' | 'admin' | 'system';
  actor_email: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface UserRoleRecord {
  user_id: string;
  email: string;
  role: 'admin' | 'staff';
  is_active: boolean;
}

export interface AdminUserItem {
  user_id: string;
  email: string;
  role: 'admin' | 'staff';
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string;
  email_confirmed_at: string | null;
}
