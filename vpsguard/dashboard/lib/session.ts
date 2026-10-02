/**
 * Token storage shared by the API client and the auth store.
 *
 * Tokens live in localStorage (readable by the fetch wrapper without React),
 * while a lightweight flag cookie is mirrored so that `middleware.ts` can
 * redirect unauthenticated visitors before any JavaScript runs.
 */

const ACCESS_KEY = 'vpsguard.accessToken';
const REFRESH_KEY = 'vpsguard.refreshToken';

export const SESSION_COOKIE = 'vpsguard_session';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const isBrowser = (): boolean => typeof window !== 'undefined';

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearTokens(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function hasSession(): boolean {
  return getAccessToken() !== null;
}
