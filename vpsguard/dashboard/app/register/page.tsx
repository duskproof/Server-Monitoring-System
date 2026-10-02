import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/AuthCard';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create account',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start monitoring your fleet in a couple of minutes."
      footer={
        <>
          Already registered?{' '}
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
