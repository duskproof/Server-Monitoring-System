'use client';

import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { useSsl } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

function daysLeftTone(daysLeft: number): BadgeTone {
  if (daysLeft <= 0) return 'danger';
  if (daysLeft <= 14) return 'danger';
  if (daysLeft <= 30) return 'warning';
  return 'success';
}

function daysLeftLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Expired ${Math.abs(daysLeft)} days ago`;
  if (daysLeft === 0) return 'Expires today';
  return `${daysLeft} days left`;
}

export function SslTab({ serverId }: { serverId: string }) {
  const query = useSsl(serverId);

  if (query.isLoading) return <SkeletonTable rows={4} columns={5} />;

  if (query.isError) {
    return (
      <ErrorState
        title="Certificate data unavailable"
        description={errorMessage(query.error, 'No SSL checks are configured for this server.')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const certificates = query.data?.certificates ?? [];
  const expiringSoon = certificates.filter((certificate) => certificate.daysLeft <= 30).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            {certificates.length} certificate{certificates.length === 1 ? '' : 's'}
          </span>
          {expiringSoon > 0 ? (
            <Badge tone="warning" icon={<ShieldAlert className="h-3 w-3" />}>
              {expiringSoon} expiring soon
            </Badge>
          ) : null}
          <span>· snapshot {formatDateTime(query.data?.collectedAt)}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>

      {certificates.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title="No certificates monitored"
          description="Add domains to the agent configuration to track their expiry dates here."
        />
      ) : (
        <TableWrapper>
          <Table className="min-w-[720px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Domain</TH>
                <TH>Issuer</TH>
                <TH>Valid from</TH>
                <TH>Expires</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {certificates.map((certificate) => (
                <TR key={certificate.id || certificate.domain}>
                  <TD className="font-medium text-content">{certificate.domain}</TD>
                  <TD className="text-xs text-muted">{certificate.issuer ?? '—'}</TD>
                  <TD className="text-xs text-muted">{formatDate(certificate.validFrom)}</TD>
                  <TD className="text-xs text-muted">{formatDate(certificate.validTo)}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Badge tone={daysLeftTone(certificate.daysLeft)}>{daysLeftLabel(certificate.daysLeft)}</Badge>
                      {!certificate.valid ? <Badge tone="danger">invalid</Badge> : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}
