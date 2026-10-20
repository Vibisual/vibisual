import type { CommandExecutionRequirements } from '@vibisual/shared';

/** Capability requests are booleans, never executable code or saved profile overrides. */
export function normalizeExecutionRequirements(value: unknown): CommandExecutionRequirements | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).localTransport === true ? { localTransport: true } : undefined;
}
