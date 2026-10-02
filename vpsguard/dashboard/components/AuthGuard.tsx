'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';
import { getAccessToken } from '@/lib/session';
import { useAuthStore } from '@/store/auth';

/**
 * Client-side counterpart of `middleware.ts`: validates the stored session
 * against the API and keeps the user object fresh on every full page load.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const user = useAuthStore((state) => state.user);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    if (!getAccessToken()) {
      router.replace('/login');
      return () => {
        active = false;
      };
    }

    void bootstrap().then((result) => {
      if (!active) return;
      if (!result) {
        router.replace('/login');
        return;
      }
      setChecked(true);
    });

    return () => {
      active = false;
    };
  }, [bootstrap, router]);

  if (!checked && !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
