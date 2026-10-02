'use client';

import { KeyRound, Moon, Save, Sun, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';

export function ProfileTab() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
  }, [user]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api.auth.updateProfile({ name: name.trim(), email: email.trim() });
      setUser(updated);
      toast.success('Profile updated');
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to update your profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordError('The new password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordError(undefined);
    setSavingPassword(true);

    try {
      await api.auth.updateProfile({ currentPassword, password: newPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to change the password'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Account details"
          description="Shown across the dashboard and in the audit log"
          icon={<UserCog className="h-4 w-4" />}
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="primary" className="capitalize">
              {user?.role ?? 'unknown'}
            </Badge>
            <span>Member since {formatDateTime(user?.createdAt)}</span>
          </div>

          <Input label="Full name" value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint="Used for sign-in and e-mail notifications."
          />

          <Button onClick={saveProfile} loading={savingProfile} leftIcon={<Save className="h-4 w-4" />}>
            Save changes
          </Button>
        </CardBody>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Change password"
            description="Use at least 8 characters"
            icon={<KeyRound className="h-4 w-4" />}
          />
          <CardBody className="space-y-4">
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={passwordError}
            />
            <Button onClick={savePassword} loading={savingPassword} leftIcon={<KeyRound className="h-4 w-4" />}>
              Update password
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Appearance"
            description="Your preference is stored on this device"
            icon={theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          />
          <CardBody>
            <div className="flex gap-2">
              <Button
                variant={theme === 'dark' ? 'primary' : 'outline'}
                leftIcon={<Moon className="h-4 w-4" />}
                onClick={() => setTheme('dark')}
              >
                Dark
              </Button>
              <Button
                variant={theme === 'light' ? 'primary' : 'outline'}
                leftIcon={<Sun className="h-4 w-4" />}
                onClick={() => setTheme('light')}
              >
                Light
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
