import { describe, expect, it } from 'vitest';
import { bashProcedureOutcome } from './bashProcedureOutcome.js';

describe('procedure observation outcomes', () => {
  it('requires a successful completed tool event', () => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PreToolUse' })).toBe('running');
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse' })).toBe('running');
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUseFailure' })).toBe('error');
  });
  it.each([{ exit_code: 1 }, { exitCode: 2 }, { is_error: true }, { isError: true }, { interrupted: true }])('excludes unsuccessful shell results %j', (tool_response) => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response })).toBe('error');
  });
  it('does not promote a background launch to a completed success', () => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_input: { run_in_background: true }, tool_response: { exit_code: 0 } })).toBe('running');
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response: { shell_id: 'bg' } })).toBe('running');
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response: {
      stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg',
    } })).toBe('running');
  });
  it.each([
    { exit_code: 0 }, { exitCode: 0 }, { is_error: false }, { isError: false },
    { stdout: 'contains error and exit code 1 as ordinary data', stderr: 'warning', interrupted: false },
  ])('accepts structured completed success without interpreting output %j', (tool_response) => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response })).toBe('success');
  });
  it.each([
    {}, { stdout: '' }, { content: [{ type: 'text', text: 'success exit 0' }] },
    { interrupted: false }, { status: 'completed' }, { exit_code: null }, { exit_code: '0' },
    { exit_code: NaN }, { exit_code: Infinity }, { exit_code: 0.5 },
    { exit_code: 0, exitCode: null }, { exit_code: '0', is_error: false },
    { exit_code: 0, status: 'in_progress' }, { exit_code: 0, status: 'unknown' },
  ])('leaves incomplete or unknown results unconfirmed %j', (tool_response) => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response })).toBe('running');
  });
  it.each([
    { exit_code: 0, exitCode: 7 }, { exit_code: 0, is_error: true },
    { status: 'failed', exit_code: 0 }, { status: 'cancelled' },
  ])('explicit failure takes precedence over a conflicting success field %j', (tool_response) => {
    expect(bashProcedureOutcome({ session_id: 's', hook_event_name: 'PostToolUse', tool_response })).toBe('error');
  });
});
