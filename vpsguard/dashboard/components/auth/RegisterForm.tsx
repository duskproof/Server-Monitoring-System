'use client';

import { Lock, Mail, UserPlus, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function RegisterForm() {
  const router = useRouter();
  const register = useAuthStore((state) => state.register);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (name.trim().length < 2) next.name = 'Enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid e-mail address';
    if (password.length < 8) next.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) next.confirmPassword = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password });
      toast.success('Account created — welcome to VPSGuard');
      router.replace('/');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Registration failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Input
        label="Full name"
        autoComplete="name"
        placeholder="Ada Lovelace"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        icon={<UserIcon className="h-4 w-4" />}
        required
      />
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
        autoComplete="new-password"
        placeholder="At least 8 characters"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        icon={<Lock className="h-4 w-4" />}
        required
      />
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={errors.confirmPassword}
        icon={<Lock className="h-4 w-4" />}
        required
      />

      <Button
        type="submit"
        className="w-full"
        size="lg"
        loading={submitting}
        leftIcon={<UserPlus className="h-4 w-4" />}
      >
        Create account
      </Button>
    </form>
  );
}
