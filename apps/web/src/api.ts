import type { AuthStatus, DeviceSession, TotpEnrolment } from '@claude-remote/shared';

/** An error carrying the message the server chose, so screens can show it as-is. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const e = body as { error?: string; message?: string };
    throw new ApiFailure(
      e.message ?? `Request failed (${res.status})`,
      res.status,
      e.error ?? 'unknown',
    );
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  status: () => request<AuthStatus>('/api/auth/status'),
  claimSetup: (token: string) => post<{ ok: true }>('/api/auth/setup/claim', { token }),
  setupLocal: (email: string, password: string) =>
    post<{ enrolment: TotpEnrolment }>('/api/auth/setup/local', { email, password }),
  login: (password: string) => post<{ ok: true }>('/api/auth/login', { password }),
  submitCode: (code: string, trustBrowser: boolean) =>
    post<{ ok: true; enrolled: boolean }>('/api/auth/totp', { code, trustBrowser }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  logoutAll: () => post<{ ok: true; revoked: number }>('/api/auth/logout-all'),
  devices: () => request<{ devices: DeviceSession[] }>('/api/auth/devices'),
};
