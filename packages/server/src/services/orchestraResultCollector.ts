/**
 * The entry command's output is provisional until its critique/rework chain is quiet.
 * Call finish only after completion callbacks have scheduled all follow-up commands.
 * No queue or graph access: the caller supplies whether member work is still pending.
 */
import type { DispatchJobOutcome } from './taskEdgeDispatchJobs.js';

export type OrchestraCollectedCommand = DispatchJobOutcome & { id: string };

export interface OrchestraResultMetadata {
  agentId?: string;
  critiqueEdgeId?: string;
  critiqueVerdict?: 'approve' | 'reject' | 'held';
  reworkAgentId?: string;
}

export interface OrchestraCollectedResult extends DispatchJobOutcome {
  commandId: string;
  status: 'completed' | 'error';
  result: string;
}

interface CollectedReport {
  command: OrchestraCollectedCommand;
  metadata: OrchestraResultMetadata;
}

interface RunCollection {
  entryCommandId: string;
  entry?: CollectedReport;
  /** Keep only the latest report per critique edge, not the entire retry history. */
  critiques: Map<string, CollectedReport>;
  expectedCritiques: Set<string>;
  reworks: Map<string, number>;
  latestReworks: Map<string, CollectedReport>;
  memberFailure?: CollectedReport;
}

function commandFailed(command: OrchestraCollectedCommand): boolean {
  return command.status !== 'completed' || command.usageLimit !== undefined;
}

function failureReason(report: CollectedReport): string {
  const { command } = report;
  return command.errorMessage
    ?? (command.usageLimit ? 'Member stopped at a usage limit.' : `Member command ${command.id} ended with ${command.status}.`);
}

export class OrchestraResultCollector {
  private readonly runs = new Map<string, RunCollection>();

  /** A retried dispatch must keep all reports already collected for the original entry. */
  start(runId: string, entryCommandId: string): void {
    if (this.runs.has(runId)) return;
    this.runs.set(runId, {
      entryCommandId,
      critiques: new Map(),
      expectedCritiques: new Set(),
      reworks: new Map(),
      latestReworks: new Map(),
    });
  }

  activeRunIds(): string[] {
    return [...this.runs.keys()];
  }

  isEntry(runId: string, commandId: string): boolean {
    return this.runs.get(runId)?.entryCommandId === commandId;
  }

  entryCommandId(runId: string): string | undefined {
    return this.runs.get(runId)?.entryCommandId;
  }

  /** Register before scheduling a watcher so a failed schedule cannot look like approval. */
  expectCritique(runId: string, edgeId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.expectedCritiques.add(edgeId);
    // A previous approval only covers the previous worker result. The new watcher
    // must report even if scheduling it fails before a command enters the queue.
    run.critiques.delete(edgeId);
  }

  reworkCount(runId: string, edgeId: string): number {
    return this.runs.get(runId)?.reworks.get(edgeId) ?? 0;
  }

  /** The same reusable critique edge has an independent budget in every active run. */
  consumeRework(runId: string, edgeId: string, limit: number): boolean {
    const run = this.runs.get(runId);
    if (!run || !Number.isSafeInteger(limit) || limit <= 0) return false;
    const count = run.reworks.get(edgeId) ?? 0;
    if (count >= limit) return false;
    run.reworks.set(edgeId, count + 1);
    return true;
  }

  record(runId: string, command: OrchestraCollectedCommand, metadata: OrchestraResultMetadata = {}): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const report: CollectedReport = {
      command: { ...command, ...(command.usageLimit ? { usageLimit: { ...command.usageLimit } } : {}) },
      metadata: { ...metadata },
    };
    if (command.id === run.entryCommandId) {
      run.entry ??= report;
    }
    if (metadata.reworkAgentId && !commandFailed(command)) {
      run.latestReworks.set(metadata.reworkAgentId, report);
    }
    if (metadata.critiqueEdgeId) {
      run.expectedCritiques.add(metadata.critiqueEdgeId);
      run.critiques.set(metadata.critiqueEdgeId, report);
    } else if (commandFailed(command)) {
      run.memberFailure ??= report;
    }
  }

  /** Returns once per run; pending rework leaves all provisional reports in place. */
  finish(runId: string, hasPendingCommands: boolean): OrchestraCollectedResult | null {
    const run = this.runs.get(runId);
    if (!run?.entry || hasPendingCommands) return null;

    const parts = [run.entry.command.result ?? ''];
    const errors: string[] = [];
    let usageLimit = run.memberFailure?.command.usageLimit;
    if (run.memberFailure) {
      errors.push(failureReason(run.memberFailure));
      if (run.memberFailure.command.id !== run.entryCommandId && run.memberFailure.command.result) {
        parts.push(run.memberFailure.command.result);
      }
    }
    for (const [agentId, report] of run.latestReworks) {
      parts.push([`Latest rework (${agentId}):`, report.command.result ?? ''].filter(Boolean).join('\n'));
    }
    for (const edgeId of run.expectedCritiques) {
      const report = run.critiques.get(edgeId);
      if (!report) {
        errors.push(`Missing critique report for edge ${edgeId}.`);
        continue;
      }
      const verdict = report.metadata.critiqueVerdict;
      parts.push([
        `Critique ${edgeId}${report.metadata.agentId ? ` (${report.metadata.agentId})` : ''}: ${verdict ?? 'missing verdict'}`,
        report.command.result ?? '',
      ].filter(Boolean).join('\n'));
      if (commandFailed(report.command)) {
        errors.push(failureReason(report));
        usageLimit ??= report.command.usageLimit;
      } else if (verdict !== 'approve') {
        errors.push(`Critique ${edgeId}: ${verdict ?? 'missing verdict'}.`);
      }
    }
    this.runs.delete(runId);
    const errorMessage = errors.join('\n');
    if (errorMessage) parts.push(errorMessage);
    return {
      commandId: run.entryCommandId,
      status: errors.length > 0 ? 'error' : 'completed',
      result: parts.filter(Boolean).join('\n\n'),
      ...(errorMessage ? { errorMessage } : {}),
      ...(usageLimit ? { usageLimit } : {}),
    };
  }

  cancel(runId: string): string | undefined {
    const commandId = this.runs.get(runId)?.entryCommandId;
    this.runs.delete(runId);
    return commandId;
  }
}
