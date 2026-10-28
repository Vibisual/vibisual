import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SHELF_COMMAND_MAX,
  SHELF_ICONS,
  SHELF_ITEM_COLORS,
  SHELF_MAX_ITEMS,
  SHELF_PROMPT_MAX,
} from '@vibisual/shared';
import type { ShelfIconName, ShelfItem, ShelfItemKind } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { ShelfItemGlyph } from '../BubbleMap/shelfIcons.js';
import { exportShelfFile, pickShelfFile } from '../BubbleMap/shelfTransfer.js';

/** §5.20 / §7.18 — 스크립트 선반(짜는 자리: 항목·순서·마지막 결과). 실행 결과는 서버 값(§3.1). */

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

function RunGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

function ArrowGlyph({ up }: { up: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      {up ? <path d="M12 19V5m-6 6 6-6 6 6" /> : <path d="M12 5v14m6-6-6 6-6-6" />}
    </svg>
  );
}

/** 값이 없으면 `—`. 0 으로 채우면 "즉시 끝났다"는 거짓말이 된다(§5.20). */
const EMPTY = '—';

function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return EMPTY;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function ShelfPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const openId = useGraphStore((s) => s.shelfPanelOpenId);
  const close = useGraphStore((s) => s.closeShelfPanel);
  const shelfBubbles = useGraphStore((s) => s.shelfBubbles);
  const agents = useGraphStore((s) => s.agents);
  const updateShelfBubble = useGraphStore((s) => s.updateShelfBubble);
  const addShelfItem = useGraphStore((s) => s.addShelfItem);
  const updateShelfItem = useGraphStore((s) => s.updateShelfItem);
  const removeShelfItem = useGraphStore((s) => s.removeShelfItem);
  const reorderShelfItems = useGraphStore((s) => s.reorderShelfItems);
  const runShelfItem = useGraphStore((s) => s.runShelfItem);
  const importShelfItems = useGraphStore((s) => s.importShelfItems);
  const selectNode = useGraphStore((s) => s.selectNode);

  const shelf = useMemo(() => shelfBubbles.find((b) => b.id === openId) ?? null, [shelfBubbles, openId]);

  /** 제목은 타이핑 동안 로컬에 두고 blur 에서만 서버로(매 글자 왕복 ❌). */
  const [titleDraft, setTitleDraft] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(shelf?.title ?? '');
    setExpandedId(null);
    setNotice(null);
  }, [shelf?.id]);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, close]);

  /** 프롬프트를 받을 후보 — **커스텀 에이전트만**(훅 버블은 우리가 명령을 보낼 카드가 아니다). */
  const targetOptions = useMemo(
    () => agents.filter((a) => a.customCreated === true && a.trashed !== true),
    [agents],
  );

  const commitTitle = useCallback((): void => {
    if (!shelf) return;
    const next = titleDraft.trim();
    if (next === shelf.title) return;
    void updateShelfBubble(shelf.id, { title: next });
  }, [shelf, titleDraft, updateShelfBubble]);

  const addItem = useCallback((kind: ShelfItemKind): void => {
    if (!shelf) return;
    void addShelfItem(shelf.id, {
      label: kind === 'command'
        ? t('canvas.shelf.newCommand', { defaultValue: '새 명령' })
        : t('canvas.shelf.newPrompt', { defaultValue: '새 프롬프트' }),
      kind,
      ...(kind === 'command' ? { command: '' } : { prompt: '' }),
    });
  }, [shelf, addShelfItem, t]);

  const move = useCallback((item: ShelfItem, delta: number): void => {
    if (!shelf) return;
    const ids = shelf.items.map((i) => i.id);
    const from = ids.indexOf(item.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, item.id);
    void reorderShelfItems(shelf.id, next);
  }, [shelf, reorderShelfItems]);

  const doExport = useCallback((): void => {
    if (!shelf) return;
    exportShelfFile({ version: 1, title: shelf.title, items: shelf.items });
  }, [shelf]);

  const doImport = useCallback((replace: boolean): void => {
    if (!shelf) return;
    void pickShelfFile().then((payload) => {
      if (payload === null) return;
      void importShelfItems(shelf.id, payload, replace).then((res) => {
        if (!res) {
          setNotice(t('canvas.shelf.importFailed', { defaultValue: '가져오지 못했습니다 — 선반 파일이 아닙니다.' }));
          return;
        }
        setNotice(t('canvas.shelf.imported', {
          added: res.added,
          dropped: res.dropped,
          defaultValue: '{{added}}개를 가져왔습니다 (버린 항목 {{dropped}}개)',
        }));
      });
    });
  }, [shelf, importShelfItems, t]);

  if (!openId || !shelf) return null;

  const atLimit = shelf.items.length >= SHELF_MAX_ITEMS;

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* 헤더 — 제목 인라인 편집 + 항목 수 + 내보내기/가져오기 + 닫기.
          폰 폭에서는 항목 수·내보내기·가져오기 묶음을 둘째 줄로 내린다 — 한 줄이면 고정 폭 단추들이
          화면을 넘어 [닫기]가 화면 밖으로 밀려났다(폰에는 Esc 도 없다). */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3 max-md:gap-2 max-md:px-3">
        <span className="rounded bg-cyan-900/60 px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-cyan-200">
          {t('canvas.shelf.title', { defaultValue: '선반' })}
        </span>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={t('canvas.shelf.untitled', { defaultValue: '이름 없는 선반' })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-gray-100 outline-none transition-colors hover:border-gray-700 focus:border-cyan-600"
        />
        <div className="flex shrink-0 items-center gap-3 max-md:order-last max-md:w-full max-md:flex-wrap max-md:gap-2">
          <span className="shrink-0 rounded bg-gray-800 px-2 py-1 text-[12px] text-gray-400">
            {t('canvas.shelf.itemCount', {
              count: shelf.items.length,
              max: SHELF_MAX_ITEMS,
              defaultValue: '항목 {{count}}/{{max}}',
            })}
          </span>
          <button
            type="button"
            onClick={doExport}
            disabled={shelf.items.length === 0}
            className="shrink-0 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-600"
          >
            {t('canvas.shelf.export', { defaultValue: '내보내기 (JSON)' })}
          </button>
          <button
            type="button"
            onClick={() => doImport(false)}
            className="shrink-0 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            {t('canvas.shelf.import', { defaultValue: '가져오기 (JSON)' })}
          </button>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          title={t('common.close', { defaultValue: '닫기' })}
        >
          <CloseGlyph />
        </button>
      </div>

      {notice ? (
        <div className="shrink-0 border-b border-gray-800 bg-gray-900/70 px-4 py-2 text-[13px] text-cyan-200">{notice}</div>
      ) : null}

      {/* 항목 목록 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {shelf.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
            {t('canvas.shelf.panelEmpty', { defaultValue: '아직 항목이 없습니다. 자주 쓰는 셸 명령이나 프롬프트를 올려 두면 캔버스에서 클릭 한 번으로 실행됩니다.' })}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {shelf.items.map((item, index) => {
              const expanded = expandedId === item.id;
              const run = item.lastRun;
              return (
                <li key={item.id} className="rounded-lg border border-gray-800 bg-gray-900/60">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span style={{ color: item.color }}>
                      <ShelfItemGlyph name={item.icon} />
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-semibold text-gray-100">{item.label}</span>
                      <span className="block truncate text-[12px] text-gray-500">
                        {item.kind === 'command' ? (item.command || EMPTY) : (item.prompt || EMPTY)}
                      </span>
                    </button>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                      item.kind === 'command' ? 'bg-slate-800 text-slate-300' : 'bg-indigo-900/60 text-indigo-200'
                    }`}>
                      {item.kind === 'command'
                        ? t('canvas.shelf.kindCommand', { defaultValue: '셸' })
                        : t('canvas.shelf.kindPrompt', { defaultValue: '프롬프트' })}
                    </span>
                    {/* 폰 폭에서는 손잡이 넷을 둘째 줄 오른쪽으로 내린다 — 한 줄이면 이름 칸이 50px 남짓으로 짓눌렸다. */}
                    <div className="flex shrink-0 items-center gap-2 max-md:w-full max-md:justify-end">
                      <button
                        type="button"
                        onClick={() => move(item, -1)}
                        disabled={index === 0}
                        title={t('canvas.shelf.moveUp', { defaultValue: '위로' })}
                        aria-label={t('canvas.shelf.moveUp', { defaultValue: '위로' })}
                        className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:text-gray-700 pointer-coarse:p-2.5"
                      >
                        <ArrowGlyph up />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(item, 1)}
                        disabled={index === shelf.items.length - 1}
                        title={t('canvas.shelf.moveDown', { defaultValue: '아래로' })}
                        aria-label={t('canvas.shelf.moveDown', { defaultValue: '아래로' })}
                        className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:text-gray-700 pointer-coarse:p-2.5"
                      >
                        <ArrowGlyph up={false} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { void runShelfItem(shelf.id, item.id); }}
                        disabled={run?.status === 'running'}
                        className="flex shrink-0 items-center gap-1 rounded bg-cyan-700 px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-cyan-600 disabled:cursor-progress disabled:bg-gray-700"
                      >
                        <RunGlyph />
                        {run?.status === 'running'
                          ? t('canvas.shelf.running', { defaultValue: '도는 중' })
                          : t('canvas.shelf.run', { defaultValue: '실행' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void removeShelfItem(shelf.id, item.id); }}
                        title={t('canvas.shelf.removeItem', { defaultValue: '항목 삭제' })}
                        aria-label={t('canvas.shelf.removeItem', { defaultValue: '항목 삭제' })}
                        className="shrink-0 rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300 pointer-coarse:p-2.5"
                      >
                        <TrashGlyph />
                      </button>
                    </div>
                  </div>

                  {/* 편집기 — 줄을 펼치면 나온다 */}
                  {expanded ? (
                    <div className="flex flex-col gap-2 border-t border-gray-800 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={item.label}
                          onChange={(e) => { void updateShelfItem(shelf.id, item.id, { label: e.target.value }); }}
                          placeholder={t('canvas.shelf.labelPlaceholder', { defaultValue: '이름' })}
                          className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[13px] text-gray-100 outline-none focus:border-cyan-600 md:w-48"
                        />
                        <select
                          value={item.kind}
                          onChange={(e) => { void updateShelfItem(shelf.id, item.id, { kind: e.target.value as ShelfItemKind }); }}
                          className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[13px] text-gray-100 outline-none focus:border-cyan-600"
                        >
                          <option value="command">{t('canvas.shelf.kindCommand', { defaultValue: '셸' })}</option>
                          <option value="prompt">{t('canvas.shelf.kindPrompt', { defaultValue: '프롬프트' })}</option>
                        </select>
                        {item.kind === 'prompt' ? (
                          <select
                            value={item.targetAgentId ?? ''}
                            onChange={(e) => { void updateShelfItem(shelf.id, item.id, { targetAgentId: e.target.value }); }}
                            className="min-w-0 max-w-56 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[13px] text-gray-100 outline-none focus:border-cyan-600"
                          >
                            <option value="">{t('canvas.shelf.newAgentTarget', { defaultValue: '실행할 때 새 카드 만들기' })}</option>
                            {targetOptions.map((a) => (
                              <option key={a.id} value={a.id}>{a.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={item.cwd ?? ''}
                            onChange={(e) => { void updateShelfItem(shelf.id, item.id, { cwd: e.target.value }); }}
                            placeholder={t('canvas.shelf.cwdPlaceholder', { defaultValue: '작업 디렉터리 (비우면 프로젝트 루트)' })}
                            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[13px] text-gray-100 outline-none focus:border-cyan-600 md:w-72"
                          />
                        )}
                      </div>

                      <textarea
                        value={item.kind === 'command' ? (item.command ?? '') : (item.prompt ?? '')}
                        onChange={(e) => {
                          const value = e.target.value;
                          void updateShelfItem(shelf.id, item.id, item.kind === 'command' ? { command: value } : { prompt: value });
                        }}
                        maxLength={item.kind === 'command' ? SHELF_COMMAND_MAX : SHELF_PROMPT_MAX}
                        rows={item.kind === 'command' ? 2 : 4}
                        placeholder={item.kind === 'command'
                          ? t('canvas.shelf.commandPlaceholder', { defaultValue: '실행할 셸 명령 (예: pnpm test)' })
                          : t('canvas.shelf.promptPlaceholder', { defaultValue: '에이전트에게 보낼 프롬프트' })}
                        className="w-full resize-y rounded border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[13px] text-gray-100 outline-none focus:border-cyan-600"
                      />

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {SHELF_ICONS.map((icon) => (
                            <button
                              key={icon}
                              type="button"
                              onClick={() => { void updateShelfItem(shelf.id, item.id, { icon: icon as ShelfIconName }); }}
                              title={icon}
                              className={`rounded p-1.5 transition-colors pointer-coarse:p-2.5 ${
                                item.icon === icon ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                              }`}
                            >
                              <ShelfItemGlyph name={icon} />
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 pointer-coarse:gap-2">
                          {SHELF_ITEM_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => { void updateShelfItem(shelf.id, item.id, { color }); }}
                              title={color}
                              className={`h-5 w-5 rounded-full border-2 transition-transform pointer-coarse:h-8 pointer-coarse:w-8 ${
                                item.color.toUpperCase() === color.toUpperCase() ? 'border-white scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* 마지막 실행 결과 — 그 줄 아래 그 자리에서 */}
                  {run ? (
                    <div className="border-t border-gray-800 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${
                          run.status === 'success'
                            ? 'bg-emerald-900/60 text-emerald-200'
                            : run.status === 'failed'
                              ? 'bg-rose-900/60 text-rose-200'
                              : 'bg-gray-700 text-gray-200'
                        }`}>
                          {run.status === 'success'
                            ? t('canvas.shelf.statusSuccess', { defaultValue: '성공' })
                            : run.status === 'failed'
                              ? t('canvas.shelf.statusFailed', { defaultValue: '실패' })
                              : t('canvas.shelf.statusRunning', { defaultValue: '도는 중' })}
                        </span>
                        <span className="text-gray-400">{fmtDuration(run.durationMs)}</span>
                        <span className="text-gray-400">
                          {t('canvas.shelf.exitCode', { defaultValue: '종료 코드' })} {run.exitCode ?? EMPTY}
                        </span>
                        {run.error ? <span className="text-rose-300">{run.error}</span> : null}
                        {run.agentId ? (
                          <button
                            type="button"
                            onClick={() => {
                              const agentId = run.agentId;
                              if (!agentId) return;
                              close();
                              selectNode(agentId);
                            }}
                            className="ml-auto rounded border border-gray-700 px-2 py-0.5 text-gray-300 transition-colors hover:bg-gray-800 pointer-coarse:min-h-8 pointer-coarse:px-3"
                          >
                            {t('canvas.shelf.openCard', { defaultValue: '그 카드 열기' })}
                          </button>
                        ) : null}
                      </div>
                      {run.output ? (
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-950 px-2 py-1.5 font-mono text-[12px] text-gray-300">
                          {run.outputTruncated
                            ? `…${t('canvas.shelf.outputTruncated', { defaultValue: '(앞부분 생략)' })}\n${run.output}`
                            : run.output}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 바닥 — 항목 추가. 좁으면 줄을 바꾼다(한도 안내까지 서면 한 줄을 넘는다). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-800 px-4 py-3 max-md:px-3">
        <button
          type="button"
          onClick={() => addItem('command')}
          disabled={atLimit}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-600"
        >
          {t('canvas.shelf.addCommand', { defaultValue: '+ 셸 명령' })}
        </button>
        <button
          type="button"
          onClick={() => addItem('prompt')}
          disabled={atLimit}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-600"
        >
          {t('canvas.shelf.addPrompt', { defaultValue: '+ 프롬프트' })}
        </button>
        {atLimit ? (
          <span className="text-[12px] text-gray-500">
            {t('canvas.shelf.itemLimit', { count: SHELF_MAX_ITEMS, defaultValue: '한 선반에 항목은 {{count}}개까지입니다' })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => doImport(true)}
          className="ml-auto rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          {t('canvas.shelf.importReplace', { defaultValue: '가져와서 통째 교체' })}
        </button>
      </div>
    </div>
  );
}
