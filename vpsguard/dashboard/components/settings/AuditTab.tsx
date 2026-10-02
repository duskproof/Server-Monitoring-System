'use client';

import { useMemo, useState } from 'react';

import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { useAuditLogs } from '@/hooks/queries';
import { formatDateTime, formatRelative } from '@/lib/format';

function summariseDetails(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const entries = Object.entries(details as Record<string, unknown>).slice(0, 4);
  if (entries.length === 0) return '—';
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

export function AuditTab() {
  const [search, setSearch] = useState('');
  const logsQuery = useAuditLogs(search);

  const rows = useMemo(() => {
    const items = logsQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((entry) => {
      const haystack = [
        entry.action,
        entry.userEmail ?? '',
        entry.resource ?? '',
        entry.ipAddress ?? entry.ip ?? '',
        summariseDetails(entry.details),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [logsQuery.data, search]);

  if (logsQuery.isError) {
    return <ErrorState title="Could not load the audit log" description="Check that your account has the admin role." />;
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Filter by action, user, IP or details"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {logsQuery.isLoading ? (
        <SkeletonTable rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="No audit entries" description="Privileged actions will appear here as operators use the dashboard." />
      ) : (
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>User</TH>
                <TH>Action</TH>
                <TH>Details</TH>
                <TH>IP</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((entry) => (
                <TR key={entry.id}>
                  <TD>
                    <div className="text-content">{formatRelative(entry.createdAt)}</div>
                    <div className="text-xs text-muted">{formatDateTime(entry.createdAt)}</div>
                  </TD>
                  <TD className="text-content">{entry.userEmail ?? 'system'}</TD>
                  <TD className="font-mono text-xs text-content">{entry.action}</TD>
                  <TD className="max-w-sm truncate text-muted" title={summariseDetails(entry.details)}>
                    {summariseDetails(entry.details)}
                  </TD>
                  <TD className="font-mono text-xs text-muted">{entry.ipAddress ?? entry.ip ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}
