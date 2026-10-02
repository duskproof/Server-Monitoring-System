import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/AuthCard';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Create workspace',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your workspace"
      subtitle="A private space for your servers. Other workspaces stay invisible."
      footer={
        <>
          Already have a workspace?{' '}
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
