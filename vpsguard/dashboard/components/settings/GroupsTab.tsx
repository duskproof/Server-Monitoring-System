'use client';

import { FolderTree, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCreateGroup, useDeleteGroup, useGroups } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import type { ServerGroup } from '@/lib/types';
import { useCanOperate } from '@/store/auth';

export function GroupsTab() {
  const groupsQuery = useGroups();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();
  const canOperate = useCanOperate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<ServerGroup | null>(null);

  const submit = async () => {
    if (name.trim().length < 2) {
      setNameError('Enter a group name');
      return;
    }
    setNameError(undefined);

    try {
      await createGroup.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Server groups"
          description="Group servers to target alert rules and filters"
          icon={<FolderTree className="h-4 w-4" />}
        />
        {groupsQuery.isLoading ? (
          <CardBody className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </CardBody>
        ) : groupsQuery.isError ? (
          <CardBody>
            <ErrorState description={errorMessage(groupsQuery.error, 'Groups could not be loaded.')} />
          </CardBody>
        ) : (groupsQuery.data ?? []).length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<FolderTree className="h-5 w-5" />}
              title="No groups yet"
              description="Create your first group, for example “Production” or “Databases”."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {(groupsQuery.data ?? []).map((group) => (
              <li key={group.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-content">{group.name}</p>
                  <p className="truncate text-xs text-muted">
                    {group.description || 'No description'} · {group.serverCount} server
                    {group.serverCount === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canOperate}
                  onClick={() => setPendingDelete(group)}
                  aria-label={`Delete ${group.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="New group" description="Groups are optional but keep large fleets tidy" />
        <CardBody className="space-y-4">
          <Input
            label="Name"
            placeholder="Production"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            disabled={!canOperate}
          />
          <Textarea
            label="Description"
            placeholder="Customer-facing web servers"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!canOperate}
          />
          <Button
            onClick={submit}
            loading={createGroup.isPending}
            disabled={!canOperate}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Create group
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete group"
        destructive
        loading={deleteGroup.isPending}
        confirmLabel="Delete"
        message={
          <>
            Delete <strong className="text-content">{pendingDelete?.name}</strong>? Servers stay registered but lose
            their group assignment.
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteGroup.mutateAsync(pendingDelete.id).catch(() => undefined);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
