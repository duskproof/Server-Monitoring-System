'use client';

import { BellRing, ChevronDown, LogOut, Menu, Moon, Sun, User as UserIcon, Wifi, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAlerts } from '@/hooks/queries';
import { useSocketStatus } from '@/hooks/useSocket';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';

const TITLES: Array<{ match: (path: string) => boolean; title: string }> = [
  { match: (path) => path === '/', title: 'Overview' },
  { match: (path) => path.startsWith('/servers'), title: 'Servers' },
  { match: (path) => path.startsWith('/alerts'), title: 'Alerts' },
  { match: (path) => path.startsWith('/settings'), title: 'Settings' },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const setMobileNav = useUiStore((state) => state.setMobileNav);
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const connected = useSocketStatus();

  const { data: firingAlerts } = useAlerts('firing');
  const firingCount = firingAlerts?.length ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const title = TITLES.find((entry) => entry.match(pathname))?.title ?? 'DuskProof Guard';

  const onLogout = () => {
    logout();
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={() => setMobileNav(true)}
        className="focus-ring rounded-lg p-2 text-muted hover:bg-elevated hover:text-content lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="truncate text-base font-semibold text-content sm:text-lg">{title}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex',
            connected ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning',
          )}
          title={connected ? 'Live updates connected' : 'Reconnecting to the live gateway'}
        >
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {connected ? 'Live' : 'Offline'}
        </span>

        <Link
          href="/alerts"
          className="focus-ring relative rounded-lg p-2 text-muted transition-colors hover:bg-elevated hover:text-content"
          aria-label={`Alerts${firingCount > 0 ? ` (${firingCount} firing)` : ''}`}
        >
          <BellRing className="h-5 w-5" />
          {firingCount > 0 ? (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {firingCount > 9 ? '9+' : firingCount}
            </span>
          ) : null}
        </Link>

        <button
          type="button"
          onClick={toggleTheme}
          className="focus-ring rounded-lg p-2 text-muted transition-colors hover:bg-elevated hover:text-content"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="focus-ring flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-elevated"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {user ? initialsOf(user.name || user.email) : '?'}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[10rem] truncate text-sm font-medium text-content">
                {user?.organizationName || user?.name || user?.email || 'Cabinet'}
              </span>
              <span className="block text-xs capitalize text-muted">
                {user?.role ?? '—'}
                {user?.organizationName ? ` · ${user.name || user.email}` : ''}
              </span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+8px)] w-56 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
            >
              <div className="border-b border-line px-4 py-3">
                {user?.organizationName ? (
                  <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">
                    {user.organizationName}
                  </p>
                ) : null}
                <p className="truncate text-sm font-medium text-content">{user?.name || 'Account'}</p>
                <p className="truncate text-xs text-muted">{user?.email}</p>
              </div>
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-content"
                role="menuitem"
              >
                <UserIcon className="h-4 w-4" />
                Profile &amp; settings
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-danger transition-colors hover:bg-danger/10"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
