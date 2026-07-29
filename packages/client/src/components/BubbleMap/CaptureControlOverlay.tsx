import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAPTURE_BUBBLE_DEFAULTS } from '@vibisual/shared';

// §5.9 원격 조작 오버레이 — 캔버스 캡처 노드(CaptureNode)와 크게 보기 창(CaptureWindow)이 공유하는 표시층.
// 마우스 모드 가상 커서 화살표 + 모바일에 없는 특수키 바(클립보드 붙여넣기 포함). 조작 모드가 'off' 면
// 호출부가 아예 렌더하지 않는다(기본 상태에선 화면에 아무것도 얹히지 않음).
//
// v3.56 — 특수키 바를 **접이식 유리 알약**으로 바꿨다. 종전엔 13개 버튼이 본체 하단에 상시 펼쳐져
// 320×180 기본 버블에서 두세 줄로 접히며 영상의 절반 가까이를 가렸다(조작을 켜는 순간 정작 볼 화면이
// 사라지는 모순). 이제 평소엔 작은 키보드 알약 하나만 떠 있고, 누르면 한 줄짜리 가로 스크롤 바가
// 펼쳐진다 — 영상을 가리는 면적이 최소이고, 필요할 때만 손이 닿는다.

/** 특수키 바 버튼 정의 — press 로 주입할 정규화 키(+모디파이어). */
export interface SpecialKeyDef {
  label: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export const CAPTURE_SPECIAL_KEYS: readonly SpecialKeyDef[] = [
  { label: 'Esc', key: 'Escape' },
  { label: 'Tab', key: 'Tab' },
  { label: '↵', key: 'Enter' },
  { label: '⌫', key: 'Backspace' },
  { label: 'Del', key: 'Delete' },
  { label: '↑', key: 'ArrowUp' },
  { label: '↓', key: 'ArrowDown' },
  { label: '←', key: 'ArrowLeft' },
  { label: '→', key: 'ArrowRight' },
  { label: '^C', key: 'c', ctrl: true },
  { label: '^V', key: 'v', ctrl: true },
  { label: '^Z', key: 'z', ctrl: true },
];

/** 유리 알약 공통 스타일 — 영상 위에 얹히는 조작 요소는 전부 이 톤을 쓴다. */
const GLASS: React.CSSProperties = {
  background: 'rgba(8,10,14,0.78)',
  border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
  backdropFilter: 'blur(10px)',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.9)',
};

interface Props {
  /** 복제 커서의 표면 기준 px(두 모드 공통). */
  cursorPx: { x: number; y: number } | null;
  /**
   * 복제 커서를 그릴 배율(v3.65) — 캔버스가 축소돼 있어도 **진짜 커서와 같은 크기**로 보이게 1/zoom 을
   * 넘긴다(창은 화면 좌표라 1). 크기가 달라지면 "내 커서"라는 착각이 바로 깨진다.
   */
  cursorScale?: number;
  /** 대상 화면/창을 못 찾아 주입이 통하지 않음 — 왜 안 되는지 알려 준다. */
  targetMissing: boolean;
  /** 마지막 주입이 실패한 이유(없으면 null) — 조용히 안 먹는 상황을 눈에 보이게. */
  injectError: 'nut-unavailable' | 'target-not-found' | 'error' | null;
  /** "커서 안 움직이기"를 켰는데 이 앱에선 불가능해 커서를 잠깐 빌려 쓴 경우의 사유. */
  backgroundFallback: 'ffi-unavailable' | 'no-window' | 'message-deaf-app' | null;
  onSpecialKey: (def: SpecialKeyDef) => void;
  onPaste: () => void;
}

export const CaptureControlOverlay = memo(function CaptureControlOverlay({
  cursorPx,
  cursorScale = 1,
  targetMissing,
  injectError,
  backgroundFallback,
  onSpecialKey,
  onPaste,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [keysOpen, setKeysOpen] = useState(false);
  const control = CAPTURE_BUBBLE_DEFAULTS.CONTROL_COLOR;

  return (
    <>
      {/* 복제 커서(v3.65) — **진짜 커서는 표면 위에서 숨겨 두고**(cursor:none) 시스템 커서와 같은
          모양·같은 크기의 대역을 손 위치에 그린다. 클릭을 주입할 때 진짜 커서가 대상 지점으로 잠깐
          다녀오지만, 사용자 눈에는 자기 커서가 클릭한 자리에 그대로 있는 것으로 보인다.
          터치 모드=실제 포인터를 1:1 로, 마우스 모드=밀어 옮긴 가상 포인터 자리에.
          모양을 시스템 커서와 맞춰야 착각이 유지되므로 색·후광·애니메이션을 넣지 않는다. */}
      {cursorPx && (
        <span
          style={{
            position: 'absolute',
            left: cursorPx.x,
            top: cursorPx.y,
            width: 0,
            height: 0,
            pointerEvents: 'none',
            zIndex: 3,
            lineHeight: 0,
            transform: `scale(${cursorScale})`,
            transformOrigin: 'top left',
          }}
          aria-hidden="true"
        >
          <svg
            width="12"
            height="19"
            viewBox="0 0 12 19"
            style={{ display: 'block', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))' }}
          >
            <path
              d="M0.5 0.7 L0.5 15.4 L4.1 12.0 L6.4 17.6 L8.9 16.6 L6.6 11.2 L11.2 11.2 Z"
              fill="#fff"
              stroke="#111"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}

      {/* 왜 안 먹는지 — 종전엔 실패해도 조용해서 "클릭이 안 먹는다"로만 보였다(v3.61).
          대상을 못 찾거나 주입 엔진이 없으면 그 이유를 칩으로 띄운다. */}
      {(targetMissing || injectError) && (
        <div
          className="absolute left-1/2 top-2 z-[4] -translate-x-1/2 rounded-full px-2.5 py-1 text-[10px] font-semibold"
          style={{ ...GLASS, color: '#FCA5A5', pointerEvents: 'none' }}
        >
          {injectError === 'nut-unavailable'
            ? t('bubbleMap.capture.controlEngineMissing', { defaultValue: '조작 엔진을 불러오지 못했습니다 · 앱을 다시 실행해 주세요' })
            : injectError === 'error'
              ? t('bubbleMap.capture.controlInjectFailed', { defaultValue: '조작 주입에 실패했습니다' })
              : t('bubbleMap.capture.controlTargetMissing', { defaultValue: '조작 대상을 찾을 수 없습니다 · 소스를 다시 선택하세요' })}
        </div>
      )}

      {/* "커서 안 움직이기"를 켰지만 이 앱은 그 방식을 무시해 커서를 잠깐 빌려 썼다 — 왜 커서가
          움직였는지 몰라 헤매지 않도록 알려 준다(v3.62). */}
      {!targetMissing && !injectError && backgroundFallback && (
        <div
          className="absolute left-1/2 top-2 z-[4] -translate-x-1/2 rounded-full px-2.5 py-1 text-[10px] font-semibold"
          style={{ ...GLASS, color: '#FCD34D', pointerEvents: 'none' }}
        >
          {backgroundFallback === 'message-deaf-app'
            ? t('bubbleMap.capture.backgroundClickBlocked', { defaultValue: '이 창은 배경 클릭을 무시해 커서를 잠깐 사용했습니다' })
            : t('bubbleMap.capture.backgroundClickUnavailable', { defaultValue: '배경 클릭을 쓸 수 없어 커서를 잠깐 사용했습니다' })}
        </div>
      )}

      {/* 특수키 — 평소엔 알약 하나, 누르면 한 줄로 펼쳐진다(영상 가림 최소화). */}
      <div
        className="nodrag nowheel absolute bottom-1.5 left-1/2 z-[4] flex max-w-[calc(100%-12px)] -translate-x-1/2 items-center gap-1 rounded-full px-1 py-1"
        style={{ ...GLASS, pointerEvents: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setKeysOpen((v) => !v); }}
          className="flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold transition-colors"
          style={{ background: keysOpen ? `${control}2e` : 'transparent', color: keysOpen ? control : '#CBD5E1' }}
          title={t('bubbleMap.capture.keysToggle', { defaultValue: '특수키 · 붙여넣기' })}
          aria-label={t('bubbleMap.capture.keysToggle', { defaultValue: '특수키 · 붙여넣기' })}
          aria-expanded={keysOpen}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="5" rx="2" />
            <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M8 13h8" />
          </svg>
        </button>

        {keysOpen && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto pr-0.5" style={{ scrollbarWidth: 'none' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPaste(); }}
              className="flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-semibold text-slate-900 transition-opacity hover:opacity-90"
              style={{ background: '#E2E8F0' }}
              title={t('bubbleMap.capture.paste', { defaultValue: '클립보드 붙여넣기 (폰→PC)' })}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="8" height="4" x="8" y="2" rx="1" />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              </svg>
              {t('bubbleMap.capture.pasteShort', { defaultValue: '붙여넣기' })}
            </button>
            <span className="h-3.5 w-px shrink-0" style={{ background: 'rgba(255,255,255,0.14)' }} />
            {CAPTURE_SPECIAL_KEYS.map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={(e) => { e.stopPropagation(); onSpecialKey(k); }}
                className="h-5 min-w-[22px] shrink-0 rounded-md px-1.5 text-[10px] font-semibold text-slate-200 transition-colors hover:bg-white/20"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
});
