import type { Health, HealthDetail } from '@claude-remote/shared';

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

export const api = {
  health: () => request<Health>('/api/health'),
  healthDetail: () => request<HealthDetail>('/api/health/detail'),
};
