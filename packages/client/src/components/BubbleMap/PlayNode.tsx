import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';
import type { PlayBubbleStatus, PlayRecipe } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §5.14 v4.62 — 플레이 버튼 버블.
 *
 * 캡처 버블·앱 버블과 같은 "사용자가 만든 독립 캔버스 요소"이고, 하는 일은 하나다 —
 * **이 프로젝트를 켜고 끈다.** 프리뷰(iframe)는 이 버튼이 아니라 옆에 따로 뜨고, 프리뷰를
 * 닫아도 버튼은 남는다. 지우는 것은 사용자뿐이다.
 */

export interface PlayNodeData extends Record<string, unknown> {
  playBubbleId: string;
  projectName: string;
  width: number;
  height: number;
  title?: string | undefined;
  recipe?: PlayRecipe | undefined;
  status: PlayBubbleStatus;
  url?: string | undefined;
  error?: string | undefined;
  previewOpen?: boolean | undefined;
  preservePinned?: boolean | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

/** 상태별 색 한 벌 — 버튼은 이 네 상태만 그린다. */
const STATUS_STYLE: Record<PlayBubbleStatus, { color: string; glow: string }> = {
  idle: { color: '#10B981', glow: '#34D399' },
  starting: { color: '#F59E0B', glow: '#FBBF24' },
  running: { color: '#059669', glow: '#6EE7B7' },
  failed: { color: '#E11D48', glow: '#FB7185' },
};

function PlayGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M7 4.5v15l12-7.5-12-7.5z" />
    </svg>
  );
}

function StopGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function SpinnerGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-6 w-6 animate-spin">
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

function SearchGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export const PlayNode = memo(function PlayNode({
  data,
  selected,
}: NodeProps & { data: PlayNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const selectPlayBubble = useGraphStore((s) => s.selectPlayBubble);
  const selectedPlayBubbleId = useGraphStore((s) => s.selectedPlayBubbleId);
  const startPlayBubble = useGraphStore((s) => s.startPlayBubble);
  const stopPlayBubble = useGraphStore((s) => s.stopPlayBubble);
  const detectPlayRecipe = useGraphStore((s) => s.detectPlayRecipe);
  const askAgentForPlayRecipe = useGraphStore((s) => s.askAgentForPlayRecipe);
  const updatePlayBubble = useGraphStore((s) => s.updatePlayBubble);
  const patchLocal = useGraphStore((s) => s.patchPlayBubbleLocal);
  const deletePlayBubble = useGraphStore((s) => s.deletePlayBubble);
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSelected = selected === true || selectedPlayBubbleId === data.playBubbleId;
  const status = data.status;
  const hasRecipe = data.recipe !== undefined;
  const style = STATUS_STYLE[status];

  // 바깥 press 로 닫기(공통 규약 — 메뉴 안에서 시작한 press·드래그로는 안 닫힌다).
  // capture 단계 — React Flow 가 이벤트를 선점하기 전에 닫는다.
  useOutsidePressDismiss({
    enabled: menu !== null,
    onDismiss: () => setMenu(null),
    refs: [menuRef],
  });

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  // 안내 문구는 잠깐만 — 버블은 상태를 보여 주는 자리이지 로그를 쌓는 자리가 아니다.
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * 선택 — 앱 버블과 같은 규칙, 같은 함정(v4.69).
   *
   * ⚠ 버블 단계의 `onMouseDown` 으로 받으면 안 된다: 드래그 가능한 노드의 래퍼에 걸린
   * `d3-drag` 가 mousedown 에서 `stopImmediatePropagation()` 을 불러, 루트로 위임된 React
   * 핸들러가 아예 발화하지 못한다(= 눌러도 선택이 안 된다). 캡처 단계로 받아 그 차단을 피한다.
   * 대신 캡처 단계는 자식보다 먼저 뛰므로, 안쪽 버튼(재생/정지)에서는 선택을 건너뛴다 —
   * 그 버튼의 `stopPropagation` 은 캡처 단계를 막지 못한다.
   */
  const handleSelect = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    selectPlayBubble(data.playBubbleId);
  }, [selectPlayBubble, data.playBubbleId]);

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectPlayBubble(data.playBubbleId);
    setMenu({ x: e.clientX, y: e.clientY });
  }, [selectPlayBubble, data.playBubbleId]);

  /** 4단 계단 ④ — 이 프로젝트의 커스텀 에이전트에게 조사를 맡긴다. */
  const askAgent = useCallback(async (): Promise<void> => {
    // 이 프로젝트 소속 커스텀 에이전트를 고른다(소속 정보가 없는 에이전트는 후순위로 허용).
    const customs = Object.values(agents).filter((a) => a.customCreated === true);
    const candidate =
      customs.find((a) => agentProjects[a.id] === data.projectName) ??
      customs.find((a) => agentProjects[a.id] === undefined);
    if (!candidate) {
      setNotice(t('canvas.play.noAgent', { defaultValue: '조사를 맡길 커스텀 에이전트가 없습니다' }));
      return;
    }
    const ok = await askAgentForPlayRecipe(data.playBubbleId, candidate.id);
    setNotice(
      ok
        ? t('canvas.play.askSent', { defaultValue: '에이전트에게 실행법 조사를 맡겼습니다' })
        : t('canvas.play.askFailed', { defaultValue: '조사를 맡기지 못했습니다' }),
    );
  }, [agents, agentProjects, data.projectName, data.playBubbleId, askAgentForPlayRecipe, t]);

  /** 실행법 찾기 — 먼저 자동 탐지, 빈손이면 에이전트에게. */
  const findRecipe = useCallback(async (): Promise<void> => {
    const candidates = await detectPlayRecipe(data.playBubbleId, true);
    if (candidates.length > 0) {
      setNotice(t('canvas.play.detected', { defaultValue: '실행법을 찾았습니다' }));
      return;
    }
    await askAgent();
  }, [detectPlayRecipe, data.playBubbleId, askAgent, t]);

  /** 본체 클릭 = 켜고 끄기. 실행법을 모르면 먼저 찾는다. */
  const handleToggle = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!hasRecipe) {
      void findRecipe();
      return;
    }
    if (status === 'running') void stopPlayBubble(data.playBubbleId);
    else if (status !== 'starting') void startPlayBubble(data.playBubbleId);
  }, [hasRecipe, status, findRecipe, stopPlayBubble, startPlayBubble, data.playBubbleId]);

  const togglePreview = useCallback((): void => {
    setMenu(null);
    const next = data.previewOpen !== true;
    patchLocal(data.playBubbleId, { previewOpen: next });
    void updatePlayBubble(data.playBubbleId, { previewOpen: next });
  }, [data.previewOpen, data.playBubbleId, patchLocal, updatePlayBubble]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    const next = data.preservePinned !== true;
    patchLocal(data.playBubbleId, { preservePinned: next });
    void updatePlayBubble(data.playBubbleId, { preservePinned: next });
  }, [data.preservePinned, data.playBubbleId, patchLocal, updatePlayBubble]);

  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(t('canvas.play.renamePrompt', { defaultValue: '버튼 이름' }), data.title ?? '');
    if (next === null) return;
    const title = next.trim();
    patchLocal(data.playBubbleId, { title });
    void updatePlayBubble(data.playBubbleId, { title });
  }, [t, data.title, data.playBubbleId, patchLocal, updatePlayBubble]);

  /** 명령 직접 고치기 — 무엇이 실행되는지는 언제나 사용자가 읽고 바꿀 수 있어야 한다. */
  const editCommand = useCallback((): void => {
    setMenu(null);
    const current = data.recipe;
    const isStatic = current?.kind === 'static';
    const seed = isStatic ? (current?.root ?? '') : (current?.command ?? '');
    const next = window.prompt(
      isStatic
        ? t('canvas.play.editRootPrompt', { defaultValue: '서빙할 폴더(절대 경로)' })
        : t('canvas.play.editCommandPrompt', { defaultValue: '실행 명령' }),
      seed,
    );
    if (next === null) return;
    const value = next.trim();
    if (!value) return;
    const recipe: PlayRecipe = isStatic
      ? { ...(current ?? { kind: 'static', source: 'user' }), kind: 'static', root: value, source: 'user' }
      : { ...(current ?? { kind: 'command', source: 'user' }), kind: 'command', command: value, source: 'user' };
    patchLocal(data.playBubbleId, { recipe });
    void updatePlayBubble(data.playBubbleId, { recipe });
  }, [t, data.recipe, data.playBubbleId, patchLocal, updatePlayBubble]);

  const openInBrowser = useCallback((): void => {
    setMenu(null);
    if (data.url) window.open(data.url, '_blank', 'noopener');
  }, [data.url]);

  const remove = useCallback((): void => {
    setMenu(null);
    void deletePlayBubble(data.playBubbleId);
  }, [deletePlayBubble, data.playBubbleId]);

  const isPinned = data.preservePinned === true;

  const label = useMemo(() => {
    if (data.title) return data.title;
    if (!hasRecipe) return t('canvas.play.unknownRecipe', { defaultValue: '실행법 모름' });
    return data.recipe?.label ?? data.recipe?.command ?? t('canvas.play.title', { defaultValue: '플레이' });
  }, [data.title, data.recipe, hasRecipe, t]);

  const subLabel = useMemo(() => {
    if (status === 'failed' && data.error) return data.error;
    if (status === 'running' && data.url) return data.url.replace(/^https?:\/\//, '');
    if (status === 'starting') return t('canvas.play.starting', { defaultValue: '켜는 중…' });
    if (!hasRecipe) return t('canvas.play.findHint', { defaultValue: '눌러서 실행법 찾기' });
    return t('canvas.play.idle', { defaultValue: '눌러서 실행' });
  }, [status, data.error, data.url, hasRecipe, t]);

  const menuItem = (
    onClick: () => void,
    text: string,
    opts: { danger?: boolean; disabled?: boolean; title?: string } = {},
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled === true}
      title={opts.title}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        opts.disabled === true
          ? 'cursor-not-allowed text-gray-500'
          : `hover:bg-gray-800 ${opts.danger === true ? 'text-rose-300' : 'text-gray-200'}`
      }`}
    >
      {text}
    </button>
  );

  const menuPortal = menu
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[60] min-w-52 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menuItem(() => {
            setMenu(null);
            void findRecipe();
          }, t('canvas.play.findRecipe', { defaultValue: '실행법 알아내기' }))}
          {menuItem(() => {
            setMenu(null);
            void askAgent();
          }, t('canvas.play.askAgent', { defaultValue: '에이전트에게 물어보기' }))}
          {hasRecipe ? menuItem(editCommand, t('canvas.play.editRecipe', { defaultValue: '실행 명령 고치기' })) : null}
          {menuItem(togglePreview, data.previewOpen === true
            ? t('canvas.play.hidePreview', { defaultValue: '프리뷰 숨기기' })
            : t('canvas.play.showPreview', { defaultValue: '프리뷰 보이기' }), { disabled: !data.url })}
          {menuItem(openInBrowser, t('canvas.play.openBrowser', { defaultValue: '브라우저로 열기' }), { disabled: !data.url })}
          {menuItem(rename, t('canvas.play.rename', { defaultValue: '이름 바꾸기' }))}
          {menuItem(togglePin, isPinned
            ? t('canvas.play.unpin', { defaultValue: '고정 해제' })
            : t('canvas.play.pin', { defaultValue: '고정' }))}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {menuItem(remove, t('canvas.play.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('canvas.play.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div
        onPointerDownCapture={handleSelect}
        onContextMenu={handleContextMenu}
        title={data.recipe?.command ?? data.recipe?.root ?? label}
        className="bubble-press relative flex cursor-pointer select-none flex-col items-center justify-center overflow-hidden rounded-2xl text-white"
        style={{
          width: data.width,
          height: data.height,
          border: hasRecipe ? '2px solid' : '2px dashed',
          borderColor: isSelected ? '#FFFFFF' : `${style.glow}99`,
          background: `linear-gradient(160deg, ${style.color}E6, ${style.color}99)`,
          boxShadow: isSelected ? `0 0 0 3px ${style.glow}80` : `0 6px 22px ${style.color}40`,
        }}
      >
        {/* 가운데 큰 글리프 자체가 버튼이다 — 이 버블에서 가장 자주 하는 동작이라 가장 크게 둔다. */}
        <button
          type="button"
          onClick={handleToggle}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/25 text-white transition-colors hover:bg-black/40"
          aria-label={t('canvas.play.title', { defaultValue: '플레이' })}
        >
          {status === 'starting' ? <SpinnerGlyph /> : !hasRecipe ? <SearchGlyph /> : status === 'running' ? <StopGlyph /> : <PlayGlyph />}
        </button>

        <div className="mt-1.5 max-w-[92%] truncate text-center text-[12px] font-semibold leading-tight">{label}</div>
        <div className="mt-0.5 max-w-[92%] truncate text-center text-[9px] leading-tight text-white/70">
          {notice ?? subLabel}
        </div>

        {/* 살아 있음 표시 — 라이브 점(§5.9 캡처 버블의 녹화등과 같은 문법). */}
        {status === 'running' ? (
          <span className="absolute left-2 top-2 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-200" aria-hidden />
        ) : null}

        {isPinned ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-white/80"
          >
            <path d="M12 17v5" />
            <path d="M9 10.76V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3.76a2 2 0 0 0 .59 1.42L17 13.5V17H7v-3.5l1.41-1.32A2 2 0 0 0 9 10.76z" />
          </svg>
        ) : null}
      </div>
      {menuPortal}
    </>
  );
});
