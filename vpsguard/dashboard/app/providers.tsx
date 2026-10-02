'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'react-hot-toast';

import { GlobalAlertListener } from '@/components/GlobalAlertListener';
import { ApiError } from '@/lib/api';
import { useUiStore } from '@/store/ui';

export function Providers({ children }: { children: ReactNode }) {
  const theme = useUiStore((state) => state.theme);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Auth failures are handled by the fetch wrapper — never retry them.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  // Keeps the <html> class in sync when the store rehydrates after mount.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <GlobalAlertListener />
      <Toaster
        position="top-right"
        gutter={10}
        toastOptions={{
          duration: 4500,
          style: {
            background: 'hsl(var(--surface))',
            color: 'hsl(var(--content))',
            border: '1px solid hsl(var(--line))',
            borderRadius: '12px',
            fontSize: '14px',
            maxWidth: '420px',
          },
          success: { iconTheme: { primary: 'hsl(var(--success))', secondary: 'hsl(var(--surface))' } },
          error: { iconTheme: { primary: 'hsl(var(--danger))', secondary: 'hsl(var(--surface))' } },
        }}
      />
    </QueryClientProvider>
  );
}
