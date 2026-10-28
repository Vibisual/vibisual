import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { LIFTED_LANGUAGE_Z, LIFTED_LANGUAGE_MENU_Z, liftedSlotPosition } from './headerLanguageLift.js';
import { useAnyOnboardingGateOpen } from '../../stores/onboardingGates.js';

/**
 * 헤더 언어 전환기의 자리(§4) — 온보딩 백드롭(`fixed inset-0`)이 헤더를 덮어 안 눌리는 동안 같은 전환기를 `document.body` 로 빼 원래 좌표에 그린다.
 * z-index 만 올리면 헤더 `relative z-[100]` 쌓임 맥락에 갇혀 100_500 대 창을 못 넘는다. 원래 자리는 `invisible` 로 남겨 폭을 지킨다(겹침·크기 일치).
 */
export function HeaderLanguageSlot(): React.JSX.Element {
  const gated = useAnyOnboardingGateOpen();
  const slotRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const el = slotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = liftedSlotPosition({ width: r.width, height: r.height, top: r.top, left: r.left });
    // 같은 좌표면 새 객체를 넣지 않는다 — ResizeObserver 가 자주 불려도 헛리렌더가 안 생긴다.
    setPos((prev) => (prev?.top === next?.top && prev?.left === next?.left ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (!gated) {
      setPos(null);
      return;
    }
    measure();
    const el = slotRef.current;
    const ro = new ResizeObserver(measure);
    if (el) {
      ro.observe(el);
      // 이웃(사용량·감사 필, 업데이트 버튼)이 늘고 줄면 이 자리가 좌우로 밀린다 —
      // 자기 크기는 그대로라 부모까지 봐야 따라간다.
      if (el.parentElement) ro.observe(el.parentElement);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [gated, measure]);

  const lifted = gated && pos !== null;

  return (
    <>
      <div ref={slotRef} className={`app-nodrag ${lifted ? 'invisible' : ''}`}>
        <LanguageSwitcher />
      </div>
      {lifted && pos && createPortal(
        <div className="app-nodrag fixed" style={{ top: pos.top, left: pos.left, zIndex: LIFTED_LANGUAGE_Z }}>
          <LanguageSwitcher portalMenu menuZIndex={LIFTED_LANGUAGE_MENU_Z} />
        </div>,
        document.body,
      )}
    </>
  );
}
