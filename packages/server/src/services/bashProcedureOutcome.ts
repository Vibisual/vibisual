import type { BashEntry, HookEventPayload } from '@vibisual/shared';

/** A background launch and an unknown legacy result are not successful executions. */
export function bashProcedureOutcome(payload: HookEventPayload): NonNullable<BashEntry['status']> {
  if (payload.hook_event_name === 'PostToolUseFailure') return 'error';
  if (payload.hook_event_name !== 'PostToolUse') return 'running';
  const response = payload.tool_response;
  if (!response) return 'running';
  if (response['is_error'] === true || response['isError'] === true || response['interrupted'] === true) return 'error';
  const status = response['status'];
  if (status === 'failed' || status === 'error' || status === 'cancelled') return 'error';
  const exitCodes = [response['exit_code'], response['exitCode']].filter((code) => code !== undefined);
  if (exitCodes.some((code) => typeof code === 'number' && Number.isInteger(code) && code !== 0)) return 'error';
  if (payload.tool_input?.['run_in_background'] === true || response['backgroundTaskId'] || response['shell_id']) return 'running';
  if (status !== undefined && status !== 'completed' && status !== 'success') return 'running';
  if (exitCodes.length > 0) return exitCodes.every((code) => code === 0) ? 'success' : 'running';
  // Local/Codex adapters carry this flag only after their execution result is known.
  if (response['is_error'] === false || response['isError'] === false) return 'success';
  // Claude foreground Bash returns these structured fields; empty/legacy content is not proof.
  if (typeof response['stdout'] === 'string' && typeof response['stderr'] === 'string' && response['interrupted'] === false) return 'success';
  return 'running';
}
