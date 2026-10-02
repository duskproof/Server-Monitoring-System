'use client';

import { Lock, LogIn, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = (): boolean => {
    const next: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid e-mail address';
    if (password.length < 8) next.password = 'Password must be at least 8 characters';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const user = await login({ email: email.trim(), password });
      toast.success(`Welcome back, ${user.name || user.email}`);
      const next = searchParams.get('next');
      router.replace(next && next.startsWith('/') ? next : '/cabinet');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Sign-in failed. Check your credentials.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
        icon={<Mail className="h-4 w-4" />}
        required
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        icon={<Lock className="h-4 w-4" />}
        required
      />

      <Button
        type="submit"
        className="w-full"
        size="lg"
        loading={submitting}
        leftIcon={<LogIn className="h-4 w-4" />}
      >
        Sign in
      </Button>
    </form>
  );
}
