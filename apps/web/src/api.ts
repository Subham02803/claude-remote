import type {
  Agent,
  DirListing,
  FileEdit,
  FilePreview,
  FolderListing,
  HealthDetail,
  Project,
  Session,
  Transcript,
  Upload,
  Workspace,
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

  /* ---------------------------- workspaces ----------------------------- */

  workspaces: () => request<{ workspaces: Workspace[] }>('/api/workspaces'),
  createWorkspace: (name: string) =>
    request<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameWorkspace: (id: string, name: string) =>
    request<{ ok: true }>(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteWorkspace: (id: string) =>
    request<{ ok: true }>(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** `path` is relative to the home directory, exactly as the picker gave it. */
  addProject: (workspaceId: string, path: string, name?: string) =>
    request<{ project: Project }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),
  removeProject: (id: string) =>
    request<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Folders under home, for the picker. '' is home itself. */
  folders: (path: string) =>
    request<FolderListing>(`/api/folders?path=${encodeURIComponent(path)}`),

  sessions: () => request<{ sessions: Session[] }>('/api/sessions'),
  startSession: (projectId: string, title?: string) =>
    request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, title }),
    }),
  /** `option` is the 1-based number of a choice, and only for 'choose'. */
  decide: (id: string, answer: 'approve' | 'deny' | 'choose', option?: number) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ answer, option }),
    }),
  /** `images` are names from `uploadImage`, never paths — the server resolves them. */
  sendPrompt: (id: string, text: string, images: string[] = []) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text, images }),
    }),
  /**
   * One image, as its own bytes.
   *
   * Sent raw rather than as multipart: the browser sets the content type from
   * the file, the server types it by signature anyway, and neither side needs
   * a parser for a format carrying exactly one field.
   */
  uploadImage: (id: string, file: File) =>
    request<{ upload: Upload }>(`/api/sessions/${encodeURIComponent(id)}/uploads`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream' },
    }),
  /** Where an uploaded image can be looked at again. */
  uploadUrl: (id: string, name: string) =>
    `/api/sessions/${encodeURIComponent(id)}/uploads/${encodeURIComponent(name)}`,
  stopSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  changes: (id: string) =>
    request<{ files: { path: string; edits: number; tool: string }[] }>(
      `/api/sessions/${encodeURIComponent(id)}/changes`,
    ),
  transcript: (id: string) =>
    request<Transcript>(`/api/sessions/${encodeURIComponent(id)}/transcript`),
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
  /** Stops the work. The session stays in the list, readable. */
  endSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Forgets an ended session. Refused while it is still running. */
  deleteSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/record`, { method: 'DELETE' }),
};
