import type { SkillSharingEntry, SkillSharingResult } from '@vibisual/shared';

export class SkillSharingRequestError extends Error {
  constructor(public readonly kind: 'request' | 'invalidResponse', message: string) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function entry(value: unknown): value is SkillSharingEntry {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.description === 'string' && typeof value.sourcePath === 'string'
    && (value.sourceProvider === 'claude' || value.sourceProvider === 'codex')
    && (value.scope === 'project' || value.scope === 'global') && strings(value.issues)
    && ['available', 'shared', 'conflict', 'unsupported'].includes(String(value.status));
}

function result(value: unknown): value is SkillSharingResult {
  return record(value) && typeof value.name === 'string' && typeof value.path === 'string'
    && (value.issues === undefined || strings(value.issues))
    && ['shared', 'exists', 'conflict', 'unsupported'].includes(String(value.status));
}

/** HTTP failures and malformed success payloads must remain retryable, never look empty/successful. */
async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) throw new SkillSharingRequestError('request', `HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!record(data) || data.ok !== true) throw new SkillSharingRequestError('invalidResponse', 'Invalid skill-sharing response');
    return data;
  } catch (error) {
    if (error instanceof SkillSharingRequestError) throw error;
    if (error instanceof SyntaxError) throw new SkillSharingRequestError('invalidResponse', error.message);
    throw new SkillSharingRequestError('request', error instanceof Error ? error.message : String(error));
  }
}

export async function readSkillSharing(
  agentId: string, provider: SkillSharingEntry['sourceProvider'], signal: AbortSignal,
): Promise<SkillSharingEntry[]> {
  const data = await request(`/api/skill-sharing?agentId=${encodeURIComponent(agentId)}`, { signal });
  if (data.provider !== provider || !Array.isArray(data.skills) || !data.skills.every(entry)) {
    throw new SkillSharingRequestError('invalidResponse', 'Invalid skill-sharing list');
  }
  return data.skills;
}

export async function shareSkill(agentId: string, sourceId: string): Promise<SkillSharingResult> {
  const data = await request('/api/skill-sharing', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, sourceId }),
  });
  if (!result(data.result)) throw new SkillSharingRequestError('invalidResponse', 'Invalid skill-sharing result');
  return data.result;
}
