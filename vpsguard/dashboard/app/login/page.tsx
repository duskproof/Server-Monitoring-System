import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AuthShell } from '@/components/AuthCard';
import { LoginForm } from '@/components/auth/LoginForm';
import { Skeleton } from '@/components/ui/Skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your cabinet and monitored servers."
      footer={
        <>
          Need your own workspace?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create a cabinet
          </Link>
        </>
      }
    >
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
