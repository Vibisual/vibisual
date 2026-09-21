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
  claudeAuth?: Pick<ClaudeAuthStatus, 'loggedIn' | 'error' | 'staleLoggedIn'> | null;
  codexSetup?: Pick<CodexSetupState, 'phase'> | null;
  codexAuth?: Pick<CodexAuthStatus, 'loggedIn' | 'error' | 'staleLoggedIn'> | null;
}

export function orchestraEnginePreparation(engine: OrchestraCliEngine, state: OrchestraReadiness): OrchestraPreparation | null {
  const setup = engine === 'codex' ? state.codexSetup : state.claudeSetup;
  const auth = engine === 'codex' ? state.codexAuth : state.claudeAuth;
  if (!setup || setup.phase === 'unknown') return { engine, action: 'refresh' };
  if (setup.phase !== 'ready') return { engine, action: 'setup' };
  if (!auth) return { engine, action: 'refresh' };
  // 탐침이 실패해도 직전 정상 판정(`staleLoggedIn`)이 남아 있으면 그것으로 판정한다 —
  // "모름" 한 번이 다음 폴링(10분)까지 편성을 막던 것을 끊는다. 이어 쓸 판정이 없을 때만 재조회.
  const loggedIn = auth.error !== undefined ? auth.staleLoggedIn : auth.loggedIn;
  if (loggedIn === undefined) return { engine, action: 'refresh' };
  return loggedIn ? null : { engine, action: 'login' };
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
