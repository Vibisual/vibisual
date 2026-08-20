import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrainCard, BrainCardType } from '@vibisual/shared';
import { BRAIN_TOPICS, BRAIN_TOPIC_MISC_TITLE } from '@vibisual/shared';
import { useGraphStore, selectEffectiveProject } from '../../stores/graphStore.js';
import { BRAIN_TYPE_COLORS } from '../../hooks/useBubbleLayout.js';

/**
 * §5.10 — 기억 카드 5종 타입별 라벨 키. 색은 v3.75 뮤트 팔레트(BRAIN_TYPE_COLORS) 단일 출처를 쓴다
 * — 여기에 색을 또 적어두면 팔레트를 바꿀 때 한쪽만 바뀌어 화면이 갈린다.
 */
const TYPE_META: Record<BrainCardType, { color: string; labelKey: string; fallback: string }> = {
  decision: { color: BRAIN_TYPE_COLORS.decision, labelKey: 'brain.type.decision', fallback: '결정' },
  mistake: { color: BRAIN_TYPE_COLORS.mistake, labelKey: 'brain.type.mistake', fallback: '실수' },
  lesson: { color: BRAIN_TYPE_COLORS.lesson, labelKey: 'brain.type.lesson', fallback: '교훈' },
  rule: { color: BRAIN_TYPE_COLORS.rule, labelKey: 'brain.type.rule', fallback: '규칙' },
  fact: { color: BRAIN_TYPE_COLORS.fact, labelKey: 'brain.type.fact', fallback: '사실' },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { hour12: false });
}

interface BrainCardDetailProps {
  card: BrainCard;
}

/** §5.10 — 기억 카드 상세(DetailPanel 조기 return). CaptureBubbleDetail 구조 계승. */
export function BrainCardDetail({ card }: BrainCardDetailProps): React.JSX.Element {
  const { t } = useTranslation();
  const project = useGraphStore(selectEffectiveProject);
  const promoteBrainCard = useGraphStore((s) => s.promoteBrainCard);
  const setBrainCardPinned = useGraphStore((s) => s.setBrainCardPinned);
  const updateBrainCard = useGraphStore((s) => s.updateBrainCard);
  const deleteBrainCard = useGraphStore((s) => s.deleteBrainCard);
  const selectBrainCard = useGraphStore((s) => s.selectBrainCard);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editBody, setEditBody] = useState(card.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** §5.10 v3.78 — 대체 이력 체인(이 카드가 닫은 옛 카드 / 이 카드를 닫은 새 카드). */
  const [chain, setChain] = useState<{ older: BrainCard[]; newer: BrainCard[] } | null>(null);

  useEffect(() => {
    setEditing(false);
    setEditTitle(card.title);
    setEditBody(card.body);
    setConfirmDelete(false);
  }, [card.id]);

  // 체인은 대체 관계가 실제로 있을 때만 조회한다(관계 없는 카드에 헛 요청 ❌).
  useEffect(() => {
    const has = (card.supersedes && card.supersedes.length > 0) || !!card.supersededBy;
    if (!has) { setChain(null); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        const q = project ? `?project=${encodeURIComponent(project)}` : '';
        const res = await fetch(`/api/brain/cards/${card.id}/chain${q}`);
        if (!res.ok) return;
        const data = await res.json() as { older?: BrainCard[]; newer?: BrainCard[] };
        if (!cancelled) setChain({ older: data.older ?? [], newer: data.newer ?? [] });
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [card.id, card.supersededBy, card.supersedes, project]);

  const meta = TYPE_META[card.type];
  // §5.10 v3.74 — 주제 표시명(상수에 없는 slug 는 미분류로 폴백). 번역 키가 있으면 그것을 우선.
  const topicTitle = card.topic
    ? t(`brain.topic.${card.topic}`, {
        defaultValue: BRAIN_TOPICS.find((x) => x.slug === card.topic)?.title ?? BRAIN_TOPIC_MISC_TITLE,
      })
    : '';
  // §5.10 v3.74 — 상시 규칙 토글은 프로젝트 층 규칙 카드에서만 의미가 있다.
  const canToggleAlways = card.scope === 'project' && card.type === 'rule';

  const handleSaveEdit = useCallback(() => {
    void updateBrainCard(card.id, { title: editTitle.trim() || card.title, body: editBody });
    setEditing(false);
  }, [updateBrainCard, card.id, card.title, editTitle, editBody]);

  const handleOpenFile = useCallback((path: string) => {
    fetch(`/api/open-node-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodePath: path, absolutePath: null }),
    }).catch(() => {});
  }, []);

  return (
    <div className="p-4 space-y-4">
      {/* 타입 칩 + pinned */}
      <div className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-bold"
          style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
        >
          {t(meta.labelKey, { defaultValue: meta.fallback })}
        </span>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {card.scope === 'project'
            ? t('brain.scopeProject', { defaultValue: '프로젝트 두뇌' })
            : t('brain.scopeAgent', { defaultValue: '개별 기억' })}
        </span>
        {card.pinned && (
          <svg className="h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        )}
        {card.status === 'ghost' && (
          <span className="rounded bg-gray-700/60 px-2 py-0.5 text-xs text-gray-400">
            {t('brain.statusGhost', { defaultValue: '재검토 필요' })}
          </span>
        )}
        {/* §5.10 v3.78 — 승격 시 원 소유 에이전트 링크가 남는다(그 에이전트가 지식을 잃지 않게). */}
        {card.promotedFrom && (
          <span
            className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400"
            title={t('brain.promotedFromTip', { defaultValue: '이 기억을 키운 커스텀 에이전트' })}
          >
            {t('brain.promotedFrom', { defaultValue: '{{agent}} 에서 승격', agent: card.promotedFrom })}
          </span>
        )}
        {/* §5.10 v3.74 — 주제 배지(프로젝트 층 전용). 이 카드가 어느 주제 문서에 실리는지 보여준다. */}
        {card.scope === 'project' && card.topic && (
          <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-300" title={t('brain.topicTip', { defaultValue: '이 카드가 실리는 주제 문서' })}>
            {topicTitle}
          </span>
        )}
        {/* §5.10 v3.74 — 상시 규칙 표시. 켜진 카드만 모든 스폰 브리핑에 실린다. */}
        {card.always && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
            {t('brain.alwaysBadge', { defaultValue: '상시' })}
          </span>
        )}
      </div>

      {/* 제목/본문 (편집 모드 토글) */}
      {editing ? (
        <div className="space-y-2">
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded border border-blue-500 bg-gray-800 px-2 py-1 text-sm font-bold text-gray-100 outline-none"
          />
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={8}
            className="w-full resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleSaveEdit} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">
              {t('brain.save', { defaultValue: '저장' })}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-600">
              {t('brain.cancel', { defaultValue: '취소' })}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-base font-bold text-gray-100">{card.title}</h3>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-300">{card.body}</pre>
        </div>
      )}

      {card.supersededNote && (
        <div className="rounded border border-gray-700 bg-gray-800/50 p-2 text-xs text-gray-400">
          <div className="mb-1 font-semibold text-gray-300">{t('brain.supersededNote', { defaultValue: '이전 내용 이력' })}</div>
          {card.supersededNote}
        </div>
      )}

      {/* §5.10 v3.78 — 대체 이력 체인. "왜 바뀌었는지"를 삭제하지 않고 추적할 수 있게 한다. */}
      {chain && (chain.older.length > 0 || chain.newer.length > 0) && (
        <div className="space-y-2 rounded border border-gray-700 bg-gray-800/40 p-2">
          <div className="text-xs font-semibold text-gray-300">{t('brain.chainTitle', { defaultValue: '대체 이력' })}</div>
          {chain.older.length > 0 && (
            <div className="space-y-1">
              <div className="text-[12px] uppercase tracking-wide text-gray-500">
                {t('brain.chainOlder', { defaultValue: '이 카드가 대체한 기억' })}
              </div>
              {chain.older.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => selectBrainCard(o.id)}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-gray-400 line-through decoration-gray-600 hover:bg-gray-800 hover:text-gray-200"
                  title={o.title}
                >
                  {o.title}
                </button>
              ))}
            </div>
          )}
          {chain.newer.length > 0 && (
            <div className="space-y-1">
              <div className="text-[12px] uppercase tracking-wide text-gray-500">
                {t('brain.chainNewer', { defaultValue: '이 카드를 대체한 기억(현재)' })}
              </div>
              {chain.newer.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => selectBrainCard(n.id)}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-indigo-300 hover:bg-gray-800"
                  title={n.title}
                >
                  {n.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 연결 파일 */}
      {card.files.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('brain.linkedFiles', { defaultValue: '연결 파일' })}
          </div>
          {card.files.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => handleOpenFile(f)}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-sky-300 hover:bg-gray-800"
              title={f}
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
              </svg>
              <span className="truncate">{f}</span>
            </button>
          ))}
        </div>
      )}

      {/* 메타 */}
      <div className="space-y-1 border-t border-gray-800 pt-3 text-xs text-gray-500">
        <div>{t('brain.refCount', { defaultValue: '참조' })}: {card.refCount}</div>
        {card.lastReferencedAt && <div>{t('brain.lastReferenced', { defaultValue: '마지막 참조' })}: {formatTime(card.lastReferencedAt)}</div>}
        <div>{t('brain.createdAt', { defaultValue: '생성' })}: {formatTime(card.createdAt)}</div>
        {card.sourceSessionId && (
          <div className="truncate" title={card.sourceSessionId}>
            {t('brain.sourceSession', { defaultValue: '출처 세션' })}: {card.sourceSessionId}
          </div>
        )}
      </div>

      {/* 버튼 */}
      <div className="flex flex-wrap gap-2 border-t border-gray-800 pt-3">
        {card.scope === 'agent' && (
          <button
            type="button"
            onClick={() => void promoteBrainCard(card.id)}
            className="rounded bg-indigo-600/80 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            {t('brain.promote', { defaultValue: '프로젝트 두뇌로 승격' })}
          </button>
        )}
        <button
          type="button"
          onClick={() => void setBrainCardPinned(card.id, !card.pinned)}
          className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-100 hover:bg-gray-600"
        >
          {card.pinned ? t('brain.unpin', { defaultValue: '고정 해제' }) : t('brain.pin', { defaultValue: '고정' })}
        </button>
        {/* §5.10 v3.74 — 상시 규칙 토글. 켜면 주제와 무관하게 모든 스폰 브리핑에 실린다(소수만 권장). */}
        {canToggleAlways && (
          <button
            type="button"
            onClick={() => void updateBrainCard(card.id, { always: !card.always })}
            title={t('brain.alwaysTip', { defaultValue: '켜면 어떤 작업의 브리핑에도 이 규칙이 실립니다. 정말 항상 지켜야 하는 소수만 켜세요.' })}
            className={card.always
              ? 'flex items-center gap-1 rounded bg-amber-600/80 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500'
              : 'flex items-center gap-1 rounded bg-gray-700 px-3 py-1 text-xs text-gray-100 hover:bg-gray-600'}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {card.always
              ? t('brain.alwaysOff', { defaultValue: '상시 해제' })
              : t('brain.alwaysOn', { defaultValue: '상시 규칙으로' })}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-100 hover:bg-gray-600"
          >
            {t('brain.edit', { defaultValue: '편집' })}
          </button>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-300">{t('brain.deleteConfirm', { defaultValue: '삭제할까요?' })}</span>
            <button type="button" onClick={() => void deleteBrainCard(card.id)} className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500">
              {t('brain.deleteYes', { defaultValue: '삭제' })}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-600">
              {t('brain.cancel', { defaultValue: '취소' })}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded bg-red-900/40 px-3 py-1 text-xs text-red-300 hover:bg-red-900/60"
          >
            {t('brain.delete', { defaultValue: '삭제' })}
          </button>
        )}
      </div>
    </div>
  );
}
