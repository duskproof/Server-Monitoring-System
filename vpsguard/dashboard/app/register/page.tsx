import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/AuthCard';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create cabinet',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your cabinet"
      subtitle="Open a private workspace for your servers. Other cabinets stay invisible."
      footer={
        <>
          Already have a cabinet?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
