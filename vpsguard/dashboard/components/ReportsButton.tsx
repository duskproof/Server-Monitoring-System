'use client';

import { FileDown } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { api, errorMessage } from '@/lib/api';
import { resolveRange } from '@/lib/metrics';
import type { Server, TimeRangeKey } from '@/lib/types';
import { downloadBlob } from '@/lib/utils';

interface ReportsButtonProps {
  servers?: Server[];
  /** Pre-selects a server and hides the picker (used on the detail page). */
  serverId?: string;
  size?: 'sm' | 'md';
}

export function ReportsButton({ servers = [], serverId, size = 'sm' }: ReportsButtonProps) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<TimeRangeKey>('7d');
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [target, setTarget] = useState(serverId ?? '');
  const [downloading, setDownloading] = useState(false);

  const onDownload = async () => {
    setDownloading(true);
    try {
      const { from, to } = resolveRange(range);
      const blob = await api.reports.download({
        from,
        to,
        format,
        serverId: target || undefined,
      });
      downloadBlob(blob, `vpsguard-report-${range}-${Date.now()}.${format}`);
      toast.success('Report downloaded');
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to generate the report'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size={size} leftIcon={<FileDown className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Export a report"
        description="Generate a usage and incident report for the selected period."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={downloading}>
              Cancel
            </Button>
            <Button onClick={onDownload} loading={downloading} leftIcon={<FileDown className="h-4 w-4" />}>
              Download
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Period"
            value={range}
            onChange={(event) => setRange(event.target.value as TimeRangeKey)}
            options={[
              { value: '24h', label: 'Last 24 hours' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
            ]}
          />
          <Select
            label="Format"
            value={format}
            onChange={(event) => setFormat(event.target.value as 'csv' | 'pdf')}
            options={[
              { value: 'csv', label: 'CSV — raw metrics' },
              { value: 'pdf', label: 'PDF — summary document' },
            ]}
          />
          {!serverId ? (
            <Select
              label="Scope"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="All servers"
              options={servers.map((server) => ({ value: server.id, label: server.name }))}
            />
          ) : null}
        </div>
      </Modal>
    </>
  );
}
