import { useCallback, useEffect, useRef } from 'react';

/**
 * §3.2.3 / §4 — 옵션창 숫자 입력 스테퍼(우리 디자인).
 *
 * 브라우저 기본 스핀 버튼은 **엔진·OS 마다 모양이 다르고** 다크 배경 위에 밝은 화살표가 그대로
 * 떠서 옵션창의 나머지 UI 와 톤이 어긋난다(같은 화면 안에서 어떤 칸은 우리 톤, 어떤 칸은 크롬 톤).
 * 그래서 기본 스핀을 `appearance` 로 끄고 위/아래 버튼을 직접 그린다 — 테두리·hover 색은
 * `AgentConfigPopup` 의 −/+ 스테퍼와 같은 값이라 두 화면이 한 벌로 보인다.
 *
 * 값 규약(`min`·`max`·`step`)은 호출부가 준다. 여기서는 그 범위 안으로 접기만 한다
 * (보존 설정은 `RETENTION_LIMITS`, 에이전트 기본값은 CLI 사양이 각각 진실이다).
 */

/** 버튼을 누른 채로 있을 때 연타로 넘어가기까지의 유예(ms) — OS 키 리피트 감각. */
const HOLD_DELAY_MS = 400;
/** 연타 간격(ms). */
const HOLD_INTERVAL_MS = 60;

interface NumberStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 입력칸 폭 유틸리티 — 호출부 레이아웃에 맞춘다. */
  widthClassName?: string;
  disabled?: boolean;
  /** 라벨이 시각적으로만 붙어 있는 자리(옵션창 폼)에서 스크린리더용 이름. */
  ariaLabel?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  widthClassName = 'w-16',
  disabled = false,
  ariaLabel,
}: NumberStepperProps): React.JSX.Element {
  // 연타 타이머 안에서 읽는 값은 ref 로 — 콜백을 새로 만들면 타이머가 옛 값을 잡는다.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const holdRef = useRef<{ delay?: number; repeat?: number }>({});

  const clamp = useCallback((n: number): number => Math.min(max, Math.max(min, n)), [min, max]);

  const stopHold = useCallback((): void => {
    if (holdRef.current.delay !== undefined) window.clearTimeout(holdRef.current.delay);
    if (holdRef.current.repeat !== undefined) window.clearInterval(holdRef.current.repeat);
    holdRef.current = {};
  }, []);

  // 창이 닫히거나 탭이 바뀌어 언마운트되면 타이머가 남지 않게 한다.
  useEffect(() => stopHold, [stopHold]);

  const bump = useCallback((dir: 1 | -1): void => {
    const next = clamp(valueRef.current + dir * step);
    if (next !== valueRef.current) onChangeRef.current(next);
  }, [clamp, step]);

  const startHold = useCallback((dir: 1 | -1): void => {
    bump(dir);
    stopHold();
    // 버튼 밖에서 손을 떼도(드래그해 나간 뒤 release) 연타가 남지 않게 window 에서도 받는다.
    window.addEventListener('pointerup', stopHold, { once: true });
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.repeat = window.setInterval(() => bump(dir), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }, [bump, stopHold]);

  const handleInput = useCallback((raw: string): void => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  }, [clamp, onChange]);

  const buttonClass = 'flex flex-1 items-center justify-center text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-30';

  return (
    <span
      className={`flex items-stretch overflow-hidden rounded border bg-gray-900 focus-within:border-blue-500 ${
        disabled ? 'border-gray-800 opacity-60' : 'border-gray-700'
      }`}
    >
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => handleInput(e.target.value)}
        className={`${widthClassName} min-w-0 bg-transparent px-2 py-1.5 text-right text-xs text-gray-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <span className="flex w-5 shrink-0 flex-col border-l border-gray-700">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled || value >= max}
          aria-hidden="true"
          onPointerDown={() => startHold(1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className={buttonClass}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled || value <= min}
          aria-hidden="true"
          onPointerDown={() => startHold(-1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className={`${buttonClass} border-t border-gray-700`}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </span>
    </span>
  );
}
