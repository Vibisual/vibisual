import { useCallback, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { PreviewSnipOverlay } from './PreviewSnipOverlay.js';
import type { PreviewPicker } from './usePreviewPicker.js';
import type { PreviewSnip } from './usePreviewSnip.js';

/**
 * §5.17 (A) — 프리뷰 본체. 폭 하나짜리와 **세 폭 나란히**(compare) 를 한 곳에서 그린다.
 *
 * 탭 프리뷰(`IframeView`)와 캔버스 프리뷰(`PlayPreviewNode`)가 이 컴포넌트 하나를 쓰므로
 * 한 쪽만 비교가 되거나 한 쪽만 캡처가 되는 일이 없다(§7.11 `toProxyUrl` 의 교훈).
 *
 * 폭은 언제나 **실제 CSS 폭**이다 — `transform: scale()` 로 줄이면 미디어쿼리가 실제 폭을
 * 못 보고 "모바일에서 어떻게 보이나" 를 확인하려던 목적 자체가 무너진다.
 */

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

interface PreviewFramesProps {
  picker: PreviewPicker;
  /** 없으면 조준 레이어를 달지 않는다(캡처를 열지 않은 화면). */
  snip?: PreviewSnip | undefined;
  /** 프록시를 거친 최종 src. */
  src: string;
  /** 대표 프레임 — 새로고침처럼 한 장을 가리켜야 하는 조작의 상대. */
  primaryRef: MutableRefObject<HTMLIFrameElement | null>;
  /** 같은 문자열 src 를 다시 넣어도 브라우저가 무시하므로, 새로고침은 이 키를 돌려서 한다. */
  reloadKey?: number | undefined;
  /** 컨테이너 배경 등 화면별 차이. */
  className?: string | undefined;
  /** 서버 꺼짐 dim 처럼 값이 계산되는 스타일만. */
  style?: React.CSSProperties | undefined;
}

export function PreviewFrames({
  picker,
  snip,
  src,
  primaryRef,
  reloadKey,
  className,
  style,
}: PreviewFramesProps): React.JSX.Element {
  const { t } = useTranslation();

  // 대표 프레임 ref + pick 방송 등록을 한 번에. 콜백 ref 라 프레임이 바뀔 때마다 다시 불린다.
  const attachPrimary = useCallback((el: HTMLIFrameElement | null) => {
    primaryRef.current = el;
    picker.registerFrame(el);
  }, [primaryRef, picker]);

  const compare = picker.compareWidths;

  // 넘치는 폭은 여기가 가로 스크롤로 받는데(§7.16), 그 스크롤바는 **앱 공용 톤**(`scrollbar-thin`)
  // 이라 기본이 숨김이다. 굴리기만 한 사용자에게도 뜨도록 `data-scrolling` 을 함께 건다.
  // 한 폭·비교 중 화면에 있는 것은 언제나 하나라 상태도 하나면 된다.
  const scrollReveal = useScrollReveal();

  // 그 스크롤바를 **마우스만 대도** 뜨게 하는 나머지 반쪽. `.scrollbar-thin:hover` 는 여기서 서지
  // 않는다 — 프리뷰 본체는 다른 오리진 iframe 이라, 마우스가 그 위로 들어가는 순간 이 상자는 아무
  // 것도 받지 못한다(인스펙터가 켜질 때 iframe 의 `pointer-events` 를 일부러 끄는 것도 같은 까닭).
  // 그래서 안에서 알려 온 신고(§7.11 다리)를 `:hover` 자리에 세운다.
  const hoverReveal = picker.hovered ? 'true' : 'false';

  return (
    <div className={`relative flex min-h-0 flex-1 overflow-hidden ${className ?? ''}`} style={style}>
      {compare === null ? (
        <div
          className="scrollbar-thin flex min-h-0 flex-1 justify-center overflow-auto"
          {...scrollReveal}
          data-hovering={hoverReveal}
        >
          <iframe
            key={reloadKey}
            ref={attachPrimary}
            src={src}
            onLoad={(e) => picker.notifyFrameLoaded(e.currentTarget)}
            className="h-full border-0 bg-white"
            style={picker.deviceWidth === null
              ? { width: '100%' }
              : { width: `${picker.deviceWidth}px`, flex: '0 0 auto' }}
            title={t('common.iframe.serverPreview')}
            sandbox={IFRAME_SANDBOX}
          />
        </div>
      ) : (
        // 비교 줄 — 칸마다 이름·폭을 머리에 달아 어느 폭이 깨졌는지 바로 보이게 한다.
        <div
          className="scrollbar-thin flex min-h-0 flex-1 overflow-auto"
          {...scrollReveal}
          data-hovering={hoverReveal}
        >
          {compare.map((entry, index) => (
            <div
              key={entry.id}
              className="flex min-h-0 flex-col border-r border-white/[0.08] last:border-r-0"
              style={{ width: `${entry.width}px`, flex: '0 0 auto' }}
            >
              <div className="flex shrink-0 items-center gap-1 bg-gray-900/80 px-1.5 py-0.5 text-[12px] text-gray-400">
                <span className="truncate">{t(entry.labelKey)}</span>
                <span className="ml-auto shrink-0 font-mono text-gray-500">{entry.width}px</span>
              </div>
              <iframe
                key={`${entry.id}-${reloadKey ?? 0}`}
                ref={index === 0 ? attachPrimary : picker.registerFrame}
                src={src}
                onLoad={(e) => picker.notifyFrameLoaded(e.currentTarget)}
                className="min-h-0 w-full flex-1 border-0 bg-white"
                title={`${t('common.iframe.serverPreview')} — ${entry.width}px`}
                sandbox={IFRAME_SANDBOX}
              />
            </div>
          ))}
        </div>
      )}
      {snip ? <PreviewSnipOverlay snip={snip} /> : null}
    </div>
  );
}
