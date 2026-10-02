'use client';

import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { useDeleteUser, useSaveUser, useUsers } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { Role, User, UserInput } from '@/lib/types';
import { useAuthStore } from '@/store/auth';

const ROLE_TONE: Record<Role, BadgeTone> = {
  admin: 'danger',
  operator: 'primary',
  viewer: 'neutral',
};

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer — read-only in this cabinet' },
  { value: 'operator', label: 'Operator — can run commands' },
  { value: 'admin', label: 'Admin — full control of this cabinet' },
];

const EMPTY_FORM: UserInput = { name: '', email: '', role: 'viewer', password: '' };

export function UsersTab() {
  const currentUser = useAuthStore((state) => state.user);
  const usersQuery = useUsers();
  const saveUser = useSaveUser();
  const deleteUser = useDeleteUser();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      setForm({ name: editing.name, email: editing.email, role: editing.role, password: '' });
    } else {
      setForm(EMPTY_FORM);
    }
    setErrors({});
  }, [editing, modalOpen]);

  const openModal = (user: User | null) => {
    setEditing(user);
    setModalOpen(true);
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = 'Enter a name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid e-mail address';
    if (!editing && (form.password ?? '').length < 8) next.password = 'Set a password of at least 8 characters';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: UserInput = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
    };
    if (form.password) payload.password = form.password;

    try {
      await saveUser.mutateAsync({ id: editing?.id, payload });
      setModalOpen(false);
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  if (usersQuery.isLoading) return <SkeletonTable rows={5} columns={5} />;

  if (usersQuery.isError) {
    return (
      <ErrorState
        title="Users could not be loaded"
        description={errorMessage(usersQuery.error, 'Only administrators can manage users.')}
        action={
          <Button variant="outline" size="sm" onClick={() => void usersQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Users in your cabinet only. {users.length} account
          {users.length === 1 ? '' : 's'} — other cabinets stay separate.
        </p>
        <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => openModal(null)}>
          Invite user
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No users yet"
          description="Add teammates to this cabinet and assign viewer, operator, or admin roles."
        />
      ) : (
        <TableWrapper>
          <Table className="min-w-[760px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Name</TH>
                <TH>E-mail</TH>
                <TH>Role</TH>
                <TH>Last login</TH>
                <TH>Created</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <TR key={user.id}>
                  <TD className="font-medium text-content">
                    {user.name}
                    {user.id === currentUser?.id ? (
                      <Badge tone="info" className="ml-2">
                        you
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-xs text-muted">{user.email}</TD>
                  <TD>
                    <Badge tone={ROLE_TONE[user.role]} className="capitalize">
                      {user.role}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-muted">
                    {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'never'}
                  </TD>
                  <TD className="text-xs text-muted">{formatDateTime(user.createdAt)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => openModal(user)} aria-label={`Edit ${user.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={user.id === currentUser?.id}
                        title={user.id === currentUser?.id ? 'You cannot delete your own account' : 'Delete user'}
                        onClick={() => setPendingDelete(user)}
                        aria-label={`Delete ${user.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit user' : 'Invite user'}
        description={
          editing ? 'Update the profile or change the assigned role.' : 'Create an account and share the credentials.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saveUser.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saveUser.isPending}>
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Full name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            error={errors.name}
          />
          <Input
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            error={errors.email}
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}
            options={ROLE_OPTIONS}
          />
          <Input
            label={editing ? 'New password (optional)' : 'Password'}
            type="password"
            autoComplete="new-password"
            value={form.password ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            error={errors.password}
            hint={editing ? 'Leave empty to keep the current password.' : 'At least 8 characters.'}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete user"
        destructive
        loading={deleteUser.isPending}
        confirmLabel="Delete"
        message={
          <>
            Remove <strong className="text-content">{pendingDelete?.email}</strong> from this workspace? Their sessions
            are revoked immediately.
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteUser.mutateAsync(pendingDelete.id).catch(() => undefined);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
