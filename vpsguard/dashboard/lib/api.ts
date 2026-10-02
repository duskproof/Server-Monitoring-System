import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/lib/session';
import type {
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertStatus,
  AuditLogEntry,
  AuthResponse,
  CommandPayload,
  CreatedServer,
  DockerSnapshot,
  Integration,
  IntegrationInput,
  LoginPayload,
  LogsResponse,
  MetricsResponse,
  Overview,
  Paginated,
  ProcessSnapshot,
  RegisterPayload,
  RemoteCommand,
  Server,
  ServerGroup,
  ServerQuery,
  ServicesSnapshot,
  SslSnapshot,
  TemperaturesSnapshot,
  User,
  UserInput,
} from '@/lib/types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Skip the Authorization header (login / register / refresh). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}${API_PREFIX}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Ensures concurrent 401s trigger only one refresh round-trip. */
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_URL}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Partial<AuthResponse>;
    if (!data.accessToken || !data.refreshToken) return null;

    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function redirectToLogin(): void {
  clearTokens();
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname === '/register') return;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}`);
}

async function readError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  let details: unknown;

  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        details = parsed;
        message = parsed.message || parsed.error || message;
      } catch {
        message = text.slice(0, 300);
      }
    }
  } catch {
    /* Response body already consumed or unavailable — keep the default message. */
  }

  return new ApiError(message, response.status, details);
}

async function rawRequest(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: 'no-store',
  });
}

/**
 * Typed fetch wrapper. Transparently refreshes the access token once on a 401
 * and redirects to `/login` when the refresh itself fails.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.anonymous ? null : getAccessToken();
  let response = await rawRequest(path, options, token);

  if (response.status === 401 && !options.anonymous) {
    const nextToken = await refreshAccessToken();
    if (!nextToken) {
      redirectToLogin();
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }
    response = await rawRequest(path, options, nextToken);
    if (response.status === 401) {
      redirectToLogin();
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }
  }

  if (!response.ok) {
    throw await readError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Downloads a binary payload (reports) honouring the same auth/refresh rules. */
export async function apiDownload(path: string, query?: RequestOptions['query']): Promise<Blob> {
  const token = getAccessToken();
  let response = await fetch(buildUrl(path, query), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  if (response.status === 401) {
    const nextToken = await refreshAccessToken();
    if (!nextToken) {
      redirectToLogin();
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }
    response = await fetch(buildUrl(path, query), {
      headers: { Authorization: `Bearer ${nextToken}` },
      cache: 'no-store',
    });
  }

  if (!response.ok) throw await readError(response);
  return response.blob();
}

/** Accepts both bare arrays and `{items,total}` envelopes. */
function asList<T>(payload: T[] | Paginated<T> | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.items) ? payload.items : [];
}

export const api = {
  /* ---------------------------- Auth ---------------------------- */
  auth: {
    login: (payload: LoginPayload) =>
      apiRequest<AuthResponse>('/auth/login', { method: 'POST', body: payload, anonymous: true }),
    register: (payload: RegisterPayload) =>
      apiRequest<AuthResponse>('/auth/register', { method: 'POST', body: payload, anonymous: true }),
    me: () => apiRequest<User>('/auth/me'),
    updateProfile: (payload: { name?: string; email?: string; password?: string; currentPassword?: string }) =>
      apiRequest<User>('/auth/me', { method: 'PATCH', body: payload }),
  },

  /* --------------------------- Overview -------------------------- */
  overview: {
    get: () => apiRequest<Overview>('/overview'),
  },

  /* --------------------------- Servers --------------------------- */
  servers: {
    list: async (query: ServerQuery = {}) =>
      asList(
        await apiRequest<Server[] | Paginated<Server>>('/servers', {
          query: { group: query.group, status: query.status, search: query.search },
        }),
      ),
    get: (id: string) => apiRequest<Server>(`/servers/${id}`),
    create: (payload: {
      name: string;
      groupId?: string | null;
      ipAddress?: string | null;
      publicUrl?: string | null;
    }) => apiRequest<CreatedServer>('/servers', { method: 'POST', body: payload }),
    remove: (id: string) => apiRequest<void>(`/servers/${id}`, { method: 'DELETE' }),
    metrics: (
      id: string,
      params: { from: string; to: string; metric: string; interval: string },
    ) => apiRequest<MetricsResponse>(`/servers/${id}/metrics`, { query: { ...params } }),
    processes: (id: string) => apiRequest<ProcessSnapshot>(`/servers/${id}/processes`),
    docker: (id: string) => apiRequest<DockerSnapshot>(`/servers/${id}/docker`),
    services: (id: string) => apiRequest<ServicesSnapshot>(`/servers/${id}/services`),
    logs: (id: string, params: { file?: string; pattern?: string; limit?: number }) =>
      apiRequest<LogsResponse>(`/servers/${id}/logs`, { query: { ...params } }),
    temperatures: (id: string) => apiRequest<TemperaturesSnapshot>(`/servers/${id}/temperatures`),
    ssl: (id: string) => apiRequest<SslSnapshot>(`/servers/${id}/ssl`),
  },

  /* ---------------------------- Groups --------------------------- */
  groups: {
    list: async () => asList(await apiRequest<ServerGroup[] | Paginated<ServerGroup>>('/groups')),
    create: (payload: { name: string; description?: string }) =>
      apiRequest<ServerGroup>('/groups', { method: 'POST', body: payload }),
    remove: (id: string) => apiRequest<void>(`/groups/${id}`, { method: 'DELETE' }),
  },

  /* ---------------------------- Alerts --------------------------- */
  alerts: {
    list: async (status?: AlertStatus) =>
      asList(await apiRequest<Alert[] | Paginated<Alert>>('/alerts', { query: { status } })),
    acknowledge: (id: string) => apiRequest<Alert>(`/alerts/${id}/ack`, { method: 'POST' }),
  },

  alertRules: {
    list: async () => asList(await apiRequest<AlertRule[] | Paginated<AlertRule>>('/alert-rules')),
    create: (payload: AlertRuleInput) =>
      apiRequest<AlertRule>('/alert-rules', { method: 'POST', body: payload }),
    update: (id: string, payload: AlertRuleInput) =>
      apiRequest<AlertRule>(`/alert-rules/${id}`, { method: 'PATCH', body: payload }),
    remove: (id: string) => apiRequest<void>(`/alert-rules/${id}`, { method: 'DELETE' }),
  },

  /* --------------------------- Commands -------------------------- */
  commands: {
    run: (payload: CommandPayload) =>
      apiRequest<RemoteCommand>('/commands', { method: 'POST', body: payload }),
    history: async (serverId: string) =>
      asList(
        await apiRequest<RemoteCommand[] | Paginated<RemoteCommand>>('/commands', {
          query: { serverId },
        }),
      ),
  },

  /* --------------------------- Reports --------------------------- */
  reports: {
    download: (params: { from: string; to: string; format: 'csv' | 'pdf'; serverId?: string }) =>
      apiDownload('/reports', { ...params }),
  },

  /* ------------------------ Integrations ------------------------- */
  integrations: {
    list: async () => asList(await apiRequest<Integration[] | Paginated<Integration>>('/integrations')),
    save: (payload: IntegrationInput) =>
      apiRequest<Integration>('/integrations', { method: 'POST', body: payload }),
    test: (channel: string) =>
      apiRequest<{ ok: boolean; message: string }>(`/integrations/test/${channel}`, { method: 'POST' }),
  },

  /* ----------------------------- Users --------------------------- */
  users: {
    list: async () => asList(await apiRequest<User[] | Paginated<User>>('/users')),
    create: (payload: UserInput) => apiRequest<User>('/users', { method: 'POST', body: payload }),
    update: (id: string, payload: Partial<UserInput>) =>
      apiRequest<User>(`/users/${id}`, { method: 'PATCH', body: payload }),
    remove: (id: string) => apiRequest<void>(`/users/${id}`, { method: 'DELETE' }),
  },

  /* --------------------------- Audit log ------------------------- */
  auditLogs: {
    list: async (query: { limit?: number; search?: string } = {}) =>
      asList(
        await apiRequest<AuditLogEntry[] | Paginated<AuditLogEntry>>('/audit-logs', {
          query: { limit: query.limit ?? 100, search: query.search },
        }),
      ),
  },
};

export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
