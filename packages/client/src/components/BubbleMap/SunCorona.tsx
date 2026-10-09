import type { CSSProperties } from 'react';

/** 플레어/블러 여유 (작게 = 라인이 버블에 밀착) */
const SUN_MARGIN = 16;

/** 버블 반지름 안쪽은 강제 클립 — 일렁임/블러가 어떤 경우에도 내부로 못 들어옴. */
const SUN_MASK = `radial-gradient(circle closest-side, transparent calc(100% - ${SUN_MARGIN}px), #000 calc(100% - ${SUN_MARGIN - 1}px), #000 100%)`;

interface SunCoronaProps {
  /** 문서 안에서 유일해야 한다 — 필터·그라디언트가 이 id 로 참조된다. */
  filterId: string;
  /** 버블 지름(px). 코로나는 사방으로 SUN_MARGIN 만큼 더 크다. */
  size: number;
  glow: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * 선택 하이라이트 — 태양 코로나(외곽선이 일렁이는 플레어).
 * feTurbulence + feDisplacementMap 으로 외곽선을 진짜 일렁이게(태양 표면/플레어).
 * 픽셀 기준(viewBox=px)이라 버블 크기와 무관하게 일렁임 진폭이 일정.
 *
 * §5.4 #31 (K) 2026-10-09 — 도는 것은 **감싼 div** 다. SVG 요소(바깥 <svg> 포함)의 transform 애니메이션은
 * 화면 배율이 100% 가 아니면(Windows 150% 등) Chromium 이 합성으로 못 돌려(compositeFailed 1024) 메인
 * 스레드가 매 프레임 회전을 계산하고 캔버스 레이어를 통째로 다시 짰다 — 초점이 켜져 있는 내내 큰 지도에서
 * 프레임마다 7ms. HTML 요소는 합성으로 돈다(필터는 처음 한 번만 그려진다). 마스크는 원 대칭이라 함께
 * 돌아도 모양이 같다. 첫 선택 예열(`CoronaWarmup`)도 이 컴포넌트를 그대로 그린다 — 모양이 어긋나면
 * GPU 가 미리 준비한 것과 실제 코로나가 달라 예열이 헛돈다.
 */
export function SunCorona({ filterId, size, glow, className, style }: SunCoronaProps): React.JSX.Element {
  const sunBox = size + SUN_MARGIN * 2;
  const sunC = sunBox / 2;
  const sunR = size / 2; // 필라멘트를 버블 테두리 바로 위에 (안쪽은 클립)
  return (
    <div
      className={`animate-sun-spin pointer-events-none absolute ${className ?? ''}`}
      style={{ left: -SUN_MARGIN, top: -SUN_MARGIN, width: sunBox, height: sunBox, WebkitMask: SUN_MASK, mask: SUN_MASK, ...style }}
    >
      <svg className="block h-full w-full" viewBox={`0 0 ${sunBox} ${sunBox}`} fill="none">
        <defs>
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
            {/* 정적 노이즈 — 1회만 계산되어 캐시됨(매 프레임 재생성 X = 끊김 제거) */}
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d" />
            <feGaussianBlur in="d" stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="d" />
            </feMerge>
          </filter>
          {/* 빛 falloff: 클립 경계(=버블 테두리)에서 이미 최대 밝기 → 바깥으로 0.
              안쪽 stop 은 클립으로 안 보이지만, edge 에서 ramp-up 없이 바로 밝게 해 빈틈 제거. */}
          <radialGradient id={`${filterId}-g`} gradientUnits="userSpaceOnUse" cx={sunC} cy={sunC} r={sunR + 12}>
            <stop offset={(sunR - 4) / (sunR + 12)} stopColor={glow} stopOpacity={0.44} />
            <stop offset={(sunR + 2) / (sunR + 12)} stopColor={glow} stopOpacity={0.32} />
            <stop offset={(sunR + 6) / (sunR + 12)} stopColor={glow} stopOpacity={0.1} />
            <stop offset={1} stopColor={glow} stopOpacity={0} />
          </radialGradient>
        </defs>
        {/* 느린 회전 = 플레어가 표면을 따라 흐름.
            레이어: (1) 안밝→밖흐림 그라디언트 띠  (2) 그 위 얇고 또렷한 빛 필라멘트 */}
        <g filter={`url(#${filterId})`}>
          <circle cx={sunC} cy={sunC} r={sunR + 12} fill={`url(#${filterId}-g)`} />
          <circle cx={sunC} cy={sunC} r={sunR} stroke={glow} strokeWidth={1.25} opacity={0.72} />
        </g>
      </svg>
    </div>
  );
}
