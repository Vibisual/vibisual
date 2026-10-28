import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_LOAD_HINT_DELAY_MS, PROJECT_LOAD_HINT_SLOW_MS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { resolveCanvasLoadingState } from './canvasLoading.js';

/** 페이드 아웃에 쓰는 시간(ms) — 아래 `duration-300` 과 같은 값이어야 한다. */
const FADE_OUT_MS = 300;

/**
 * §9 "탭을 옮긴 직후의 빈 캔버스는 빈 프로젝트가 아니다" — 스코프드 구독 왕복 동안의 조용한 로딩 표시.
 * ① `PROJECT_LOAD_HINT_DELAY_MS` 넘게 기다릴 때만(즉시면 탭마다 깜빡인다) ② 스냅샷이 오면 페이드 아웃
 * ③ `PROJECT_LOAD_HINT_SLOW_MS` 넘으면 "회선이 느립니다" ④ 캔버스를 막지 않는다(`pointer-events-none`). 판정은 `canvasLoading.ts`, 여기는 시간 축만.
 */
export function CanvasLoadingHint(): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeProject = useGraphStore((s) => s.activeProject);
  const activeIsStub = useGraphStore((s) => (s.activeProject !== null && !!s.stubProjects[s.activeProject]));
  const snapshotScope = useGraphStore((s) => s.snapshotScope);
  const snapshotReceived = useGraphStore((s) => s.snapshotReceived);
  const connectionStatus = useGraphStore((s) => s.connectionStatus);
  // §9 폴더 스코프 — 프로젝트 축과 같은 판정을 폴더에도 건다(같은 알약, 같은 문구).
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const snapshotFolderScope = useGraphStore((s) => s.snapshotFolderScope);

  const state = resolveCanvasLoadingState({
    activeProject,
    activeIsStub,
    snapshotScope,
    snapshotReceived,
    connectionStatus,
    currentFolderId,
    snapshotFolderScope,
  });

  // `mounted`(DOM 에 있나)와 `shown`(불투명한가)을 나눈 것이 페이드의 전부다 — `opacity-100` 으로 마운트하면 전이가 안 돌고 툭 뜬다.
  // 투명하게 먼저 올리고 지연 뒤 불투명으로.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // 오래 기다리는 중인가 — 문구만 바꾼다(상태는 그대로 'loading').
  const [slow, setSlow] = useState(false);
  // 페이드 아웃 중에도 문구가 튀지 않게, 마지막으로 보여 준 상태를 붙들어 둔다.
  const shownStateRef = useRef<'loading' | 'reconnecting'>('loading');
  if (state !== 'ready') shownStateRef.current = state;

  const waiting = state !== 'ready';

  useEffect(() => {
    if (waiting) {
      setMounted(true);
      // ① 지연 후 등장 — 빠른 전환에서는 이 타이머가 뜨기 전에 걷힌다.
      const showAt = window.setTimeout(() => setShown(true), PROJECT_LOAD_HINT_DELAY_MS);
      // ③ 더 길어지면 문구 교체.
      const slowAt = window.setTimeout(() => setSlow(true), PROJECT_LOAD_HINT_SLOW_MS);
      return () => {
        window.clearTimeout(showAt);
        window.clearTimeout(slowAt);
      };
    }
    // ② 도착 — 불투명이었으면 페이드로 걷히고, 그동안 투명이었으면 아무도 못 본 채 사라진다.
    setShown(false);
    setSlow(false);
    const unmountAt = window.setTimeout(() => setMounted(false), FADE_OUT_MS);
    return () => window.clearTimeout(unmountAt);
  }, [waiting]);

  if (!mounted) return null;

  const label = shownStateRef.current === 'reconnecting'
    ? t('canvas.loading.connecting', { defaultValue: '서버에 연결하는 중…' })
    : slow
      ? t('canvas.loading.slow', { defaultValue: '회선이 느립니다 — 아직 받는 중…' })
      : t('canvas.loading.project', { defaultValue: '프로젝트를 불러오는 중…' });

  /**
   * 자리 — 경로 표시와 같은 `top-3` 이라, 경로·휴지통 띠가 떠 있으면 그 아래로 비킨다(표식 클래스 `canvas-crumb`·`canvas-trash-toolbar` 형제 유무로 CSS 가 판정).
   * ⚠ 셸(`App`·`DetachedShell`)에서 경로 → 이 알약 → 휴지통 띠 순서의 형제여야 한다.
   */
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center [.canvas-crumb~&]:top-10 pointer-coarse:[.canvas-crumb~&]:top-12 [.canvas-crumb~&:has(~.canvas-trash-toolbar)]:top-[5.5rem] max-sm:[.canvas-crumb~&:has(~.canvas-trash-toolbar)]:top-28"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/80 px-3 py-1.5 text-[12px] text-gray-300 shadow-lg backdrop-blur-sm transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-blue-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>{label}</span>
      </div>
    </div>
  );
}
