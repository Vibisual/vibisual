import { useCallback, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { WEB_PAGE_PARTITION } from '@vibisual/shared';

import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { PreviewSnipOverlay } from './PreviewSnipOverlay.js';
import type { PreviewPicker } from './usePreviewPicker.js';
import type { PreviewSnip } from './usePreviewSnip.js';

/** §5.17 (A) — 프리뷰 본체(한 폭 / 세 폭 compare), 탭·캔버스 프리뷰 공용. 폭은 실제 CSS 폭 — `scale()` 로 줄이면 미디어쿼리가 실제 폭을 못 본다. */

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';
/** §5.23 — 웹뷰 없는 화면(휴대폰 웹)의 인터넷 페이지 iframe. 새 창은 샌드박스 밖으로 둔다(묶으면 그 탭의 스크립트·로그인이 깨진다). 최상위 이동은 막는다. */
const WEB_IFRAME_SANDBOX = `${IFRAME_SANDBOX} allow-popups-to-escape-sandbox`;

/** Electron 웹뷰 태그를 쓸 수 있나 — 본체 창·떼어 낸 iframe 탭 창은 켜 두었다(손님 설정은 main 이 다시 쓴다 — 전용 세션·샌드박스·권한 거절). 휴대폰 웹 접속(§4)엔 없다. */
export function canUseWebview(): boolean {
  if (typeof window === 'undefined') return false;
  const registry = window.customElements;
  return typeof registry?.get === 'function' && registry.get('webview') !== undefined;
}

interface PreviewFramesProps {
  picker: PreviewPicker;
  /** 없으면 조준 레이어를 달지 않는다(캡처를 열지 않은 화면). */
  snip?: PreviewSnip | undefined;
  /** 프록시를 거친 최종 src(`web` 이면 원본 주소 그대로). */
  src: string;
  /** §5.23 — 인터넷 페이지(프록시 밖 공인 호스트)는 iframe 이 아니라 격리 웹뷰로 — 본체 창은 샌드박스 밖이라 하위 프레임도 그렇다. 다리가 없어 집기 등록도 없다. */
  web?: boolean | undefined;
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
  web,
  primaryRef,
  reloadKey,
  className,
  style,
}: PreviewFramesProps): React.JSX.Element {
  const { t } = useTranslation();
  // §5.23 「더블클릭」 — 인터넷 페이지는 격리 웹뷰로(데스크톱), 웹뷰가 없는 화면에서는 직접 iframe 으로 싣는다.
  const webview = web === true && canUseWebview();
  const frameTitle = web === true ? t('common.iframe.webPage') : t('common.iframe.serverPreview');

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

  // iframe(다른 오리진) 위에선 `.scrollbar-thin:hover` 가 서지 않아, 안에서 온 신고(§7.11 다리)를 `:hover` 대신 쓴다.
  const hoverReveal = picker.hovered ? 'true' : 'false';

  /** 표면만 갈린다(로컬 = 프록시 iframe + 집기 등록, 인터넷 = 등록 없음) — 배치는 한 벌이어야 한쪽만 고쳐지지 않는다. */
  const frame = (
    frameKey: string | number | undefined,
    register: ((el: HTMLIFrameElement | null) => void) | undefined,
    frameClassName: string,
    frameStyle: React.CSSProperties | undefined,
    title: string,
  ): React.JSX.Element => {
    if (webview) {
      return (
        <webview key={frameKey} src={src} partition={WEB_PAGE_PARTITION} className={frameClassName} style={frameStyle} title={title} />
      );
    }
    if (web === true) {
      return (
        <iframe key={frameKey} src={src} className={frameClassName} style={frameStyle} title={title} sandbox={WEB_IFRAME_SANDBOX} />
      );
    }
    return (
      <iframe
        key={frameKey}
        ref={register}
        src={src}
        onLoad={(e) => picker.notifyFrameLoaded(e.currentTarget)}
        className={frameClassName}
        style={frameStyle}
        title={title}
        sandbox={IFRAME_SANDBOX}
      />
    );
  };

  return (
    <div className={`relative flex min-h-0 flex-1 overflow-hidden ${className ?? ''}`} style={style}>
      {compare === null ? (
        <div
          className="scrollbar-thin flex min-h-0 flex-1 justify-center overflow-auto"
          {...scrollReveal}
          data-hovering={hoverReveal}
        >
          {frame(
            reloadKey,
            attachPrimary,
            'h-full border-0 bg-white',
            picker.deviceWidth === null
              ? { width: '100%' }
              : { width: `${picker.deviceWidth}px`, flex: '0 0 auto' },
            frameTitle,
          )}
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
              {frame(
                `${entry.id}-${reloadKey ?? 0}`,
                index === 0 ? attachPrimary : picker.registerFrame,
                'min-h-0 w-full flex-1 border-0 bg-white',
                undefined,
                `${frameTitle} — ${entry.width}px`,
              )}
            </div>
          ))}
        </div>
      )}
      {snip ? <PreviewSnipOverlay snip={snip} /> : null}
    </div>
  );
}
