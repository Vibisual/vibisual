import { Suspense, useEffect, type CSSProperties, type KeyboardEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { AppChrome } from '../../apps/appChrome.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { StudioHeader, type StudioHeaderProps } from './StudioHeader.js';
import { StudioStart, type StudioStartProps } from './StudioStart.js';
import { StudioRail, type StudioRailProps } from './StudioRail.js';
import { StudioPreview, type StudioPreviewProps } from './StudioPreview.js';
import { PreviewControls, type PreviewControlsProps } from './PreviewControls.js';
import { SceneStrip, type SceneStripProps } from './SceneStrip.js';
import { StudioAiPanel, type StudioAiPanelProps } from './StudioAiPanel.js';
import type { HistoryPanelProps } from './HistoryPanel.js';
import type { PrecisionSheetProps } from './PrecisionSheet.js';
import { LazyHistoryPanel, LazyPrecisionSheet } from './studioPanels.js';
import { StudioToastStack } from './StudioToastStack.js';
import type { StudioToast } from './useStudioToasts.js';

/**
 * §5.13 (V) 37-1 — 스튜디오 화면 배치(레일 + 서랍 · 미리보기 · AI 패널 · [정밀 편집]). 시작 화면은 입력창 하나만(같은 입력 두 군데 ❌).
 * 반응형은 창 폭(`box-*`, `apps/AppShellHost.tsx`) — 1024px 미만은 서랍이 덮고 AI 칸 하한 260px, 640px 미만은 AI 칸이 아래로 쌓인다.
 */
export interface VideoStudioViewProps {
  readonly accent: string;
  readonly hosted: boolean;
  readonly chrome: AppChrome | null;
  readonly header: StudioHeaderProps;
  readonly start: StudioStartProps | null;
  readonly rail: StudioRailProps | null;
  readonly preview: StudioPreviewProps | null;
  readonly controls: PreviewControlsProps | null;
  readonly strip: SceneStripProps | null;
  /** 장면 구슬 줄 위에 뜨는 것(기획 카드 — 37-4). */
  readonly above: ReactNode | null;
  readonly ai: StudioAiPanelProps | null;
  readonly history: HistoryPanelProps | null;
  readonly precision: PrecisionSheetProps | null;
  readonly overlays: ReactNode;
  readonly toasts: readonly StudioToast[];
  readonly onDismissToast: (id: number) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

export function VideoStudioView(p: VideoStudioViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const slot = p.chrome?.slot ?? null;
  const claim = p.chrome?.claim;
  // 창이 머리줄 자리를 주면 그 자리를 쓴다고 알린다 — 창은 자기 제목 글자를 거둔다.
  useEffect(() => (slot && claim ? claim() : undefined), [slot, claim]);
  const accentStyle = { '--vs-accent': p.accent } as CSSProperties;
  const header = <StudioHeader {...p.header} />;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-vb-window text-slate-200 outline-none" style={accentStyle} tabIndex={-1} onKeyDown={p.onKeyDown}>
      {slot ? createPortal(<div className="flex min-w-0 flex-1 items-center" style={accentStyle}>{header}</div>, slot) : (
        <header className={`${p.hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-2`} aria-label={t('panel.videoStudio.header.label')}>
          <div className="app-nodrag flex min-w-0 flex-1 items-center">{header}</div>
          {!p.hosted ? <WindowControls /> : null}
        </header>
      )}
      {/* `relative` — 1024px 미만 창에서 레일 서랍이 미리보기를 밀지 않고 그 위에 덮인다(StudioRail). */}
      <div className="relative flex min-h-0 flex-1">
        {p.rail ? <StudioRail {...p.rail} /> : null}
        {/* 가운데 + 오른쪽 칸. 640px 미만 창(폰)에서는 세로로 쌓는다 — 미리보기 위, AI·판 기록 칸 아래. 나란히 두면 AI 칸의
            하한(260px)이 미리보기를 0 으로 민다. 넓은 창에서는 종전 그대로 나란하다(이 상자는 배치만 바꾼다). */}
        <div className="flex min-h-0 min-w-0 flex-1 box-narrow:flex-col">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3 box-narrow:p-2">
            {p.start ? <StudioStart {...p.start} /> : (
              <>
                {p.preview ? <StudioPreview {...p.preview} /> : null}
                {p.controls ? <PreviewControls {...p.controls} /> : null}
                {p.above}
                {p.strip ? <SceneStrip {...p.strip} /> : null}
              </>
            )}
          </main>
          {/* 39-2 — 판 기록·정밀 편집은 늦게 받는 판이다(한가할 때 미리 받아 둔다). */}
          {p.history ? <Suspense fallback={null}><LazyHistoryPanel {...p.history} /></Suspense> : p.ai ? <StudioAiPanel {...p.ai} /> : null}
        </div>
      </div>
      {p.precision ? <Suspense fallback={null}><LazyPrecisionSheet {...p.precision} /></Suspense> : null}
      {p.overlays}
      <StudioToastStack toasts={p.toasts} onDismiss={p.onDismissToast} />
    </div>
  );
}
