'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { api, errorMessage } from '@/lib/api';
import { resolveRange, type TimeRangeOption } from '@/lib/metrics';
import type {
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertStatus,
  AuditLogEntry,
  CommandPayload,
  DockerSnapshot,
  Integration,
  IntegrationInput,
  LogsResponse,
  MetricsResponse,
  Overview,
  ProcessSnapshot,
  RemoteCommand,
  Server,
  ServerGroup,
  ServerQuery,
  ServicesSnapshot,
  SslSnapshot,
  TemperaturesSnapshot,
  TimeRangeKey,
  User,
  UserInput,
} from '@/lib/types';

export const queryKeys = {
  overview: ['overview'] as const,
  servers: (query: ServerQuery) => ['servers', query] as const,
  server: (id: string) => ['server', id] as const,
  metrics: (id: string, metric: string, range: TimeRangeKey) => ['metrics', id, metric, range] as const,
  processes: (id: string) => ['processes', id] as const,
  docker: (id: string) => ['docker', id] as const,
  services: (id: string) => ['services', id] as const,
  logs: (id: string, file: string, pattern: string, limit: number) =>
    ['logs', id, file, pattern, limit] as const,
  temperatures: (id: string) => ['temperatures', id] as const,
  ssl: (id: string) => ['ssl', id] as const,
  groups: ['groups'] as const,
  alerts: (status?: AlertStatus) => ['alerts', status ?? 'all'] as const,
  alertRules: ['alert-rules'] as const,
  commands: (serverId: string) => ['commands', serverId] as const,
  integrations: ['integrations'] as const,
  users: ['users'] as const,
  auditLogs: (search: string) => ['audit-logs', search] as const,
};

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function useOverview(): UseQueryResult<Overview> {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => api.overview.get(),
    refetchInterval: 60_000,
  });
}

export function useServers(query: ServerQuery = {}): UseQueryResult<Server[]> {
  return useQuery({
    queryKey: queryKeys.servers(query),
    queryFn: () => api.servers.list(query),
    refetchInterval: 30_000,
  });
}

export function useServer(id: string): UseQueryResult<Server> {
  return useQuery({
    queryKey: queryKeys.server(id),
    queryFn: () => api.servers.get(id),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useServerMetrics(
  id: string,
  metric: string | string[],
  range: TimeRangeKey,
  option: TimeRangeOption,
): UseQueryResult<MetricsResponse> {
  const metrics = Array.isArray(metric) ? metric : [metric];
  const metricKey = metrics.join(',');

  return useQuery({
    queryKey: queryKeys.metrics(id, metricKey, range),
    queryFn: async () => {
      const { from, to } = resolveRange(range);
      const responses = await Promise.all(
        metrics.map((key) =>
          api.servers.metrics(id, { from, to, metric: key, interval: option.interval }),
        ),
      );

      // Merge multi-metric panels (e.g. network rx+tx) into one chart payload.
      // Prefix series names when a key would otherwise collide across metrics.
      const series = responses.flatMap((response, index) => {
        const key = metrics[index];
        const short = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
        return (response.series ?? []).map((item) => ({
          ...item,
          name:
            metrics.length > 1
              ? item.name === key || item.name === short
                ? short
                : `${short}:${item.name}`
              : item.name,
        }));
      });

      return { series };
    },
    enabled: Boolean(id) && metrics.length > 0,
    staleTime: 15_000,
  });
}

export function useProcesses(id: string, enabled = true): UseQueryResult<ProcessSnapshot> {
  return useQuery({
    queryKey: queryKeys.processes(id),
    queryFn: () => api.servers.processes(id),
    enabled: enabled && Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useDocker(id: string, enabled = true): UseQueryResult<DockerSnapshot> {
  return useQuery({
    queryKey: queryKeys.docker(id),
    queryFn: () => api.servers.docker(id),
    enabled: enabled && Boolean(id),
    refetchInterval: 20_000,
  });
}

export function useServices(id: string, enabled = true): UseQueryResult<ServicesSnapshot> {
  return useQuery({
    queryKey: queryKeys.services(id),
    queryFn: () => api.servers.services(id),
    enabled: enabled && Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useLogs(
  id: string,
  params: { file: string; pattern: string; limit: number },
  enabled = true,
): UseQueryResult<LogsResponse> {
  return useQuery({
    queryKey: queryKeys.logs(id, params.file, params.pattern, params.limit),
    queryFn: () =>
      api.servers.logs(id, {
        file: params.file || undefined,
        pattern: params.pattern || undefined,
        limit: params.limit,
      }),
    enabled: enabled && Boolean(id),
    refetchInterval: 20_000,
  });
}

export function useTemperatures(id: string, enabled = true): UseQueryResult<TemperaturesSnapshot> {
  return useQuery({
    queryKey: queryKeys.temperatures(id),
    queryFn: () => api.servers.temperatures(id),
    enabled: enabled && Boolean(id),
    refetchInterval: 30_000,
  });
}

export function useSsl(id: string, enabled = true): UseQueryResult<SslSnapshot> {
  return useQuery({
    queryKey: queryKeys.ssl(id),
    queryFn: () => api.servers.ssl(id),
    enabled: enabled && Boolean(id),
    refetchInterval: 300_000,
  });
}

export function useGroups(): UseQueryResult<ServerGroup[]> {
  return useQuery({ queryKey: queryKeys.groups, queryFn: () => api.groups.list() });
}

export function useAlerts(status?: AlertStatus): UseQueryResult<Alert[]> {
  return useQuery({
    queryKey: queryKeys.alerts(status),
    queryFn: () => api.alerts.list(status),
    refetchInterval: 30_000,
  });
}

export function useAlertRules(): UseQueryResult<AlertRule[]> {
  return useQuery({ queryKey: queryKeys.alertRules, queryFn: () => api.alertRules.list() });
}

export function useCommandHistory(serverId: string, enabled = true): UseQueryResult<RemoteCommand[]> {
  return useQuery({
    queryKey: queryKeys.commands(serverId),
    queryFn: () => api.commands.history(serverId),
    enabled: enabled && Boolean(serverId),
  });
}

export function useIntegrations(): UseQueryResult<Integration[]> {
  return useQuery({ queryKey: queryKeys.integrations, queryFn: () => api.integrations.list() });
}

export function useUsers(enabled = true): UseQueryResult<User[]> {
  return useQuery({ queryKey: queryKeys.users, queryFn: () => api.users.list(), enabled });
}

export function useAuditLogs(search: string, enabled = true): UseQueryResult<AuditLogEntry[]> {
  return useQuery({
    queryKey: queryKeys.auditLogs(search),
    queryFn: () => api.auditLogs.list({ search: search || undefined, limit: 200 }),
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function useCreateServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      groupId?: string | null;
      ipAddress?: string | null;
      publicUrl?: string | null;
    }) => api.servers.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to create the server')),
  });
}

export function useDeleteServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.servers.remove(id),
    onSuccess: () => {
      toast.success('Server deleted');
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to delete the server')),
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.alerts.acknowledge(id),
    onSuccess: () => {
      toast.success('Alert acknowledged');
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to acknowledge the alert')),
  });
}

export function useSaveAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: AlertRuleInput }) =>
      id ? api.alertRules.update(id, payload) : api.alertRules.create(payload),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? 'Alert rule updated' : 'Alert rule created');
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertRules });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to save the alert rule')),
  });
}

export function useDeleteAlertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.alertRules.remove(id),
    onSuccess: () => {
      toast.success('Alert rule deleted');
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertRules });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to delete the alert rule')),
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; description?: string }) => api.groups.create(payload),
    onSuccess: () => {
      toast.success('Group created');
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to create the group')),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.groups.remove(id),
    onSuccess: () => {
      toast.success('Group deleted');
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to delete the group')),
  });
}

export function useRunCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CommandPayload) => api.commands.run(payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.commands(variables.serverId) });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to dispatch the command')),
  });
}

export function useSaveIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: IntegrationInput) => {
      if (payload.test) {
        return api.integrations.test(payload.type);
      }
      return api.integrations.save(payload);
    },
    onSuccess: (_data, variables) => {
      if (!variables.test) toast.success('Integration saved');
      void queryClient.invalidateQueries({ queryKey: queryKeys.integrations });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to save the integration')),
  });
}

export function useSaveUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: UserInput }) =>
      id ? api.users.update(id, payload) : api.users.create(payload),
    onSuccess: (_data, variables) => {
      toast.success(variables.id ? 'User updated' : 'User created');
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to save the user')),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.users.remove(id),
    onSuccess: () => {
      toast.success('User deleted');
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (error) => toast.error(errorMessage(error, 'Failed to delete the user')),
  });
}
