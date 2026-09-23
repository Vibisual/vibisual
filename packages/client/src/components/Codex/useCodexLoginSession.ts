import { useCallback } from 'react';
import { CODEX_AUTH_LOGIN_POLL_INTERVAL_MS, CODEX_AUTH_LOGIN_TERM_ID } from '@vibisual/shared';
import type { CodexAuthLoginMode, CodexAuthStatus } from '@vibisual/shared';
import type { PackagedTerminalApi } from '../../transport/install-packaged-transport.js';
import { useLoginSession } from '../Auth/useLoginSession.js';
import { buildCodexLoginCommand, codexLoginPlatform } from './codexLoginCommand.js';

export function useCodexLoginSession(
  transport: PackagedTerminalApi | null,
  refreshAuth: () => Promise<CodexAuthStatus | null>,
  refreshModels: () => Promise<unknown>,
) {
  const session = useLoginSession(transport, refreshAuth, CODEX_AUTH_LOGIN_TERM_ID, CODEX_AUTH_LOGIN_POLL_INTERVAL_MS, refreshModels);
  const startSession = session.start;
  const start = useCallback((binPath: string, mode: CodexAuthLoginMode) =>
    startSession(buildCodexLoginCommand(binPath, mode, codexLoginPlatform(binPath)), { deviceAuth: mode === 'device' }),
  [startSession]);
  return { ...session, start };
}
