import type {
  Agent,
  DirListing,
  FileEdit,
  FilePreview,
  HealthDetail,
  Project,
  Session,
} from '@claude-remote/shared';

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
  healthDetail: () => request<HealthDetail>('/api/health/detail'),
  projects: () => request<{ projects: Project[] }>('/api/projects'),
  sessions: () => request<{ sessions: Session[] }>('/api/sessions'),
  startSession: (projectId: string, title?: string) =>
    request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, title }),
    }),
  decide: (id: string, answer: 'approve' | 'deny') =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),
  sendPrompt: (id: string, text: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  stopSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  changes: (id: string) =>
    request<{ files: { path: string; edits: number; tool: string }[] }>(
      `/api/sessions/${encodeURIComponent(id)}/changes`,
    ),
  agents: (id: string) =>
    request<{ agents: Agent[] }>(`/api/sessions/${encodeURIComponent(id)}/agents`),
  /** What a session changed in one file — the edits, not the file. */
  edits: (id: string, path: string) =>
    request<{ edits: FileEdit[] }>(
      `/api/sessions/${encodeURIComponent(id)}/edits?path=${encodeURIComponent(path)}`,
    ),
  tree: (projectId: string, path: string) =>
    request<DirListing>(
      `/api/projects/${encodeURIComponent(projectId)}/tree?path=${encodeURIComponent(path)}`,
    ),
  /** One file from a project, as text. Never rendered by the browser as HTML. */
  file: (projectId: string, path: string) =>
    request<FilePreview>(
      `/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`,
    ),
  endSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
