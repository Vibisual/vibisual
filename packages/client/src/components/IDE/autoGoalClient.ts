import type { AutoGoalSettings, AutoGoalState } from '@vibisual/shared';

interface AutoGoalResponse {
  ok?: boolean;
  settings?: AutoGoalSettings | null;
  state?: AutoGoalState;
  body?: string;
}

/** Both HTTP and application failures must reach the visible error state. */
export async function fetchAutoGoalResponse(url: string, init?: RequestInit): Promise<AutoGoalResponse> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: AutoGoalResponse = await response.json();
  if (!body.ok) throw new Error('Procedure request failed');
  return body;
}

export interface AutoGoalClientSnapshot {
  settings: AutoGoalSettings | null;
  state: AutoGoalState | null;
  loading: boolean;
  saving: boolean;
  error: 'load' | 'save' | null;
}

/** One instance belongs to exactly one project/agent/session; responses never cross that boundary. */
export class AutoGoalClient {
  private snapshot: AutoGoalClientSnapshot = { settings: null, state: null, loading: true, saving: false, error: null };
  private listeners = new Set<() => void>();
  private readController: AbortController | null = null;
  private writeController: AbortController | null = null;
  private readVersion = 0;
  private writeVersion = 0;
  private active = false;

  constructor(private readonly rootPath: string | null | undefined, private readonly agentId?: string | null, private readonly subAgentId?: string | null) {}

  getSnapshot = (): AutoGoalClientSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<AutoGoalClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  start(): void {
    this.active = true;
    this.update({ saving: false });
    void this.refresh();
  }

  stop(): void {
    this.active = false;
    this.readVersion += 1;
    this.writeVersion += 1;
    this.readController?.abort();
    this.writeController?.abort();
  }

  async refresh(clearError = true): Promise<void> {
    if (!this.active || this.snapshot.saving) return;
    if (!this.rootPath) { this.update({ loading: false }); return; }
    const version = ++this.readVersion;
    this.readController?.abort();
    const controller = new AbortController();
    this.readController = controller;
    this.update({ loading: this.snapshot.state === null, ...(clearError ? { error: null } : {}) });
    const query = new URLSearchParams({ projectPath: this.rootPath });
    if (this.agentId) query.set('agentId', this.agentId);
    if (this.subAgentId) query.set('subAgentId', this.subAgentId);
    try {
      const body = await fetchAutoGoalResponse(`/api/auto-goal/state?${query}`, { signal: controller.signal });
      if (!this.active || version !== this.readVersion) return;
      if (!body.state) throw new Error('Missing procedure state');
      this.update({ state: body.state, settings: body.settings ?? null, loading: false, error: this.snapshot.error === 'save' && !clearError ? 'save' : null });
    } catch {
      if (!this.active || version !== this.readVersion) return;
      this.update({ loading: false, error: this.snapshot.error === 'save' ? 'save' : 'load' });
    }
  }

  async mutate(url: string, body: unknown, method = 'POST'): Promise<void> {
    if (!this.active || !this.rootPath || this.snapshot.saving || this.snapshot.loading) return;
    const version = ++this.writeVersion;
    this.readVersion += 1;
    this.readController?.abort();
    const controller = new AbortController();
    this.writeController = controller;
    this.update({ saving: true, error: null });
    try {
      await fetchAutoGoalResponse(url, {
        method, signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!this.active || version !== this.writeVersion) return;
      this.update({ saving: false });
      await this.refresh();
    } catch {
      if (!this.active || version !== this.writeVersion) return;
      this.update({ saving: false, error: 'save' });
    }
  }
}
