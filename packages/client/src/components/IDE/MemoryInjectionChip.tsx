import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrainInjectionEvent } from '@vibisual/shared';
import { useGraphStore, selectEffectiveProject } from '../../stores/graphStore.js';

interface MemoryInjectionChipProps {
  event: BrainInjectionEvent;
}

/** §5.10 — IDE 스트림 "기억 N장 참조" 접이식 칩. 펼치면 주입된 카드 제목 목록, 클릭 시 카드 상세. */
export function MemoryInjectionChip({ event }: MemoryInjectionChipProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectBrainCard = useGraphStore((s) => s.selectBrainCard);
  const project = useGraphStore(selectEffectiveProject);
  // §5.10 v3.49 — 이 칩에서 👍 도움됨을 누른 카드 id(낙관적, 재클릭 방지 + 강조).
  const [helped, setHelped] = useState<Record<string, true>>({});
  const n = event.cardIds.length;

  const markHelpful = useCallback((cardId: string) => {
    setHelped((prev) => ({ ...prev, [cardId]: true }));
    void fetch(`/api/brain/cards/${cardId}/helpful`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  }, [project]);

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-xs text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5a3 3 0 0 0-5.6-1.5A2.5 2.5 0 0 0 4 6a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 2 4 3 3 0 0 0 6 .5 3 3 0 0 0 6-.5 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0-2.4-2.5A3 3 0 0 0 12 5Z" />
        </svg>
        <span>{t('ide.memoryChip.label', { defaultValue: '기억 {{n}}장 참조', n })}</span>
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-2">
          {event.cardTitles.map((title, i) => {
            const cardId = event.cardIds[i];
            return (
              <li key={cardId ?? i} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { if (cardId) selectBrainCard(cardId, { agentId: event.agentId }); }}
                  className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-xs text-fuchsia-200/80 hover:bg-fuchsia-500/10 hover:text-fuchsia-100"
                  title={title}
                >
                  {title}
                </button>
                {cardId && (
                  <button
                    type="button"
                    onClick={() => markHelpful(cardId)}
                    disabled={!!helped[cardId]}
                    className={`shrink-0 rounded p-1 transition-colors ${helped[cardId] ? 'text-pink-300' : 'text-fuchsia-200/50 hover:bg-fuchsia-500/10 hover:text-pink-300'}`}
                    title={t('brain.feed.helpful', { defaultValue: '도움됨' })}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={helped[cardId] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
