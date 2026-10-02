'use client';

import { Mail, MessageSquare, Save, Send, Slack, Webhook } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Switch } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useIntegrations, useSaveIntegration } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import type { Integration, IntegrationType } from '@/lib/types';

interface FieldSpec {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password' | 'number';
  hint?: string;
}

interface IntegrationSpec {
  type: IntegrationType;
  title: string;
  description: string;
  icon: ReactNode;
  fields: FieldSpec[];
}

const SPECS: IntegrationSpec[] = [
  {
    type: 'telegram',
    title: 'Telegram',
    description: 'Send alerts to a chat or channel through a bot.',
    icon: <MessageSquare className="h-4 w-4" />,
    fields: [
      { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF…', type: 'password' },
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890', hint: 'Use a negative ID for channels.' },
    ],
  },
  {
    type: 'slack',
    title: 'Slack',
    description: 'Post alerts to a Slack channel via an incoming webhook.',
    icon: <Slack className="h-4 w-4" />,
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming webhook URL',
        placeholder: 'https://hooks.slack.com/services/…',
        type: 'password',
      },
      { key: 'channel', label: 'Channel override', placeholder: '#ops-alerts' },
    ],
  },
  {
    type: 'email',
    title: 'E-mail (SMTP)',
    description: 'Deliver alerts by e-mail using your own SMTP relay.',
    icon: <Mail className="h-4 w-4" />,
    fields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', placeholder: '587', type: 'number' },
      { key: 'username', label: 'Username', placeholder: 'alerts@example.com' },
      { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
      { key: 'from', label: 'From address', placeholder: 'VPSGuard <alerts@example.com>' },
      { key: 'to', label: 'Recipients', placeholder: 'ops@example.com, sre@example.com' },
    ],
  },
  {
    type: 'webhook',
    title: 'Webhook',
    description: 'POST a JSON payload to any HTTP endpoint.',
    icon: <Webhook className="h-4 w-4" />,
    fields: [
      { key: 'url', label: 'Endpoint URL', placeholder: 'https://example.com/hooks/vpsguard' },
      { key: 'secret', label: 'Signing secret', placeholder: 'Optional HMAC secret', type: 'password' },
    ],
  },
];

function IntegrationCard({ spec, integration }: { spec: IntegrationSpec; integration?: Integration }) {
  const saveIntegration = useSaveIntegration();

  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEnabled(integration?.enabled ?? false);
    setConfig(integration?.config ?? {});
  }, [integration]);

  const save = async (test: boolean) => {
    if (test) setTesting(true);
    try {
      await saveIntegration.mutateAsync({ type: spec.type, enabled, config, test });
      if (test) toast.success(`Test notification sent through ${spec.title}`);
    } catch (error) {
      if (test) toast.error(errorMessage(error, `${spec.title} test failed`));
    } finally {
      if (test) setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={spec.title}
        description={spec.description}
        icon={spec.icon}
        action={
          <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Badge>
        }
      />
      <CardBody className="space-y-4">
        <Switch checked={enabled} onChange={setEnabled} label="Deliver alerts through this channel" />

        <div className="grid gap-4 sm:grid-cols-2">
          {spec.fields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type={field.type ?? 'text'}
              placeholder={field.placeholder}
              hint={field.hint}
              value={config[field.key] ?? ''}
              onChange={(event) =>
                setConfig((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => save(false)}
            loading={saveIntegration.isPending && !testing}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save
          </Button>
          <Button variant="outline" onClick={() => save(true)} loading={testing} leftIcon={<Send className="h-4 w-4" />}>
            Send test
          </Button>
          {integration?.updatedAt ? (
            <span className="text-xs text-muted">Updated {formatRelative(integration.updatedAt)}</span>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function IntegrationsTab() {
  const integrationsQuery = useIntegrations();

  if (integrationsQuery.isLoading) {
    return (
      <div className="grid gap-5 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-72 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const byType = new Map((integrationsQuery.data ?? []).map((item) => [item.type, item]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Configure where alert notifications are delivered. Each alert rule chooses which of these channels to use.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        {SPECS.map((spec) => (
          <IntegrationCard key={spec.type} spec={spec} integration={byType.get(spec.type)} />
        ))}
      </div>
    </div>
  );
}
