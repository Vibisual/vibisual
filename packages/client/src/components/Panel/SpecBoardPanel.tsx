import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPEC_ITEM_TEXT_MAX, SPEC_MAX_ITEMS } from '@vibisual/shared';
import type { SpecItem } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §5.15 / §7.14 — 스펙 보드 패널.
 *
 * 스펙 버블 더블클릭으로 열리는 전체 화면 오버레이(§7.13 `ContiBoardPanel` 패턴 차용).
 * 왼쪽은 요구사항 본문(마크다운), 오른쪽은 수용 기준 목록이다 — 그리고 **거기서 작업 카드를
 * 만든다.** 스펙이 바뀌어 낡은 카드는 "스펙 변경됨" 으로 표시만 하고, 지우거나 다시 만드는
 * 판단은 사람이 한다.
 */

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function TrashGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function StaleGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

function CardGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h6M7 14h4" />
    </svg>
  );
}

export function SpecBoardPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const openId = useGraphStore((s) => s.specBoardOpenId);
  const close = useGraphStore((s) => s.closeSpecBoard);
  const specDocs = useGraphStore((s) => s.specDocs);
  const agents = useGraphStore((s) => s.agents);
  const updateSpecDoc = useGraphStore((s) => s.updateSpecDoc);
  const addSpecItem = useGraphStore((s) => s.addSpecItem);
  const generateSpecTasks = useGraphStore((s) => s.generateSpecTasks);
  const detachSpecTask = useGraphStore((s) => s.detachSpecTask);
  const selectNode = useGraphStore((s) => s.selectNode);

  const doc = useMemo(() => specDocs.find((d) => d.id === openId) ?? null, [specDocs, openId]);

  /** 본문·제목은 타이핑 동안 로컬에 두고 blur/저장에서만 서버로 — 매 글자 왕복은 개정 번호를 더럽힌다. */
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [newItem, setNewItem] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitleDraft(doc?.title ?? '');
    setBodyDraft(doc?.body ?? '');
    setNewItem('');
    setEditingItemId(null);
  }, [doc?.id]);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, close]);

  const counts = useMemo(() => {
    if (!doc) return { total: 0, done: 0, carded: 0, stale: 0, pending: 0 };
    let done = 0;
    let carded = 0;
    let stale = 0;
    for (const it of doc.items) {
      if (it.done === true) done += 1;
      if (it.taskAgentId) {
        carded += 1;
        if ((it.generatedRevision ?? 0) < doc.bodyRevision) stale += 1;
      }
    }
    return { total: doc.items.length, done, carded, stale, pending: doc.items.length - carded };
  }, [doc]);

  const commitTitle = useCallback((): void => {
    if (!doc) return;
    const next = titleDraft.trim();
    if (next === doc.title) return;
    void updateSpecDoc(doc.id, { title: next });
  }, [doc, titleDraft, updateSpecDoc]);

  const commitBody = useCallback((): void => {
    if (!doc) return;
    if (bodyDraft === doc.body) return;
    void updateSpecDoc(doc.id, { body: bodyDraft });
  }, [doc, bodyDraft, updateSpecDoc]);

  /** 항목 목록은 통째로 보낸다 — 서버가 id 를 보고 무엇이 달라졌는지 판정한다. */
  const commitItems = useCallback((items: SpecItem[]): void => {
    if (!doc) return;
    void updateSpecDoc(doc.id, { items });
  }, [doc, updateSpecDoc]);

  const toggleDone = useCallback((itemId: string): void => {
    if (!doc) return;
    commitItems(doc.items.map((it) => (it.id === itemId ? { ...it, done: it.done !== true } : it)));
  }, [doc, commitItems]);

  const removeItem = useCallback((itemId: string): void => {
    if (!doc) return;
    commitItems(doc.items.filter((it) => it.id !== itemId));
  }, [doc, commitItems]);

  const commitItemText = useCallback((itemId: string): void => {
    if (!doc) return;
    const text = itemDraft.trim();
    setEditingItemId(null);
    if (!text) return;
    const current = doc.items.find((it) => it.id === itemId);
    if (!current || current.text === text) return;
    commitItems(doc.items.map((it) => (it.id === itemId ? { ...it, text } : it)));
  }, [doc, itemDraft, commitItems]);

  const addItem = useCallback((): void => {
    if (!doc) return;
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    void addSpecItem(doc.id, text);
  }, [doc, newItem, addSpecItem]);

  const generateAll = useCallback((): void => {
    if (!doc || counts.pending === 0) return;
    setBusy(true);
    void generateSpecTasks(doc.id).finally(() => setBusy(false));
  }, [doc, counts.pending, generateSpecTasks]);

  const generateOne = useCallback((itemId: string): void => {
    if (!doc) return;
    setBusy(true);
    void generateSpecTasks(doc.id, [itemId]).finally(() => setBusy(false));
  }, [doc, generateSpecTasks]);

  /** "스펙 변경됨" 을 확인 처리 — 카드를 다시 만들지 않고 개정 번호만 지금 값으로 올린다. */
  const acknowledgeStale = useCallback((itemId: string): void => {
    if (!doc) return;
    setBusy(true);
    void generateSpecTasks(doc.id, [itemId], true).finally(() => setBusy(false));
  }, [doc, generateSpecTasks]);

  if (!openId || !doc) return null;

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* 헤더 — 제목 인라인 편집 + 개정 번호 + 닫기 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-4 py-3">
        <span className="rounded bg-teal-900/60 px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-teal-200">
          {t('canvas.spec.title', { defaultValue: '스펙' })}
        </span>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={t('canvas.spec.untitled', { defaultValue: '제목 없는 스펙' })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-gray-100 outline-none transition-colors hover:border-gray-700 focus:border-teal-600"
        />
        <span className="shrink-0 rounded bg-gray-800 px-2 py-1 text-[12px] text-gray-400">
          {t('canvas.spec.revision', { count: doc.bodyRevision, defaultValue: '개정 {{count}}' })}
        </span>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label={t('common.close', { defaultValue: '닫기' })}
        >
          <CloseGlyph />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 왼쪽 — 요구사항 본문(마크다운) */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-gray-800">
          <div className="shrink-0 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('canvas.spec.bodyLabel', { defaultValue: '요구사항 본문 (마크다운)' })}
          </div>
          <textarea
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            onBlur={commitBody}
            spellCheck={false}
            placeholder={t('canvas.spec.bodyPlaceholder', { defaultValue: '무엇을 만드는지, 왜 만드는지, 어디까지가 범위인지를 적습니다.' })}
            className="m-4 min-h-0 flex-1 resize-none rounded-lg border border-gray-800 bg-gray-900 p-3 font-mono text-[13px] leading-relaxed text-gray-200 outline-none transition-colors focus:border-teal-700"
          />
        </div>

        {/* 오른쪽 — 수용 기준 + 작업 카드 */}
        <div className="flex w-[420px] shrink-0 flex-col">
          <div className="flex shrink-0 items-center gap-2 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span>{t('canvas.spec.criteria', { defaultValue: '수용 기준' })}</span>
            <span className="text-gray-400">{counts.done}/{counts.total}</span>
            {counts.stale > 0 ? (
              <span className="ml-auto flex items-center gap-1 normal-case text-amber-300">
                <StaleGlyph />
                {t('canvas.spec.staleCount', { count: counts.stale, defaultValue: '스펙 변경됨 {{count}}' })}
              </span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {doc.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">
                {t('canvas.spec.emptyItems', { defaultValue: '아직 수용 기준이 없습니다 · 아래에 한 줄씩 적으세요' })}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {doc.items.map((item, idx) => {
                  const stale = item.taskAgentId !== undefined && (item.generatedRevision ?? 0) < doc.bodyRevision;
                  const agentLabel = item.taskAgentId
                    ? agents.find((a) => a.id === item.taskAgentId)?.label
                    : undefined;
                  return (
                    <li
                      key={item.id}
                      className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5 transition-colors hover:border-gray-700"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={item.done === true}
                          onChange={() => toggleDone(item.id)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-teal-500"
                        />
                        {editingItemId === item.id ? (
                          <input
                            autoFocus
                            value={itemDraft}
                            maxLength={SPEC_ITEM_TEXT_MAX}
                            onChange={(e) => setItemDraft(e.target.value)}
                            onBlur={() => commitItemText(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') setEditingItemId(null);
                            }}
                            className="min-w-0 flex-1 rounded border border-teal-700 bg-gray-950 px-1.5 py-0.5 text-[13px] text-gray-100 outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingItemId(item.id); setItemDraft(item.text); }}
                            className={`min-w-0 flex-1 text-left text-[13px] leading-snug ${item.done === true ? 'text-gray-500 line-through' : 'text-gray-200'}`}
                          >
                            <span className="mr-1.5 text-gray-600">{idx + 1}.</span>
                            {item.text}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-rose-300"
                          aria-label={t('canvas.spec.removeItem', { defaultValue: '수용 기준 삭제' })}
                        >
                          <TrashGlyph />
                        </button>
                      </div>

                      {/* 작업 카드 상태 — 미생성 / 생성됨 / 스펙 변경됨 */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
                        {item.taskAgentId ? (
                          <>
                            <button
                              type="button"
                              onClick={() => selectNode(item.taskAgentId ?? null)}
                              className="flex items-center gap-1 rounded bg-blue-950/70 px-1.5 py-0.5 text-[12px] text-blue-200 transition-colors hover:bg-blue-900/70"
                            >
                              <CardGlyph />
                              {agentLabel ?? t('canvas.spec.cardMissing', { defaultValue: '카드(버블 없음)' })}
                            </button>
                            {stale ? (
                              <>
                                <span className="flex items-center gap-1 rounded bg-amber-950/70 px-1.5 py-0.5 text-[12px] font-semibold text-amber-200">
                                  <StaleGlyph />
                                  {t('canvas.spec.stale', { defaultValue: '스펙 변경됨' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => acknowledgeStale(item.id)}
                                  disabled={busy}
                                  className="rounded bg-gray-800 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
                                >
                                  {t('canvas.spec.acknowledge', { defaultValue: '확인함' })}
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void detachSpecTask(doc.id, item.id)}
                              className="rounded px-1.5 py-0.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
                            >
                              {t('canvas.spec.detach', { defaultValue: '연결 끊기' })}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => generateOne(item.id)}
                            disabled={busy}
                            className="rounded bg-teal-900/70 px-1.5 py-0.5 text-[12px] text-teal-200 transition-colors hover:bg-teal-800/70 disabled:opacity-50"
                          >
                            {t('canvas.spec.generateOne', { defaultValue: '이 항목으로 작업 카드' })}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 하단 컨트롤 — 항목 추가 + 작업 카드 만들기 */}
          <div className="shrink-0 border-t border-gray-800 p-3">
            <div className="flex gap-2">
              <input
                value={newItem}
                maxLength={SPEC_ITEM_TEXT_MAX}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
                placeholder={t('canvas.spec.addItemPlaceholder', { defaultValue: '수용 기준 한 줄…' })}
                disabled={doc.items.length >= SPEC_MAX_ITEMS}
                className="min-w-0 flex-1 rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-[13px] text-gray-200 outline-none transition-colors focus:border-teal-700 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={!newItem.trim() || doc.items.length >= SPEC_MAX_ITEMS}
                className="shrink-0 rounded bg-gray-800 px-3 py-1.5 text-[13px] text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {t('canvas.spec.add', { defaultValue: '추가' })}
              </button>
            </div>
            <button
              type="button"
              onClick={generateAll}
              disabled={busy || counts.pending === 0}
              className="mt-2 w-full rounded bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
            >
              {busy
                ? t('canvas.spec.generating', { defaultValue: '작업 카드 만드는 중…' })
                : t('canvas.spec.generateTasksN', { count: counts.pending, defaultValue: '작업 카드 만들기 ({{count}})' })}
            </button>
            <p className="mt-1.5 text-[12px] leading-snug text-gray-500">
              {t('canvas.spec.generateHint', { defaultValue: '수용 기준 하나당 작업 카드 하나가 생기고, 만든 순서대로 Task Edge 로 이어집니다. 이미 카드가 있는 항목은 건너뜁니다.' })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
