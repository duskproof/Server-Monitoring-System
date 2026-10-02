'use client';

import { AlertOctagon, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[VPSGuard] Unhandled application error', error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-danger">
          <AlertOctagon className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-content">Unexpected error</h1>
        <p className="mt-2 text-sm text-muted">
          {error.message || 'The dashboard hit an unexpected problem while rendering this page.'}
        </p>
        {error.digest ? <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p> : null}
        <Button className="mt-6 w-full" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={reset}>
          Reload the page
        </Button>
      </div>
    </div>
  );
}
