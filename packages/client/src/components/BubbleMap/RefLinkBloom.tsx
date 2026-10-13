import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { REF_BLOOM, REF_LINK_STYLE } from '@vibisual/shared';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import {
  bloomPetalOffsets,
  clampBloomCenter,
  pointOnOrbitToward,
  refLinkPath,
  type OrbitOrigin,
} from './agentCard.js';
import { RefDock, RefTether } from './RefTether.js';

/**
 * §5.4 #36 (B) — **꽃잎 고르기.** 위성을 빈 곳에 놓았거나(놓은 자리) 눌렀을 때(원 오른쪽) 등록된 앱들이 그 자리를
 * 가운데로, 끌어온 방향 **앞쪽**에 부채꼴로 핀다. 고르면 그 에이전트를 참조한 채 태어나는 앱 노드가 선다.
 *
 * 이 자리만의 모양이라 공용 메뉴(`IDEContextMenu`)를 늘이지 않는다. 고르기 전까지 원에서 가운데 고리로 **보류 줄**이
 * 이어져 있다(확정 줄과 같은 `RefTether`). 방향키로 돌고 Enter·Space 로 고른다. Esc·바깥 누름·휠·우클릭 = 취소.
 * 꽃은 화면 좌표에 핀다 — 캔버스가 움직이면 그 아래 자리가 달라지므로, 휠이 오면 닫는다.
 */
export interface RefBloomItem {
  id: string;
  /** 꽃잎 이름(가운데 한 줄 · 접근성 이름). */
  label: string;
  /** 툴팁 한 줄(앱 설명). */
  note: string;
  icon: React.ReactNode;
  /** 앱 색 — 아이콘과 고른 꽃잎의 테. */
  glow: string;
}

export interface RefLinkBloomProps {
  /** 꽃이 피는 가운데(화면 좌표). 화면 밖으로 넘치면 안쪽으로 민다. */
  x: number;
  y: number;
  /** 꽃잎이 향하는 쪽(라디안, 화면 좌표 — 0 = 오른쪽, π/2 = 아래). */
  facing: number;
  /** 보류 줄이 나오는 원(화면 좌표). 없으면 줄 없이 꽃만. */
  origin: OrbitOrigin | null;
  /** 줄 색(에이전트 색). */
  color: string;
  /** 꽃 전체의 접근성 이름. */
  label: string;
  items: readonly RefBloomItem[];
  onPick: (appId: string) => void;
  onClose: () => void;
}

/** 이름 한 줄의 높이(12px 글자 + 위아래 여백) — 꽃잎이 아래로 필 때 이름을 가운데 위로 올리는 데 쓴다. */
const CAPTION_HEIGHT = 20;

export function RefLinkBloom({
  x,
  y,
  facing,
  origin,
  color,
  label,
  items,
  onPick,
  onClose,
}: RefLinkBloomProps): React.JSX.Element {
  const offsets = useMemo(() => bloomPetalOffsets(items.length, facing), [items.length, facing]);
  const center = useMemo(
    () => clampBloomCenter(x, y, offsets, window.innerWidth, window.innerHeight),
    [x, y, offsets],
  );
  const [active, setActive] = useState(0);
  const seedRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 첫 꽃잎에 초점 — 키보드로 바로 돈다(스크롤로 캔버스를 밀지 않게).
  useEffect(() => {
    seedRefs.current[0]?.focus({ preventScroll: true });
  }, []);

  // Esc = 취소. 조합 중 Esc 는 입력기의 것이다. 캔버스 단축키보다 먼저 받는다(capture).
  //   창을 떠나도 취소다 — 돌아왔을 때 아래 캔버스가 이미 움직였을 수 있다(끌기 취소와 같은 규칙).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isComposingKeyEvent(e) || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    const onBlur = (): void => onCloseRef.current();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const focusAt = (i: number): void => {
    const n = items.length;
    if (n === 0) return;
    const next = ((i % n) + n) % n;
    setActive(next);
    seedRefs.current[next]?.focus({ preventScroll: true });
  };

  // 보류 줄 — 원 둘레에서 가운데 고리 테두리까지. 둘이 겹칠 만큼 가까우면 줄 없이 고리만.
  const tether = useMemo(() => {
    if (!origin) return null;
    if (Math.hypot(center.x - origin.x, center.y - origin.y) <= origin.r + REF_LINK_STYLE.dockActiveRadius) return null;
    const start = pointOnOrbitToward(origin, center.x, center.y);
    const end = pointOnOrbitToward({ x: center.x, y: center.y, r: REF_LINK_STYLE.dockActiveRadius }, origin.x, origin.y);
    return refLinkPath(start.x, start.y, end.x, end.y);
  }, [origin, center]);

  // 이름 한 줄 — 꽃잎이 아래로 피면 가운데 위, 아니면 아래(꽃잎과 겹치지 않는 쪽).
  const captionTop = Math.sin(facing) > 0.5
    ? center.y - REF_BLOOM.captionGap - CAPTION_HEIGHT
    : center.y + REF_BLOOM.captionGap;
  const current = items[active];

  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={() => onClose()}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {tether && <RefTether d={tether.path} stroke={color} flowing />}
        <RefDock x={center.x} y={center.y} color={color} active />
      </svg>
      <div role="menu" aria-label={label}>
        {items.map((it, i) => {
          const o = offsets[i];
          if (!o) return null;
          const on = i === active;
          return (
            <button
              key={it.id}
              ref={(el) => { seedRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              title={it.note}
              aria-label={it.label}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => { onPick(it.id); onClose(); }}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (step === 0) return;
                e.preventDefault();
                e.stopPropagation();
                focusAt(i + step);
              }}
              // 확대는 `scale` 속성이다(Tailwind 4) — 피어나는 `transform` 애니메이션과 겹쳐 쓰지 않는다.
              className="ref-bloom-seed absolute flex items-center justify-center rounded-full border bg-gray-950/95 outline-none transition-[border-color,box-shadow,scale] duration-150 hover:scale-110 focus-visible:scale-110"
              style={{
                left: center.x + o.dx - REF_BLOOM.seedSize / 2,
                top: center.y + o.dy - REF_BLOOM.seedSize / 2,
                width: REF_BLOOM.seedSize,
                height: REF_BLOOM.seedSize,
                borderColor: on ? it.glow : 'rgba(255,255,255,0.14)',
                boxShadow: on ? `0 0 0 3px ${it.glow}33, 0 6px 16px rgba(0,0,0,0.5)` : '0 6px 16px rgba(0,0,0,0.5)',
                animationDelay: `${i * REF_BLOOM.staggerMs}ms`,
                // 피어나는 출발점 — 가운데(자기 자리에서 가운데까지의 반대 오프셋). `index.css` `.ref-bloom-seed`.
                ['--bloom-dx' as string]: `${-o.dx}px`,
                ['--bloom-dy' as string]: `${-o.dy}px`,
              }}
            >
              <span className="flex [&>svg]:h-5 [&>svg]:w-5" style={{ color: it.glow }}>{it.icon}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-gray-950/90 px-2 py-0.5 text-[12px] leading-4 text-gray-100 shadow-md shadow-black/40"
          style={{ left: center.x, top: captionTop }}
        >
          {current.label}
        </div>
      )}
    </div>,
    document.body,
  );
}
