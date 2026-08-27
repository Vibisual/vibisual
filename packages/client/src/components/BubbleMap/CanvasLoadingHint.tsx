import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_LOAD_HINT_DELAY_MS, PROJECT_LOAD_HINT_SLOW_MS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { resolveCanvasLoadingState } from './canvasLoading.js';

/** 페이드 아웃에 쓰는 시간(ms) — 아래 `duration-300` 과 같은 값이어야 한다. */
const FADE_OUT_MS = 300;

/**
 * §9 **"탭을 옮긴 직후의 빈 캔버스는 빈 프로젝트가 아니다"** — 캔버스 상단의 조용한 로딩 표시.
 *
 * 원격 접속(느린 회선)에서 프로젝트 탭을 옮기면 §9 스코프드 구독의 왕복이 끝날 때까지 캔버스가
 * 통째로 비어 보인다. 그 시간 동안 화면은 아무 말도 하지 않아, 사용자는 **버블을 못 읽어 온
 * 것인지 원래 빈 프로젝트인지** 알 수 없었다(사용자 신고).
 *
 * 그래서 "거슬리지 않게 알리고, 오면 사라지는" 표시 하나를 둔다. 규칙은 넷이다.
 *
 *  ① **바로 뜨지 않는다** — `PROJECT_LOAD_HINT_DELAY_MS` 를 넘겨 기다릴 때만. 같은 기기에서는
 *    왕복이 눈 깜짝할 새라, 즉시 띄우면 탭을 옮길 때마다 표시가 깜빡여 그게 더 거슬린다.
 *  ② **오면 사라진다** — 스냅샷이 도착하는 순간 페이드 아웃. 사용자가 닫을 것이 없다.
 *  ③ **길어지면 말이 정확해진다** — `PROJECT_LOAD_HINT_SLOW_MS` 를 넘기면 "회선이 느립니다"로
 *    바꾼다(같은 문구가 멈춰 있으면 앱이 죽은 것처럼 읽힌다).
 *  ④ **캔버스를 막지 않는다** — `pointer-events-none` · 작은 알약 하나 · 배경 어둠 ❌.
 *    기다리는 동안에도 우클릭·팬·줌은 그대로 된다.
 *
 * 판정은 이 컴포넌트가 하지 않는다 — `canvasLoading.ts` 순수 함수 하나가 단독으로 갖는다.
 * 여기는 **언제 띄우고 언제 지울지**(시간 축)만 담당한다.
 */
export function CanvasLoadingHint(): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeProject = useGraphStore((s) => s.activeProject);
  const activeIsStub = useGraphStore((s) => (s.activeProject !== null && !!s.stubProjects[s.activeProject]));
  const snapshotScope = useGraphStore((s) => s.snapshotScope);
  const snapshotReceived = useGraphStore((s) => s.snapshotReceived);
  const connectionStatus = useGraphStore((s) => s.connectionStatus);

  const state = resolveCanvasLoadingState({
    activeProject,
    activeIsStub,
    snapshotScope,
    snapshotReceived,
    connectionStatus,
  });

  // 두 축을 나눠 든다. `mounted` = DOM 에 있는가 · `shown` = 불투명한가.
  //   ⚠ 이 분리가 페이드의 전부다 — 뜨는 순간에 `opacity-100` 으로 **마운트**하면 CSS 전이는
  //     초기값이 없어 아예 돌지 않고 표시가 툭 나타난다. 기다리기 시작할 때 투명한 채로 먼저
  //     올려 두고, 지연이 지나면 그때 불투명으로 바꾼다.
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

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
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
