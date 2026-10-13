import { useEffect, type CSSProperties, type KeyboardEventHandler, type ReactNode } from 'react';
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
import { HistoryPanel, type HistoryPanelProps } from './HistoryPanel.js';
import { PrecisionSheet, type PrecisionSheetProps } from './PrecisionSheet.js';
import { StudioToastStack } from './StudioToastStack.js';
import type { StudioToast } from './useStudioToasts.js';

/**
 * §5.13 (V) 37-1 — 스튜디오 **화면 배치**((U) 작업 공간을 대체한다).
 *
 * 위: 한 줄 크롬 — 창이 머리줄 자리를 주면(`AppChrome`) 그 자리에 머리줄 내용을 그리고 창 제목을 문서 제목으로 바꾼다(앱 이름
 * 머리줄과 스튜디오 머리줄이 겹치던 세 줄이 한 줄이 된다). 가운데: 왼쪽 아이콘 레일 + 서랍 · 큰 미리보기(+ 조작 줄 · 장면 구슬
 * 줄) · 오른쪽 AI 패널(판 기록을 열면 그 자리). 아래: [정밀 편집] 판(열 때만). 시작 화면에서는 레일·AI 패널을 거두고 입력창
 * 하나만 남긴다(같은 입력이 두 군데 있지 않게).
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
      <div className="flex min-h-0 flex-1">
        {p.rail ? <StudioRail {...p.rail} /> : null}
        <main className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          {p.start ? <StudioStart {...p.start} /> : (
            <>
              {p.preview ? <StudioPreview {...p.preview} /> : null}
              {p.controls ? <PreviewControls {...p.controls} /> : null}
              {p.above}
              {p.strip ? <SceneStrip {...p.strip} /> : null}
            </>
          )}
        </main>
        {p.history ? <HistoryPanel {...p.history} /> : p.ai ? <StudioAiPanel {...p.ai} /> : null}
      </div>
      {p.precision ? <PrecisionSheet {...p.precision} /> : null}
      {p.overlays}
      <StudioToastStack toasts={p.toasts} onDismiss={p.onDismissToast} />
    </div>
  );
}
