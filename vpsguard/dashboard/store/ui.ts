'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  /** Desktop sidebar collapsed to icons only. */
  sidebarCollapsed: boolean;
  /** Mobile drawer visibility (never persisted). */
  mobileNavOpen: boolean;
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setHydrated: () => void;
}

/** Applies the Tailwind `dark` class strategy to the document root. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      mobileNavOpen: false,
      hydrated: false,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
      },

      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

      setMobileNav: (open) => set({ mobileNavOpen: open }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'vpsguard.ui',
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyTheme(state.theme);
        state.setHydrated();
      },
    },
  ),
);
