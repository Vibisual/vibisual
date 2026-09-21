import type { VerificationRun, VerificationTarget, VerificationTargetAvailability } from '@vibisual/shared';
import { parseVerificationTarget, verificationStepCompletion } from '@vibisual/shared';

export function verificationTargetLabel(target: VerificationTarget): string {
  return target.kind === 'browser' ? target.url : target.sourceName;
}

export function validVerificationTarget(target: VerificationTarget | undefined): target is VerificationTarget {
  return parseVerificationTarget(target) !== undefined;
}

/** A video is evidence only when it captures the same desktop target the verifier operates. */
export function canRecordVerificationRun(target: VerificationTarget | undefined, source: { sourceId: string } | undefined): boolean {
  return target?.kind === 'desktop' && !!source && target.sourceId === source.sourceId;
}

export async function probeVerificationTarget(target: VerificationTarget, signal?: AbortSignal): Promise<VerificationTargetAvailability> {
  const response = await fetch('/api/verification-target/probe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }), signal,
  });
  const data = await response.json() as VerificationTargetAvailability & { error?: string };
  if (!response.ok || typeof data.available !== 'boolean' || !Array.isArray(data.actions) || !Array.isArray(data.checks)) {
    throw new Error(data.error || data.reason || 'failed');
  }
  return data;
}

/** Counts reproduced steps, independently of the final verdict (later checks may still fail). */
export function verificationStepCoverage(run: Pick<VerificationRun, 'requiredSteps' | 'toolEvents' | 'procedure' | 'evidence'>): number {
  return verificationStepCompletion(run).filter(Boolean).length;
}

export function verificationOperationKey(kind: string): string {
  return `ide.verify.operation.${kind.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}

export function verificationEvidenceUrl(runId: string, evidenceId: string): string {
  return `/api/verification-runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceId)}.png`;
}
