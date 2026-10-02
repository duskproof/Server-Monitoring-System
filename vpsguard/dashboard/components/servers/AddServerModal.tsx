'use client';

import { Check, Copy, KeyRound, ServerIcon, TerminalSquare } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useCreateServer, useGroups } from '@/hooks/queries';
import { API_URL } from '@/lib/api';
import type { CreatedServer } from '@/lib/types';
import { copyToClipboard } from '@/lib/utils';

interface AddServerModalProps {
  open: boolean;
  onClose: () => void;
}

/** Default public URL suggested for the agent install command. */
function defaultPublicUrl(): string {
  if (typeof window === 'undefined') return API_URL;
  try {
    const configured = new URL(API_URL);
    // Prefer the host the operator is browsing from (LAN IP / hostname), API on :4000.
    if (configured.hostname === 'localhost' || configured.hostname === '127.0.0.1') {
      const host = window.location.hostname || 'localhost';
      if (host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:4000`;
      }
    }
    return API_URL.replace(/\/+$/, '');
  } catch {
    return API_URL.replace(/\/+$/, '');
  }
}

function normalizePublicUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return defaultPublicUrl();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:4000`;
}

function buildInstallCommand(apiKey: string, publicUrl: string): string {
  const base = normalizePublicUrl(publicUrl);
  return `curl -fsSL ${base}/install.sh | sudo bash -s -- --url ${base} --api-key ${apiKey}`;
}

export function AddServerModal({ open, onClose }: AddServerModalProps) {
  const groupsQuery = useGroups();
  const createServer = useCreateServer();

  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [created, setCreated] = useState<CreatedServer | null>(null);
  const [copied, setCopied] = useState<'key' | 'command' | null>(null);

  const suggestedUrl = open ? defaultPublicUrl() : API_URL;

  const reset = () => {
    setName('');
    setIpAddress('');
    setPublicUrl('');
    setGroupId('');
    setNameError(undefined);
    setCreated(null);
    setCopied(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async () => {
    if (name.trim().length < 2) {
      setNameError('Enter a server name (at least 2 characters)');
      return;
    }
    setNameError(undefined);

    const resolvedPublicUrl = normalizePublicUrl(publicUrl || suggestedUrl);

    try {
      const server = await createServer.mutateAsync({
        name: name.trim(),
        groupId: groupId || null,
        ipAddress: ipAddress.trim() || null,
        publicUrl: resolvedPublicUrl,
      });
      setCreated({
        ...server,
        // Always rebuild so the dialog never shows a leftover <your-server> placeholder.
        installCommand: buildInstallCommand(server.apiKey, resolvedPublicUrl),
      });
      toast.success('Server registered — copy the API key now');
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  const copy = async (value: string, kind: 'key' | 'command') => {
    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.error('Could not access the clipboard');
      return;
    }
    setCopied(kind);
    toast.success(kind === 'key' ? 'API key copied' : 'Install command copied');
    window.setTimeout(() => setCopied(null), 2000);
  };

  const installCommand = created?.installCommand || '';

  return (
    <Modal
      open={open}
      onClose={close}
      size={created ? 'lg' : 'md'}
      title={created ? 'Server registered' : 'Add a server'}
      description={
        created
          ? 'Run the command below on the target machine. The API key is shown only once.'
          : 'Register a machine, then install the agent using the generated command.'
      }
      footer={
        created ? (
          <>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
            <Link
              href={`/cabinet/servers/${created.id}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90"
            >
              <ServerIcon className="h-4 w-4" />
              Open server
            </Link>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close} disabled={createServer.isPending}>
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={createServer.isPending}>
              Create server
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
              <KeyRound className="h-3.5 w-3.5" />
              API key
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-bg p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-content">{created.apiKey}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copy(created.apiKey, 'key')}
                leftIcon={copied === 'key' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              >
                {copied === 'key' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-warning">
              Store this key securely — it cannot be displayed again after closing this dialog.
            </p>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
              <TerminalSquare className="h-3.5 w-3.5" />
              One-line installation
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-line bg-bg p-3">
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-content">
                {installCommand}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copy(installCommand, 'command')}
                leftIcon={copied === 'command' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              >
                {copied === 'command' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Run it as root on the target server. The agent must reach the VPSGuard URL in the command
              (open firewall port 4000 if needed).
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label="Server name"
            placeholder="web-01"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            hint="A friendly label — the agent reports the real hostname automatically."
            autoFocus
          />
          <Input
            label="Server IP"
            placeholder="203.0.113.10"
            value={ipAddress}
            onChange={(event) => setIpAddress(event.target.value)}
            hint="IP of the machine you will monitor (shown in the servers list / used for SSH)."
          />
          <Input
            label="VPSGuard public URL"
            placeholder={suggestedUrl}
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            hint={`Used in the install command (--url). Default: ${suggestedUrl}. Use a LAN/public IP reachable from the VPS, not localhost.`}
          />
          <Select
            label="Group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            placeholder="No group"
            options={(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))}
            hint="Groups let you target alert rules at several servers at once."
          />
        </div>
      )}
    </Modal>
  );
}
