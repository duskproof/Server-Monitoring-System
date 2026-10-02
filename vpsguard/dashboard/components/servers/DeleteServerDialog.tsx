'use client';

import { Check, Copy, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { API_URL } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';

interface DeleteServerDialogProps {
  open: boolean;
  serverName: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Override when the agent was installed against a non-default public URL. */
  publicApiUrl?: string;
}

function buildAgentRemovalCommands(publicApiUrl: string): { uninstall: string; purge: string } {
  const base = publicApiUrl.replace(/\/+$/, '') || API_URL;
  return {
    uninstall: `curl -fsSL ${base}/install.sh | sudo bash -s -- --uninstall`,
    purge: `curl -fsSL ${base}/install.sh | sudo bash -s -- --uninstall --purge`,
  };
}

function CopyableCommand({ label, command, hint }: { label: string; command: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyToClipboard(command);
    if (!ok) {
      toast.error('Could not access the clipboard');
      return;
    }
    setCopied(true);
    toast.success('Command copied');
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-bg p-3">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-content">
          {command}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onCopy()}
          leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

export function DeleteServerDialog({
  open,
  serverName,
  loading = false,
  onConfirm,
  onCancel,
  publicApiUrl = API_URL,
}: DeleteServerDialogProps) {
  const commands = buildAgentRemovalCommands(publicApiUrl);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Delete server"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            Delete
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Deleting <strong className="text-content">{serverName}</strong> removes its history and revokes the
          agent API key in VPSGuard. This action cannot be undone.
        </p>

        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-content">
            <TerminalSquare className="h-3.5 w-3.5" />
            Also remove the agent from the server (run as root)
          </p>
          <div className="space-y-3">
            <CopyableCommand
              label="Uninstall agent (keeps config / buffer)"
              command={commands.uninstall}
              hint="Stops the service and removes the package. Config under /etc/vpsguard is kept."
            />
            <CopyableCommand
              label="Full purge (recommended)"
              command={commands.purge}
              hint="Uninstall plus delete /etc/vpsguard, /var/lib/vpsguard and /var/log/vpsguard."
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
