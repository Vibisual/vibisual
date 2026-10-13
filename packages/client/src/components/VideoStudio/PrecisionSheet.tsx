import { useTranslation } from 'react-i18next';

import { shortcutLabel } from '../../utils/platform.js';
import { ScrollFade } from '../ScrollFade.js';
import { StudioIconButton } from './StudioIconButton.js';
import { VideoTimeline, type VideoTimelineProps } from './VideoTimeline.js';
import { VideoInspector, type VideoInspectorProps } from './VideoInspector.js';

/**
 * §5.13 (V) 37-1 — **[정밀 편집]** 판: 아래에서 올라온다(160ms). (U) 의 편집 기능을 하나도 빼지 않고 여기 모았다 — 도구 줄
 * (되돌리기·다시·분할·복제·켜기/끄기·삭제 — 아이콘 + 단축키 툴팁) · 트랙 타임라인(프레임 이동·확대/맞춤·스냅·이동·트림·트랙
 * 숨김/음소거) · 전체 인스펙터(판형·fps·클립 시각·내용·배치·코드 정보).
 */
interface Action { readonly run: () => void; readonly disabled?: boolean }

export interface PrecisionSheetProps {
  readonly timeline: VideoTimelineProps;
  readonly inspector: VideoInspectorProps;
  readonly undo: Action;
  readonly redo: Action;
  readonly split: Action;
  readonly duplicate: Action;
  readonly toggle: Action;
  readonly remove: Action;
  readonly disabled: boolean;
  readonly onClose: () => void;
}

export function PrecisionSheet(p: PrecisionSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const btn = (icon: Parameters<typeof StudioIconButton>[0]['icon'], label: string, hint: string, action: Action): React.JSX.Element => (
    <StudioIconButton icon={icon} label={label} hint={hint} disabled={p.disabled || action.disabled} onClick={action.run} size="sm" />
  );
  return (
    <section className="flex h-[min(46%,360px)] min-h-56 shrink-0 animate-[vs-in-up_160ms_ease-out] border-t border-white/10 bg-vb-card" aria-label={t('panel.videoStudio.precision.toggle')}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
        <div className="flex shrink-0 items-center gap-0.5">
          {btn('undo', t('panel.videoStudio.editor.undo'), shortcutLabel('Ctrl+Z'), p.undo)}
          {btn('redo', t('panel.videoStudio.editor.redo'), `${shortcutLabel('Ctrl+Shift+Z')} · ${shortcutLabel('Ctrl+Y')}`, p.redo)}
          <span className="mx-1 h-4 border-l border-white/10" aria-hidden="true" />
          {btn('split', t('panel.videoStudio.editor.split'), shortcutLabel('S'), p.split)}
          {btn('duplicate', t('panel.videoStudio.editor.duplicate'), shortcutLabel('Ctrl+D'), p.duplicate)}
          {btn('eye', t('panel.videoStudio.toggleItem'), '', p.toggle)}
          {btn('trash', t('panel.videoStudio.removeItem'), shortcutLabel('Delete'), p.remove)}
          <span className="flex-1" />
          <StudioIconButton icon="close" label={t('panel.videoStudio.precision.close')} onClick={p.onClose} size="sm" />
        </div>
        <ScrollFade fill className="flex-1">
          <VideoTimeline {...p.timeline} />
        </ScrollFade>
      </div>
      <div className="min-h-0 shrink-0 border-l border-white/10 p-2">
        <VideoInspector {...p.inspector} />
      </div>
    </section>
  );
}
