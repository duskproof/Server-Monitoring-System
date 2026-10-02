'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api } from '@/lib/api';
import { clearTokens, getAccessToken, setTokens } from '@/lib/session';
import { disconnectSocket, reconnectSocket } from '@/lib/socket';
import type { LoginPayload, RegisterPayload, Role, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  /** True once the persisted state has been rehydrated in the browser. */
  hydrated: boolean;
  /** True while the session is being revalidated against the API. */
  initializing: boolean;
  login: (payload: LoginPayload) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => void;
  setUser: (user: User | null) => void;
  setHydrated: () => void;
  /** Revalidates the persisted session against `GET /auth/me`. */
  bootstrap: () => Promise<User | null>;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      hydrated: false,
      initializing: true,

      login: async (payload) => {
        const result = await api.auth.login(payload);
        setTokens(result.accessToken, result.refreshToken);
        set({ user: result.user, initializing: false });
        reconnectSocket();
        return result.user;
      },

      register: async (payload) => {
        const result = await api.auth.register(payload);
        setTokens(result.accessToken, result.refreshToken);
        set({ user: result.user, initializing: false });
        reconnectSocket();
        return result.user;
      },

      logout: () => {
        clearTokens();
        disconnectSocket();
        set({ user: null, initializing: false });
      },

      setUser: (user) => set({ user }),

      setHydrated: () => set({ hydrated: true }),

      bootstrap: async () => {
        if (!getAccessToken()) {
          set({ user: null, initializing: false });
          return null;
        }
        try {
          const user = await api.auth.me();
          set({ user, initializing: false });
          return user;
        } catch {
          set({ user: null, initializing: false });
          return null;
        }
      },

      hasRole: (...roles) => {
        const { user } = get();
        return user !== null && roles.includes(user.role);
      },
    }),
    {
      name: 'vpsguard.auth',
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

/** Convenience selectors for role-gated UI. */
export function useIsAdmin(): boolean {
  return useAuthStore((state) => state.user?.role === 'admin');
}

export function useCanOperate(): boolean {
  return useAuthStore((state) => state.user?.role === 'admin' || state.user?.role === 'operator');
}
