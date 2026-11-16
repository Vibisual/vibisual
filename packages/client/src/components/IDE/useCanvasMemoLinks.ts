import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionMemo } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { openMemoFileLink, openMemoUrl, type MemoLinkHost } from './useMemoLinkHost.js';
import { formatPromptStamp } from './promptStamp.js';

export function useCanvasMemoLinks(project: string | null): (memo: SessionMemo) => MemoLinkHost | null {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const hosts = new Map<string, MemoLinkHost>();
    return (memo: SessionMemo): MemoLinkHost | null => {
      const home = memo.canvas;
      if (!home || !project) return null;
      const cached = hosts.get(home.agentId);
      if (cached) return cached;
      const sessionInfo = (id: string | null): { label: string; alive: boolean } => {
        const state = useGraphStore.getState();
        const agent = state.agents.find((a) => a.id === home.agentId && !a.trashed);
        const sub = id ? state.subAgents[home.agentId]?.find((s) => s.id === id) : null;
        return { label: sub ? (state.subAgentLabels[sub.id] ?? sub.label) : agent?.label ?? '', alive: !!agent && (!id || !!sub) };
      };
      const rootPath = (): string | null => useGraphStore.getState().projects[project]?.path ?? null;
      const host: MemoLinkHost = {
        prompts: () => [],
        sessions: () => (useGraphStore.getState().subAgents[home.agentId] ?? []).map((s) => ({ id: s.id, label: sessionInfo(s.id).label })),
        sessionInfo, rootPath,
        formatTime: (at) => formatPromptStamp(at, i18n.language)?.text ?? '',
        open: async (target) => {
          try {
            if (target.kind === 'url') return openMemoUrl(target.url);
            if (target.kind === 'file') return await openMemoFileLink(target.path, rootPath(), project, t('ide.streamRenderer.pathLink.runFailed'));
            if (!sessionInfo(target.sessionId).alive) return false;
            useGraphStore.getState().openIDEOverlay(home.agentId, { focus: { sessionId: target.sessionId,
              ...(target.kind === 'stream' ? { bookmark: { text: target.text, ...(target.anchorId ? { anchorId: target.anchorId } : {}) } } : {}) } });
            return true;
          } catch {
            return false;
          }
        },
      };
      hosts.set(home.agentId, host);
      return host;
    };
  }, [project, i18n.language, t]);
}
