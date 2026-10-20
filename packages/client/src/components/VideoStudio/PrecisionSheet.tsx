import { useTranslation } from 'react-i18next';

import { shortcutLabel } from '../../utils/platform.js';
import { ScrollFade } from '../ScrollFade.js';
import { StudioIconButton } from './StudioIconButton.js';
import { VideoTimeline, type VideoTimelineProps } from './VideoTimeline.js';
import { VideoInspector, type VideoInspectorProps } from './VideoInspector.js';
import { memoLatest } from './studioMemo.js';

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

/** §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). */
export const PrecisionSheet = memoLatest(PrecisionSheetView);

function PrecisionSheetView(p: PrecisionSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const btn = (icon: Parameters<typeof StudioIconButton>[0]['icon'], label: string, hint: string, action: Action): React.JSX.Element => (
    <StudioIconButton icon={icon} label={label} hint={hint} disabled={p.disabled || action.disabled} onClick={action.run} size="sm" />
  );
  return (
    // 창 폭 기준(box-*): 640px 미만은 속성 칸을 타임라인 **아래**로 내리고 판을 높인다 — 나란히 두면 속성 256px 뒤에 타임라인이
    //   70px 남짓만 남아 레인·클립을 쓸 수 없었다. 큰 창은 높이 상한 360px 를 480px 로 연다.
    <section className="flex h-[min(46%,360px)] min-h-56 shrink-0 animate-[vs-in-up_160ms_ease-out] border-t border-white/10 bg-vb-card box-narrow:h-[min(55%,420px)] box-narrow:min-h-0 box-narrow:flex-col box-wide:h-[min(46%,480px)]" aria-label={t('panel.videoStudio.precision.toggle')}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
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
      <div className="min-h-0 shrink-0 border-l border-white/10 p-2 box-narrow:h-[45%] box-narrow:border-l-0 box-narrow:border-t">
        <VideoInspector {...p.inspector} />
      </div>
    </section>
  );
}
