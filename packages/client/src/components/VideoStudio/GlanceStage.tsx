import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { StageRect } from './glanceView.js';

/** §5.4 #36 (J) ② — 훑는 동안 결과 칸 아래 가장자리에 서는 장면 띠(장면 구간 · 지금 자리, 0~1). */
export interface GlanceBand {
  readonly segments: readonly { readonly from: number; readonly to: number }[];
  readonly at: number;
}

export interface GlanceStageViewProps {
  readonly image: string | null;
  /** 그림을 기다리는 중(아이콘이 숨 쉰다). */
  readonly loading: boolean;
  /** 빈 문서 — 안내를 보인다. */
  readonly empty: boolean;
  readonly glow: string;
  readonly icon: ReactNode;
  /** ④ 바뀐 아이템 상자(결과 칸 px). */
  readonly outlines: readonly StageRect[];
  readonly band: GlanceBand | null;
  /** ④ 직전 판을 보는 중 — 그림을 받는 동안은 숨 쉰다. */
  readonly holdBadge: 'loading' | 'shown' | null;
  /** ② 누르지 않고 지나가는 포인터의 x 비율(떠나면 `null`). 재생 중이면 없다(판이 받는다). */
  readonly onScrub: ((fraction: number | null) => void) | null;
}

/** 0~1 → `%` 글자(소수 한 자리). */
function pct(v: number): string {
  return `${Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10}%`;
}

/**
 * §5.4 #36 (J) — 훑어보기 결과 칸: 포스터·훑는 그림·직전 판 한 장 + 바뀐 아이템 테 + 장면 띠. 누름은 그대로 노드로 올라간다
 * (선택·끌기·더블클릭 열기 — (G) 불변). 훑기는 마우스·펜의 hover 만이다(터치엔 hover 가 없다).
 */
export function GlanceStageView(p: GlanceStageViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const onScrub = p.onScrub;
  return (
    <>
      {p.image ? (
        <img
          src={p.image}
          alt=""
          draggable={false}
          className={`pointer-events-none absolute inset-0 h-full w-full select-none object-contain ${p.holdBadge === 'loading' ? 'opacity-60' : ''}`}
        />
      ) : p.empty ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
          <span className="opacity-70 [&>svg]:h-5 [&>svg]:w-5" style={{ color: p.glow }}>{p.icon}</span>
          <span className="text-[12px] leading-tight text-white/55">{t('panel.apps.canvas.docEmpty', { defaultValue: 'Empty video — ask the linked AI or open the editor' })}</span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className={`flex [&>svg]:h-6 [&>svg]:w-6 ${p.loading ? 'animate-pulse opacity-60' : 'opacity-75'}`} style={{ color: p.glow }}>{p.icon}</span>
        </div>
      )}
      {p.outlines.map((r, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[2px] border"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height, borderColor: p.glow, boxShadow: '0 0 0 1px rgba(0,0,0,0.45)' }}
        />
      ))}
      {p.band ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/55">
          {p.band.segments.map((s, i) => (
            <span key={i} className="absolute inset-y-0 border-l border-black/80" style={{ left: pct(s.from), width: pct(s.to - s.from), background: `${p.glow}59` }} />
          ))}
          <span className="absolute -top-1 bottom-0 w-[2px] -translate-x-1/2 bg-white" style={{ left: pct(p.band.at) }} />
        </div>
      ) : null}
      {p.holdBadge ? (
        <span className={`pointer-events-none absolute left-1 top-1 rounded-sm bg-black/70 px-1 text-[12px] leading-4 text-white/90 ${p.holdBadge === 'loading' ? 'motion-safe:animate-pulse' : ''}`}>
          {t('panel.apps.canvas.holdBadge')}
        </span>
      ) : null}
      {onScrub ? (
        <div
          className="absolute inset-0"
          onPointerMove={(e) => {
            if (e.pointerType === 'touch' || e.buttons !== 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width > 0) onScrub((e.clientX - r.left) / r.width);
          }}
          onPointerLeave={() => onScrub(null)}
          onPointerDown={() => onScrub(null)}
        />
      ) : null}
    </>
  );
}
