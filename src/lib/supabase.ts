import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publishedAppUrl: string;
}

let cachedConfig: PublicConfig | null = null;
let configPromise: Promise<PublicConfig> | null = null;
let supabaseInstance: SupabaseClient | null = null;

function cleanValue(val: string | undefined): string {
  return (val || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const cleaned = cleanValue(raw);
  if (!cleaned) return '';
  try {
    return new URL(cleaned).origin;
  } catch {
    return cleaned.replace(/\/rest\/v1\/?.*$/i, '').replace(/\/+$/, '');
  }
}

export async function getPublicConfig(): Promise<PublicConfig> {
  if (cachedConfig) return cachedConfig;
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const res = await fetch('/api/public-config', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as Partial<PublicConfig>;
          cachedConfig = {
            supabaseUrl: normalizeSupabaseUrl(data.supabaseUrl || import.meta.env.VITE_SUPABASE_URL),
            supabaseAnonKey: cleanValue(data.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY),
            publishedAppUrl: cleanValue(data.publishedAppUrl),
          };
          return cachedConfig;
        }
      } catch {
        // Fallback to Vite env if server endpoint unreachable
      }
      cachedConfig = {
        supabaseUrl: normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL),
        supabaseAnonKey: cleanValue(import.meta.env.VITE_SUPABASE_ANON_KEY),
        publishedAppUrl: '',
      };
      return cachedConfig;
    })();
  }
  return configPromise;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseInstance) return supabaseInstance;
  const cfg = await getPublicConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return null;
  }
  supabaseInstance = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return supabaseInstance;
}
