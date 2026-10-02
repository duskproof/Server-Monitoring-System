'use client';

import { BellRing, ChevronLeft, LayoutDashboard, Server, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { BrandMark } from '@/components/BrandMark';
import { useAlerts } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Exact match only — used for the overview root route. */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/cabinet', label: 'Overview', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, exact: true },
  { href: '/cabinet/servers', label: 'Servers', icon: <Server className="h-[18px] w-[18px]" /> },
  { href: '/cabinet/alerts', label: 'Alerts', icon: <BellRing className="h-[18px] w-[18px]" /> },
  { href: '/cabinet/settings', label: 'Settings', icon: <Settings className="h-[18px] w-[18px]" /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const mobileOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNav = useUiStore((state) => state.setMobileNav);

  const { data: firingAlerts } = useAlerts('firing');
  const firingCount = firingAlerts?.length ?? 0;

  // Close the mobile drawer whenever navigation occurs.
  useEffect(() => {
    setMobileNav(false);
  }, [pathname, setMobileNav]);

  const isActive = (item: NavItem): boolean =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
              'focus-ring group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/15 text-primary shadow-sm shadow-primary/10'
                : 'text-muted hover:bg-elevated hover:text-content',
              collapsed && 'lg:justify-center lg:px-2',
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className={cn('flex-1 truncate', collapsed && 'lg:hidden')}>{item.label}</span>
            {item.href === '/cabinet/alerts' && firingCount > 0 ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white',
                  collapsed && 'lg:hidden',
                )}
              >
                {firingCount > 99 ? '99+' : firingCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <div className={cn('flex h-16 items-center border-b border-line px-4', collapsed && 'justify-center px-2')}>
          <BrandMark compact={collapsed} />
        </div>

        {nav}

        <button
          type="button"
          onClick={toggleSidebar}
          className="focus-ring m-3 flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted transition-colors hover:bg-elevated hover:text-content"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
          {!collapsed ? 'Collapse' : null}
        </button>
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/60 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMobileNav(false)}
        />
        <aside
          className={cn(
            'absolute left-0 top-0 flex h-full w-72 flex-col border-r border-line bg-surface transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-line px-4">
            <BrandMark />
            <button
              type="button"
              onClick={() => setMobileNav(false)}
              className="focus-ring rounded-lg p-2 text-muted hover:bg-elevated hover:text-content"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {nav}
        </aside>
      </div>
    </>
  );
}
