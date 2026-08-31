import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { LIFTED_LANGUAGE_Z, LIFTED_LANGUAGE_MENU_Z, liftedSlotPosition } from './headerLanguageLift.js';
import { useAnyOnboardingGateOpen } from '../../stores/onboardingGates.js';

/**
 * 헤더(상단 탭) 오른쪽 언어 전환기의 자리 — 온보딩 창이 떠 있으면 **그 창 위로 띄운다**(§4 첫 실행 온보딩).
 *
 * 새 OS 에 앱을 처음 깔면 Claude 설치 창이 곧바로 뜨는데, 그 창의 백드롭은 `fixed inset-0` 이라
 * 헤더까지 덮는다 — 전환기는 눈에는 보이지만 **눌리지 않는다**(백드롭이 클릭을 먼저 받는다).
 * 처음 켠 사람에게 이 자리가 앱을 모국어로 바꾸는 첫 입구이므로, 창이 떠 있는 동안만 같은
 * 전환기를 `document.body` 로 빼서 **원래 자리 좌표 그대로** 창보다 위에 그린다.
 *
 * 왜 z-index 만 올리지 않는가 — 헤더는 `relative z-[100]` 으로 자기 쌓임 맥락을 만든다.
 * 그 안에서 z 를 아무리 올려도 헤더(100) 밖으로는 못 나가 100_500 대의 창을 넘지 못한다.
 *
 * 원래 자리에는 같은 전환기를 `invisible` 로 남긴다 — 자리(폭)를 그대로 지켜야 띄운 것이 정확히
 * 그 위에 겹치고, 언어를 바꿔 글자 폭이 달라져도 두 벌이 저절로 같은 크기가 된다.
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
