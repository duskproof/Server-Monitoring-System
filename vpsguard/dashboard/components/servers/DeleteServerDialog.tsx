'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, TerminalSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useSocketEvent } from '@/hooks/useSocket';
import { API_URL } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';

interface DeleteServerDialogProps {
  open: boolean;
  serverId: string;
  serverName: string;
  loading?: boolean;
  /** Force-remove from the panel without waiting for agent uninstall (AFK / dead host). */
  onForceRemove: () => void | Promise<void>;
  onCancel: () => void;
  onRemoved?: (reason: 'uninstalled' | 'deleted') => void;
  /** Override when the agent was installed against a non-default public URL. */
  publicApiUrl?: string;
}

interface ServerRemovedPayload {
  serverId: string;
  reason?: 'uninstalled' | 'deleted';
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
  serverId,
  serverName,
  loading = false,
  onForceRemove,
  onCancel,
  onRemoved,
  publicApiUrl = API_URL,
}: DeleteServerDialogProps) {
  const queryClient = useQueryClient();
  const commands = buildAgentRemovalCommands(publicApiUrl);
  const handled = useRef(false);

  useEffect(() => {
    if (open) handled.current = false;
  }, [open, serverId]);

  useSocketEvent<ServerRemovedPayload>(
    'server:removed',
    (payload) => {
      if (!open || !payload?.serverId || payload.serverId !== serverId) return;
      if (handled.current) return;
      handled.current = true;
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      toast.success(
        payload.reason === 'uninstalled'
          ? 'Agent uninstalled — server removed from the panel'
          : 'Server removed',
      );
      onRemoved?.(payload.reason ?? 'uninstalled');
      onCancel();
    },
    open,
  );

  const forceRemove = async () => {
    handled.current = true;
    await onForceRemove();
  };

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
          <Button variant="danger" onClick={() => void forceRemove()} loading={loading}>
            Force remove from panel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Removing <strong className="text-content">{serverName}</strong> from the panel is separate from the
          machine going offline. AFK / reboot / maintenance only marks it offline — uninstall confirms
          deletion.
        </p>

        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-content">
          Run uninstall on the server. This dialog closes automatically when the agent confirms uninstall.
          Use <strong>Force remove</strong> only if the host is already gone or unreachable.
        </div>

        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-content">
            <TerminalSquare className="h-3.5 w-3.5" />
            Uninstall on the machine (run as root)
          </p>
          <div className="space-y-3">
            <CopyableCommand
              label="Uninstall agent (keeps config / buffer)"
              command={commands.uninstall}
              hint="Stops the service, removes the package, and notifies the control plane."
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
