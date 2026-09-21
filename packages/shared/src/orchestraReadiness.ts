/** Cached CLI probes are shared by the preparation UI and the dispatch preflight. */
import type { ClaudeAuthStatus, ClaudeSetupState, CodexAuthStatus, CodexSetupState, OrchestraSettings } from './types.js';
import { resolveOrchestraMemberEngine } from './orchestraScope.js';

export type OrchestraCliEngine = 'claude' | 'codex';
export type OrchestraPreparationAction = 'setup' | 'login' | 'refresh';
export interface OrchestraPreparation {
  engine: OrchestraCliEngine;
  action: OrchestraPreparationAction;
}
export interface OrchestraReadiness {
  claudeSetup?: Pick<ClaudeSetupState, 'phase'> | null;
  claudeAuth?: Pick<ClaudeAuthStatus, 'loggedIn' | 'error'> | null;
  codexSetup?: Pick<CodexSetupState, 'phase'> | null;
  codexAuth?: Pick<CodexAuthStatus, 'loggedIn' | 'error'> | null;
}

export function orchestraEnginePreparation(engine: OrchestraCliEngine, state: OrchestraReadiness): OrchestraPreparation | null {
  const setup = engine === 'codex' ? state.codexSetup : state.claudeSetup;
  const auth = engine === 'codex' ? state.codexAuth : state.claudeAuth;
  if (!setup || setup.phase === 'unknown') return { engine, action: 'refresh' };
  if (setup.phase !== 'ready') return { engine, action: 'setup' };
  if (!auth || auth.error) return { engine, action: 'refresh' };
  return auth.loggedIn ? null : { engine, action: 'login' };
}

/** Auto may select only ready engines; it does not require installing both CLIs. */
export function orchestraReadyEngines(state: OrchestraReadiness): OrchestraCliEngine[] {
  return (['claude', 'codex'] as const).filter((engine) => orchestraEnginePreparation(engine, state) === null);
}

/** Reject before opening a run. The caller retains the request and offers the existing preparation gate. */
export function orchestraPreparationForRequest(
  settings: OrchestraSettings | null | undefined,
  conductorEngine: OrchestraCliEngine,
  state: OrchestraReadiness,
): OrchestraPreparation | null {
  const conductor = orchestraEnginePreparation(conductorEngine, state);
  if (conductor) return conductor;
  const memberEngine = resolveOrchestraMemberEngine(settings, conductorEngine);
  return memberEngine === 'auto' ? null : orchestraEnginePreparation(memberEngine, state);
}
