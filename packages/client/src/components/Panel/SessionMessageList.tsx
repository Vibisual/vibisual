/**
 * §5.1 #3-4 — DetailPanel 의 관찰 두 칸. 서버가 준 그대로 그린다(시계·판정 ❌).
 *  - 에이전트: 최근 세션 간 메시지(보낸 것·받은 것 — 받는 이를 모르면 "바깥 세션").
 *  - 파일: 같은 파일을 짧은 간격으로 고친 에이전트들.
 */
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileWriteOverlap } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/** 한 칸에 보이는 최근 메시지 수 — 전부는 그 세션 스트림에 있다. */
const PANEL_MESSAGES_MAX = 8;

/** id → 표시명(사라진 에이전트는 id 앞 8자). 원시값 한 줄로 구독한다(배열 find 결과 객체 ❌). */
function useAgentNames(ids: readonly string[]): (id: string) => string {
  const key = [...new Set(ids)].sort().join('\n');
  const json = useGraphStore((s) => {
    const want = new Set(key === '' ? [] : key.split('\n'));
    const out: Record<string, string> = {};
    for (const a of s.agents) if (want.has(a.id)) out[a.id] = a.label;
    return JSON.stringify(out);
  });
  return useMemo(() => {
    const names = JSON.parse(json) as Record<string, string>;
    return (id: string) => names[id] || id.slice(0, 8);
  }, [json]);
}

export const SessionMessageList = memo(function SessionMessageList({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const links = useGraphStore((s) => s.sessionMessages);
  const mine = useMemo(
    () => links.filter((l) => l.fromAgentId === agentId || l.toAgentId === agentId).slice(-PANEL_MESSAGES_MAX).reverse(),
    [links, agentId],
  );
  const nameOf = useAgentNames(mine.flatMap((l) => [l.fromAgentId, ...(l.toAgentId ? [l.toAgentId] : [])]));
  if (mine.length === 0) return null;
  return (
    <div data-session-messages={agentId} className="flex min-w-0 flex-col gap-1 rounded border border-cyan-500/20 bg-cyan-500/5 p-2">
      <span className="text-xs font-semibold text-cyan-200/90">{t('canvas.sessionMessage.panelTitle')}</span>
      <ul className="flex min-w-0 flex-col gap-1">
        {mine.map((l) => {
          const sent = l.fromAgentId === agentId;
          const other = sent
            ? (l.toAgentId ? nameOf(l.toAgentId) : t('canvas.sessionMessage.outside', { name: l.to }))
            : nameOf(l.fromAgentId);
          return (
            <li key={l.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className={`flex-shrink-0 ${sent ? 'text-cyan-300' : 'text-gray-400'}`}>
                  {sent ? t('canvas.sessionMessage.sentTo') : t('canvas.sessionMessage.receivedFrom')}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-300" title={l.to}>{other}</span>
                <span className="flex-shrink-0 tabular-nums text-gray-600">
                  {new Date(l.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {l.preview && <p className="line-clamp-2 break-words text-xs leading-snug text-gray-500">{l.preview}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-snug text-gray-600">{t('canvas.sessionMessage.panelNote')}</p>
    </div>
  );
});

export const FileWriteOverlapNote = memo(function FileWriteOverlapNote({ overlap }: { overlap: FileWriteOverlap }): React.JSX.Element {
  const { t } = useTranslation();
  const nameOf = useAgentNames(overlap.agentIds);
  const minutes = Math.max(1, Math.round((overlap.lastAt - overlap.firstAt) / 60_000));
  return (
    <p data-write-overlap className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-xs leading-snug text-amber-200/90">
      {t('canvas.writeOverlap.panel', { names: overlap.agentIds.map(nameOf).join(', '), minutes })}
    </p>
  );
});
