import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillSharingEntry } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { readIDEPane, useIDEPaneKey } from './idePane.js';
import { readSkillSharing, shareSkill, SkillSharingRequestError } from './skillSharingApi.js';

export interface SkillSharingOptions {
  agentId: string | null;
  activeSessionId: string | null;
  provider: SkillSharingEntry['sourceProvider'];
  onUse: (name: string) => void;
  onShared: () => void;
}

interface SharingError {
  action: 'load' | 'share';
  reason: string;
  invalidResponse: boolean;
}

interface SharingState {
  skills: SkillSharingEntry[];
  loading: boolean;
  busyId: string | null;
  error: SharingError | null;
  used: boolean;
}

interface SkillSharingState extends SharingState {
  refresh: () => void;
  useSkill: (skill: SkillSharingEntry) => Promise<void>;
}

const INITIAL_STATE: SharingState = { skills: [], loading: true, busyId: null, error: null, used: false };

export function useSkillSharing(options: SkillSharingOptions): SkillSharingState {
  const { agentId, activeSessionId, provider } = options;
  const paneKey = useIDEPaneKey();
  const scopeKey = JSON.stringify([agentId, activeSessionId, provider, paneKey]);
  const scope = useRef({ key: scopeKey, current: true });
  if (scope.current.key !== scopeKey) {
    scope.current.current = false;
    scope.current = { key: scopeKey, current: true };
  }
  const [state, setState] = useState<SharingState>(INITIAL_STATE);
  const [revision, setRevision] = useState(0);
  const busy = useRef<string | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const owner = scope.current;
    owner.current = true;
    busy.current = null;
    setState(INITIAL_STATE);
    return () => { owner.current = false; };
  }, [scopeKey]);

  useEffect(() => {
    const owner = scope.current;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    if (!agentId) {
      setState({ ...INITIAL_STATE, loading: false });
      return () => controller.abort();
    }
    void readSkillSharing(agentId, provider, controller.signal).then((skills) => {
      if (owner.current && !controller.signal.aborted) setState((previous) => ({ ...previous, skills, loading: false }));
    }).catch((error: unknown) => {
      if (owner.current && !controller.signal.aborted) setState((previous) => ({
        ...previous, loading: false, error: sharingError('load', error),
      }));
    });
    return () => controller.abort();
  }, [agentId, provider, scopeKey, revision]);

  const useSkill = useCallback(async (skill: SkillSharingEntry): Promise<void> => {
    if (!agentId || busy.current || (skill.status !== 'available' && skill.status !== 'shared')) return;
    const owner = scope.current;
    const stillCurrent = (): boolean => {
      const pane = readIDEPane(paneKey);
      const kind = useGraphStore.getState().agentConfigs[agentId]?.provider?.kind;
      const sameProvider = provider === 'codex' ? kind === 'codex-cli' : kind === undefined;
      return owner.current && owner === scope.current
        && sameProvider && pane.agentId === agentId && pane.activeSessionId === activeSessionId;
    };
    if (!stillCurrent()) return;
    busy.current = skill.id;
    setState((previous) => ({ ...previous, busyId: skill.id, error: null, used: false }));
    try {
      // Revalidate already-shared rows too: either folder may have changed since the list was read.
      const result = await shareSkill(agentId, skill.id);
      if (!stillCurrent()) return;
      const succeeded = result.status === 'shared' || result.status === 'exists';
      setState((previous) => ({ ...previous, used: succeeded, skills: previous.skills.map((item) => item.id === skill.id
        ? { ...item, status: succeeded ? 'shared' : result.status === 'conflict' ? 'conflict' : 'unsupported', issues: result.issues ?? item.issues }
        : item) }));
      if (succeeded) {
        callbacks.current.onUse(result.name);
        callbacks.current.onShared();
      }
    } catch (error) {
      if (stillCurrent()) setState((previous) => ({ ...previous, error: sharingError('share', error) }));
    } finally {
      if (owner.current && owner === scope.current) {
        busy.current = null;
        setState((previous) => ({ ...previous, busyId: null }));
      }
    }
  }, [agentId, activeSessionId, provider, paneKey, scopeKey]);

  return { ...state, refresh, useSkill };
}

function sharingError(action: SharingError['action'], error: unknown): SharingError {
  return {
    action, reason: error instanceof Error ? error.message : String(error),
    invalidResponse: error instanceof SkillSharingRequestError && error.kind === 'invalidResponse',
  };
}
