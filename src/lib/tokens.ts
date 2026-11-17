const TOKENS_KEY = 'warehouse_queue_tokens_v1';
const CLIENT_KEY = 'warehouse_client_fingerprint_v1';
const THEME_KEY = 'warehouse_theme_v1';

export function getSavedTokenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getSavedTokens(): string[] {
  return Object.values(getSavedTokenMap()).filter((v) => typeof v === 'string' && v.length > 0);
}

export function saveBookingToken(bookingId: string, token: string): void {
  const map = getSavedTokenMap();
  map[bookingId] = token;
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function getTokenForBooking(bookingId: string): string | null {
  const map = getSavedTokenMap();
  return map[bookingId] || null;
}

export function getClientFingerprint(): string {
  try {
    let existing = localStorage.getItem(CLIENT_KEY);
    if (!existing) {
      existing =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `drv_${Math.random().toString(36).slice(2)}_${Date.now()}`;
      localStorage.setItem(CLIENT_KEY, existing);
    }
    return existing;
  } catch {
    return 'drv_fallback';
  }
}

export function getStoredTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

export function setStoredTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}
