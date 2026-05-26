/**
 * §5.3 #28 v1.60 — Conti Stamp SVG 컴포넌트.
 *
 * STAMP_CATALOG (shared/constants.ts) 의 각 stampName 에 대응하는 prebuilt SVG.
 * LLM 이 좌표 합성으로 UI 컴포넌트를 매번 새로 그리지 않도록 강제하기 위한 것.
 *
 * 좌표계: 모든 stamp 는 자신의 bounding box 좌상단 (0,0) → (w,h) 기준으로 그리고,
 * StampSvg 가 부모 SVG 의 viewBox 320×180 위로 `<g transform="translate(x,y)">` 로 배치.
 *
 * 새 stamp 추가 시:
 *   1) shared/constants.ts 의 STAMP_CATALOG 에 항목 추가
 *   2) CONTI_AGENT_RULES 의 STAMP_CATALOG 섹션에 한 줄 추가
 *   3) 본 파일의 `RENDERERS` 맵에 함수 추가
 */
import type { JSX } from 'react';
import { STAMP_CATALOG } from '@vibisual/shared';

type StampProps = {
  /** 박스 폭 — 카탈로그 defaultW 기준으로 스케일 */
  w: number;
  /** 박스 높이 — 카탈로그 defaultH 기준으로 스케일 */
  h: number;
  /** stamp 안에 들어갈 1-2단어 캡션 (선택) */
  label?: string;
  /** stamp 의 상태/방향 variant (카탈로그에 있는 키) */
  variant?: string;
  /** selected 강조 (외곽선 파란색 + 두께 +1) */
  selected?: boolean;
};

type Renderer = (props: StampProps) => JSX.Element;

// §5.3 #28 v1.61 — Conti Design System 토큰 (다크 3-레이어 + 보라/민트 의미)
// CONTI_AGENT_RULES 의 Color Palette 섹션과 1:1 동기화.
const C = {
  // 3-layer dark
  bgOuter:  '#0F1117',
  bgCard:   '#1A1D26',
  bgDemo:   '#242833',
  bgChrome: '#2D3140',

  // semantic
  action:   '#A78BFA',  // 보라: 사용자 액션/트리거
  result:   '#00E5A0',  // 민트: 시스템 결과/생성

  // backwards-compat alias (기존 stamp 코드에서 쓰던 키들 → 새 토큰으로 재매핑)
  bgCanvas:        '#242833',  // 데모 영역 배경
  bgSubtle:        'rgba(255,255,255,0.04)',
  border:          'rgba(255,255,255,0.06)',
  borderStrong:    'rgba(255,255,255,0.12)',
  text:            '#E8E8E8',
  textSecondary:   '#9CA3AF',
  textPlaceholder: '#4B5563',
  accent:          '#A78BFA',
  accentBg:        'rgba(167,139,250,0.15)',
  success:         '#00E5A0',
  warning:         '#A78BFA',  // 단일 톤 유지 — 경고도 action 컬러로 흡수
  danger:          '#FF5F57',  // traffic light red 만 예외 (UI 신호등용)
  annotation:      '#4B5563',
  terminalBg:      '#0a0d14',
  terminalText:    '#9CA3AF',
  terminalPrompt:  '#00E5A0',

  // traffic lights (macOS chrome — 의미 컬러와 무관, 시각 신호로만 유지)
  trafficR: '#FF5F57',
  trafficY: '#FEBC2E',
  trafficG: '#28C840',
} as const;

function selectStroke(selected: boolean | undefined, base: string): string {
  return selected ? C.accent : base;
}

function selectWidth(selected: boolean | undefined, base: number): number {
  return selected ? base + 1 : base;
}

// ──────────────────────────────────────────────────────────────────
// Windows & Containers
// ──────────────────────────────────────────────────────────────────

const browserWindow: Renderer = ({ w, h, label, variant, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  const titlebarH = Math.max(14, h * 0.18);
  const urlBarW = w * 0.55;
  const urlBarH = Math.max(10, titlebarH * 0.6);
  const urlBarY = titlebarH / 2 - urlBarH / 2;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={4} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      <rect x={0} y={0} width={w} height={titlebarH} rx={4} fill={C.bgSubtle} stroke="none" />
      <line x1={0} y1={titlebarH} x2={w} y2={titlebarH} stroke={C.border} strokeWidth={1} />
      {/* traffic lights */}
      <circle cx={6} cy={titlebarH / 2} r={2.5} fill={C.trafficR} />
      <circle cx={13} cy={titlebarH / 2} r={2.5} fill={C.trafficY} />
      <circle cx={20} cy={titlebarH / 2} r={2.5} fill={C.trafficG} />
      {/* url bar */}
      <rect x={(w - urlBarW) / 2} y={urlBarY} width={urlBarW} height={urlBarH} rx={urlBarH / 2} fill={C.bgCard} stroke={C.border} strokeWidth={1} />
      {label && (
        <text x={w / 2} y={urlBarY + urlBarH / 2 + 3} textAnchor="middle" fontSize={Math.min(9, urlBarH * 0.7)} fill={C.textSecondary}>
          {label.slice(0, 32)}
        </text>
      )}
      {/* body content placeholder lines */}
      <rect x={w * 0.08} y={titlebarH + h * 0.12} width={w * 0.4} height={4} rx={2} fill={C.bgSubtle} />
      <rect x={w * 0.08} y={titlebarH + h * 0.22} width={w * 0.7} height={3} rx={1.5} fill={C.bgSubtle} />
      <rect x={w * 0.08} y={titlebarH + h * 0.3} width={w * 0.55} height={3} rx={1.5} fill={C.bgSubtle} />
      {variant === 'with-modal' && (
        <>
          <rect x={w * 0.2} y={titlebarH + (h - titlebarH) * 0.25} width={w * 0.6} height={h * 0.5} rx={4} fill={C.bgCard} stroke={C.borderStrong} strokeWidth={1.5} />
          <line x1={w * 0.2} y1={titlebarH + (h - titlebarH) * 0.25 + 14} x2={w * 0.8} y2={titlebarH + (h - titlebarH) * 0.25 + 14} stroke={C.border} strokeWidth={1} />
        </>
      )}
    </g>
  );
};

const appWindow: Renderer = ({ w, h, label, variant, selected }) => {
  const isDark = variant === 'dark';
  const bg = isDark ? '#1f2937' : C.bgCard;
  const titleColor = isDark ? '#f3f4f6' : C.text;
  const stroke = selectStroke(selected, isDark ? '#374151' : C.border);
  const sw = selectWidth(selected, 1.5);
  const titlebarH = Math.max(14, h * 0.16);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={4} fill={bg} stroke={stroke} strokeWidth={sw} />
      <rect x={0} y={0} width={w} height={titlebarH} rx={4} fill={isDark ? '#111827' : C.bgSubtle} stroke="none" />
      <line x1={0} y1={titlebarH} x2={w} y2={titlebarH} stroke={isDark ? '#374151' : C.border} strokeWidth={1} />
      <circle cx={6} cy={titlebarH / 2} r={2.5} fill={C.trafficR} />
      <circle cx={13} cy={titlebarH / 2} r={2.5} fill={C.trafficY} />
      <circle cx={20} cy={titlebarH / 2} r={2.5} fill={C.trafficG} />
      {label && (
        <text x={w / 2} y={titlebarH / 2 + 3} textAnchor="middle" fontSize={Math.min(10, titlebarH * 0.6)} fill={titleColor} fontWeight={500}>
          {label.slice(0, 28)}
        </text>
      )}
    </g>
  );
};

const modalDialog: Renderer = ({ w, h, label, selected }) => {
  const stroke = selectStroke(selected, C.borderStrong);
  const sw = selectWidth(selected, 1.5);
  const titleH = 16;
  const footerH = 24;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={6} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      <line x1={0} y1={titleH} x2={w} y2={titleH} stroke={C.border} strokeWidth={1} />
      {label && (
        <text x={w / 2} y={titleH * 0.7} textAnchor="middle" fontSize={11} fill={C.text} fontWeight={600}>
          {label.slice(0, 26)}
        </text>
      )}
      <line x1={0} y1={h - footerH} x2={w} y2={h - footerH} stroke={C.border} strokeWidth={1} />
      <rect x={w * 0.08} y={titleH + 8} width={w * 0.6} height={3} rx={1.5} fill={C.bgSubtle} />
      <rect x={w * 0.08} y={titleH + 16} width={w * 0.5} height={3} rx={1.5} fill={C.bgSubtle} />
      <rect x={w - 60} y={h - footerH + 5} width={50} height={footerH - 10} rx={3} fill={C.accent} stroke="none" />
      <text x={w - 35} y={h - footerH / 2 + 3} textAnchor="middle" fontSize={9} fill={C.bgCard} fontWeight={500}>OK</text>
    </g>
  );
};

const sidePanel: Renderer = ({ w, h, label, variant, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  const headerH = 18;
  const isLeft = variant === 'left';
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      <rect x={0} y={0} width={w} height={headerH} fill={C.bgSubtle} stroke="none" />
      <line x1={0} y1={headerH} x2={w} y2={headerH} stroke={C.border} strokeWidth={1} />
      {label && (
        <text x={isLeft ? w - 6 : 6} y={headerH * 0.65} textAnchor={isLeft ? 'end' : 'start'} fontSize={10} fill={C.text} fontWeight={500}>
          {label.slice(0, 18)}
        </text>
      )}
      {[0.25, 0.4, 0.55, 0.7, 0.85].map((p, i) => (
        <rect key={i} x={6} y={headerH + (h - headerH) * p - 3} width={w - 12} height={2} rx={1} fill={C.bgSubtle} />
      ))}
    </g>
  );
};

const card: Renderer = ({ w, h, label, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={5} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      {label && (
        <text x={8} y={14} fontSize={11} fill={C.text} fontWeight={600}>
          {label.slice(0, 28)}
        </text>
      )}
      <rect x={8} y={22} width={w * 0.7} height={3} rx={1.5} fill={C.bgSubtle} />
      <rect x={8} y={30} width={w * 0.55} height={3} rx={1.5} fill={C.bgSubtle} />
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Inputs
// ──────────────────────────────────────────────────────────────────

const textInput: Renderer = ({ w, h, label, variant, selected }) => {
  // v1.61 — 다크 row. focused = action(보라) ring.
  const focused = variant === 'focused' || selected;
  const stroke = focused ? C.action : C.border;
  const sw = focused ? 2 : 1;
  const isFilled = variant === 'filled' || (label && variant !== 'empty');
  const textColor = isFilled ? C.text : C.textSecondary;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={4} fill={C.bgDemo} stroke={stroke} strokeWidth={sw} />
      {label && (
        <text x={10} y={h / 2 + 3} fontSize={10} fill={textColor}>
          {label.slice(0, Math.floor(w / 5))}
        </text>
      )}
      {focused && <line x1={10 + (label?.length ?? 0) * 5.5} y1={h * 0.25} x2={10 + (label?.length ?? 0) * 5.5} y2={h * 0.75} stroke={C.action} strokeWidth={1} />}
    </g>
  );
};

const textarea: Renderer = ({ w, h, label, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      {label ? (
        <text x={6} y={14} fontSize={10} fill={C.text}>
          {label.slice(0, Math.floor(w / 5.5))}
        </text>
      ) : (
        <>
          <rect x={6} y={10} width={w * 0.6} height={2} rx={1} fill={C.textPlaceholder} opacity={0.5} />
          <rect x={6} y={18} width={w * 0.4} height={2} rx={1} fill={C.textPlaceholder} opacity={0.5} />
        </>
      )}
    </g>
  );
};

const dropdown: Renderer = ({ w, h, label, variant, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  const isOpen = variant === 'open';
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      {label && (
        <text x={8} y={h / 2 + 3} fontSize={10} fill={C.text}>
          {label.slice(0, Math.floor((w - 20) / 5.5))}
        </text>
      )}
      {/* chevron */}
      <path d={`M ${w - 12} ${h / 2 - 2} L ${w - 8} ${h / 2 + 2} L ${w - 4} ${h / 2 - 2}`} fill="none" stroke={C.textSecondary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {isOpen && (
        <g>
          <rect x={0} y={h + 2} width={w} height={h * 3 + 4} rx={3} fill={C.bgCard} stroke={C.border} strokeWidth={1.5} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              {i === 0 && <rect x={2} y={h + 4 + i * h} width={w - 4} height={h - 2} rx={2} fill={C.accentBg} />}
              <text x={8} y={h + 4 + i * h + h / 2 + 2} fontSize={9} fill={i === 0 ? '#1e40af' : C.text}>
                Option {i + 1}
              </text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
};

const checkbox: Renderer = ({ w, h, variant, selected }) => {
  const checked = variant === 'checked';
  const stroke = selectStroke(selected, checked ? C.accent : C.border);
  const sw = selectWidth(selected, 1.5);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={2} fill={checked ? C.accent : C.bgCard} stroke={stroke} strokeWidth={sw} />
      {checked && (
        <path d={`M ${w * 0.25} ${h * 0.55} L ${w * 0.45} ${h * 0.75} L ${w * 0.78} ${h * 0.3}`} fill="none" stroke={C.bgCard} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </g>
  );
};

const toggleSwitch: Renderer = ({ w, h, variant, selected }) => {
  const on = variant === 'on';
  const stroke = selectStroke(selected, on ? C.accent : C.border);
  const sw = selectWidth(selected, 1.5);
  const knobR = h / 2 - 2;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={h / 2} fill={on ? C.accent : C.bgSubtle} stroke={stroke} strokeWidth={sw} />
      <circle cx={on ? w - h / 2 : h / 2} cy={h / 2} r={knobR} fill={C.bgCard} />
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Buttons
// ──────────────────────────────────────────────────────────────────

function buttonBase(fill: string, textColor: string, borderColor: string): Renderer {
  return ({ w, h, label, variant, selected }) => {
    // v1.61 — active = 약간 어두운 톤, disabled = opacity. 색 의미(action) 유지.
    let actualFill = fill;
    const actualText = textColor;
    let opacity = 1;
    if (variant === 'disabled') {
      opacity = 0.5;
    } else if (variant === 'active') {
      // 보라 액션 버튼 active = 살짝 어둡게(#8B6BE0). secondary 는 미세 톤 변경.
      actualFill = fill === C.action ? '#8B6BE0' : fill === C.result ? '#00C58A' : 'rgba(255,255,255,0.08)';
    }
    const stroke = selectStroke(selected, borderColor);
    const sw = selectWidth(selected, borderColor === 'none' ? 0 : 1);
    return (
      <g opacity={opacity}>
        <rect x={0} y={0} width={w} height={h} rx={Math.min(6, h / 4)} fill={actualFill} stroke={stroke === 'none' ? undefined : stroke} strokeWidth={sw} />
        {label && (
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize={Math.min(11, h * 0.4)} fill={actualText} fontWeight={500}>
            {label.slice(0, Math.floor(w / 6))}
          </text>
        )}
      </g>
    );
  };
}

// v1.61 — primary = action(보라), text = bgOuter(거의 검정, 보라 위 대비 OK)
const buttonPrimary = buttonBase(C.action, C.bgOuter, 'none');
// secondary = bgDemo(어둡), text = text(밝음), border = subtle
const buttonSecondary = buttonBase(C.bgDemo, C.text, C.border);
// danger 는 신호용 단일 케이스. 의미 컬러 시스템 외라 traffic red 차용.
const buttonDanger = buttonBase(C.trafficR, C.bgOuter, 'none');

const iconButton: Renderer = ({ w, h, label, variant, selected }) => {
  const isCircle = variant !== 'square';
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  return (
    <g>
      {isCircle ? (
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 1} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      ) : (
        <rect x={0} y={0} width={w} height={h} rx={4} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
      )}
      {label && (
        <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize={Math.min(12, h * 0.5)} fill={C.text} fontWeight={500}>
          {label.slice(0, 2)}
        </text>
      )}
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Actors
// ──────────────────────────────────────────────────────────────────

const userAvatar: Renderer = ({ w, h, label, variant, selected }) => {
  // v1.61 — 사용자는 시각적으로 중립(흰 톤). Agent 만 보라.
  const active = variant === 'active' || selected;
  const ringColor = 'rgba(255,255,255,0.18)';
  const ringWidth = active ? 2 : 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 2;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={C.bgSubtle} stroke={ringColor} strokeWidth={ringWidth} />
      {/* head + shoulders silhouette */}
      <circle cx={cx} cy={cy - r * 0.25} r={r * 0.3} fill="none" stroke={C.text} strokeWidth={1.4} />
      <path d={`M ${cx - r * 0.55} ${cy + r * 0.7} Q ${cx} ${cy + r * 0.15} ${cx + r * 0.55} ${cy + r * 0.7}`} fill="none" stroke={C.text} strokeWidth={1.4} strokeLinecap="round" />
      {label && (
        <text x={cx} y={h + 10} textAnchor="middle" fontSize={9} fill={C.text}>
          {label.slice(0, 12)}
        </text>
      )}
    </g>
  );
};

const agentAvatar: Renderer = ({ w, h, label, variant, selected }) => {
  // v1.61 — Agent = action(보라) hero. ring 은 항상 점선, 채움은 accentBg (rgba(보라,0.15)).
  const isActive = variant === 'active' || selected;
  const ringColor = C.action;
  const fillColor = C.accentBg;
  const ringWidth = isActive ? 2 : 1.5;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 2;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fillColor} stroke={ringColor} strokeWidth={ringWidth} strokeDasharray="3 3" />
      {/* sparkle (Lucide style 4-pt) inside, action 컬러 */}
      <g stroke={C.action} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d={`M ${cx} ${cy - r * 0.55} L ${cx} ${cy - r * 0.3}`} />
        <path d={`M ${cx} ${cy + r * 0.3} L ${cx} ${cy + r * 0.55}`} />
        <path d={`M ${cx - r * 0.55} ${cy} L ${cx - r * 0.3} ${cy}`} />
        <path d={`M ${cx + r * 0.3} ${cy} L ${cx + r * 0.55} ${cy}`} />
        <circle cx={cx} cy={cy} r={r * 0.2} fill={C.action} stroke="none" />
      </g>
      {label && (
        <text x={cx} y={h + 10} textAnchor="middle" fontSize={9} fill={C.action} fontWeight={500}>
          {label.slice(0, 12)}
        </text>
      )}
    </g>
  );
};

const cursorPointer: Renderer = ({ w, h, selected }) => {
  const fill = selected ? C.accent : C.text;
  return (
    <g>
      <path
        d={`M 0 0 L 0 ${h * 0.75} L ${w * 0.25} ${h * 0.55} L ${w * 0.45} ${h} L ${w * 0.6} ${h * 0.9} L ${w * 0.4} ${h * 0.5} L ${w * 0.75} ${h * 0.45} Z`}
        fill={fill}
        stroke={C.bgCard}
        strokeWidth={0.8}
      />
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Content Blocks
// ──────────────────────────────────────────────────────────────────

const codeBlock: Renderer = ({ w, h, label, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  const gutterW = 14;
  const lineCount = Math.max(3, Math.floor(h / 11));
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.bgSubtle} stroke={stroke} strokeWidth={sw} />
      <rect x={0} y={0} width={gutterW} height={h} fill="#e5e7eb" stroke="none" />
      {Array.from({ length: lineCount }).map((_, i) => (
        <text key={i} x={gutterW / 2} y={11 + i * 11} textAnchor="middle" fontSize={7} fill={C.textPlaceholder}>
          {i + 1}
        </text>
      ))}
      {label && (
        <text x={gutterW + 6} y={13} fontSize={9} fill={C.text} fontFamily="monospace">
          {label.slice(0, Math.floor((w - gutterW) / 5))}
        </text>
      )}
      {Array.from({ length: Math.max(0, lineCount - 1) }).map((_, i) => {
        const lineW = (w - gutterW - 12) * (0.4 + (i % 3) * 0.2);
        return <rect key={i} x={gutterW + 6} y={20 + i * 11} width={lineW} height={2} rx={1} fill={C.textPlaceholder} opacity={0.4} />;
      })}
    </g>
  );
};

const terminal: Renderer = ({ w, h, label, selected }) => {
  const stroke = selectStroke(selected, '#1e293b');
  const sw = selectWidth(selected, 1.5);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.terminalBg} stroke={stroke} strokeWidth={sw} />
      <text x={6} y={13} fontSize={9} fill={C.terminalPrompt} fontFamily="monospace">$</text>
      {label && (
        <text x={16} y={13} fontSize={9} fill={C.terminalText} fontFamily="monospace">
          {label.slice(0, Math.floor((w - 16) / 5))}
        </text>
      )}
      {/* output lines */}
      {[0.35, 0.5, 0.65, 0.8].map((p, i) => (
        <rect key={i} x={6} y={h * p} width={(w - 12) * (0.5 + (i % 2) * 0.3)} height={2} rx={1} fill={C.terminalText} opacity={0.4} />
      ))}
    </g>
  );
};

const fileCard: Renderer = ({ w, h, label, variant, selected }) => {
  const isFolder = variant === 'folder';
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1.5);
  const cornerSize = 10;
  return (
    <g>
      {isFolder ? (
        <g>
          <path d={`M 0 ${h * 0.2} L ${w * 0.35} ${h * 0.2} L ${w * 0.45} ${h * 0.32} L ${w} ${h * 0.32} L ${w} ${h} L 0 ${h} Z`} fill={C.bgSubtle} stroke={stroke} strokeWidth={sw} />
        </g>
      ) : (
        <g>
          <path d={`M 0 0 L ${w - cornerSize} 0 L ${w} ${cornerSize} L ${w} ${h} L 0 ${h} Z`} fill={C.bgCard} stroke={stroke} strokeWidth={sw} />
          <path d={`M ${w - cornerSize} 0 L ${w - cornerSize} ${cornerSize} L ${w} ${cornerSize}`} fill="none" stroke={stroke} strokeWidth={sw} />
        </g>
      )}
      {label && (
        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize={9} fill={C.text}>
          {label.slice(0, Math.floor(w / 5))}
        </text>
      )}
    </g>
  );
};

const chatBubble: Renderer = ({ w, h, label, variant, selected }) => {
  const isUser = variant === 'user';
  const fill = isUser ? C.accent : C.bgCard;
  const textColor = isUser ? C.bgCard : C.text;
  const stroke = selectStroke(selected, isUser ? 'none' : C.border);
  const sw = selectWidth(selected, isUser ? 0 : 1.5);
  const r = Math.min(10, h / 2);
  // tail
  const tailX = isUser ? w - 4 : 4;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={r} fill={fill} stroke={stroke === 'none' ? undefined : stroke} strokeWidth={sw} />
      <path d={isUser ? `M ${tailX} ${h - 4} L ${w + 5} ${h + 2} L ${tailX - 4} ${h}` : `M ${tailX} ${h - 4} L -5 ${h + 2} L ${tailX + 4} ${h}`} fill={fill} stroke="none" />
      {label && (
        <text x={w / 2} y={h / 2 + 3} textAnchor="middle" fontSize={9} fill={textColor}>
          {label.slice(0, Math.floor(w / 5))}
        </text>
      )}
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Indicators
// ──────────────────────────────────────────────────────────────────

const arrow: Renderer = ({ w, h, label, variant, selected }) => {
  const stroke = selectStroke(selected, C.textSecondary);
  const sw = selectWidth(selected, 1.5);
  let path = '';
  const cy = h / 2;
  switch (variant) {
    case 'down':
      path = `M ${w / 2} 0 L ${w / 2} ${h - 4} M ${w / 2 - 4} ${h - 8} L ${w / 2} ${h - 4} L ${w / 2 + 4} ${h - 8}`;
      break;
    case 'left':
      path = `M ${w} ${cy} L 4 ${cy} M 8 ${cy - 4} L 4 ${cy} L 8 ${cy + 4}`;
      break;
    case 'up':
      path = `M ${w / 2} ${h} L ${w / 2} 4 M ${w / 2 - 4} 8 L ${w / 2} 4 L ${w / 2 + 4} 8`;
      break;
    case 'curved-right':
      path = `M 0 ${h - 4} Q ${w / 2} ${h - 4} ${w / 2} ${cy} T ${w - 4} 4 M ${w - 8} 0 L ${w - 4} 4 L ${w - 8} 8`;
      break;
    case 'right':
    default:
      path = `M 0 ${cy} L ${w - 4} ${cy} M ${w - 8} ${cy - 4} L ${w - 4} ${cy} L ${w - 8} ${cy + 4}`;
  }
  return (
    <g>
      <path d={path} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      {label && (
        <text x={w / 2} y={cy - 6} textAnchor="middle" fontSize={9} fill={C.textSecondary}>
          {label.slice(0, 16)}
        </text>
      )}
    </g>
  );
};

const checkmark: Renderer = ({ w, h, selected }) => {
  const stroke = selectStroke(selected, C.success);
  const sw = selectWidth(selected, 2);
  return (
    <g>
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 1} fill="none" stroke={stroke} strokeWidth={sw} />
      <path d={`M ${w * 0.28} ${h * 0.52} L ${w * 0.45} ${h * 0.7} L ${w * 0.72} ${h * 0.32}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
};

const xMark: Renderer = ({ w, h, selected }) => {
  const stroke = selectStroke(selected, C.danger);
  const sw = selectWidth(selected, 2);
  return (
    <g>
      <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 1} fill="none" stroke={stroke} strokeWidth={sw} />
      <path d={`M ${w * 0.3} ${h * 0.3} L ${w * 0.7} ${h * 0.7} M ${w * 0.7} ${h * 0.3} L ${w * 0.3} ${h * 0.7}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </g>
  );
};

const spinner: Renderer = ({ w, h, selected }) => {
  const fill = selected ? C.accent : C.textSecondary;
  const cy = h / 2;
  const r = Math.min(w, h) / 10;
  return (
    <g>
      <circle cx={w * 0.2} cy={cy} r={r} fill={fill} opacity={0.4} />
      <circle cx={w * 0.5} cy={cy} r={r} fill={fill} opacity={0.7} />
      <circle cx={w * 0.8} cy={cy} r={r} fill={fill} opacity={1} />
    </g>
  );
};

const progressBar: Renderer = ({ w, h, variant, selected }) => {
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1);
  const map: Record<string, number> = { p25: 0.25, p50: 0.5, p75: 0.75, p100: 1 };
  const ratio = map[variant ?? 'p50'] ?? 0.5;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={h / 2} fill={C.bgSubtle} stroke={stroke} strokeWidth={sw} />
      <rect x={1} y={1} width={(w - 2) * ratio} height={h - 2} rx={(h - 2) / 2} fill={C.accent} stroke="none" />
    </g>
  );
};

const badgePill: Renderer = ({ w, h, label, selected }) => {
  const fill = selected ? C.accentBg : C.bgSubtle;
  const stroke = selectStroke(selected, C.border);
  const sw = selectWidth(selected, 1);
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
      {label && (
        <text x={w / 2} y={h / 2 + 3} textAnchor="middle" fontSize={Math.min(9, h * 0.55)} fill={selected ? '#1e40af' : C.textSecondary} fontWeight={500}>
          {label.slice(0, Math.floor(w / 5))}
        </text>
      )}
    </g>
  );
};

// ──────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────

const RENDERERS: Record<string, Renderer> = {
  'browser-window': browserWindow,
  'app-window': appWindow,
  'modal-dialog': modalDialog,
  'side-panel': sidePanel,
  'card': card,
  'text-input': textInput,
  'textarea': textarea,
  'dropdown': dropdown,
  'checkbox': checkbox,
  'toggle-switch': toggleSwitch,
  'button-primary': buttonPrimary,
  'button-secondary': buttonSecondary,
  'button-danger': buttonDanger,
  'icon-button': iconButton,
  'user-avatar': userAvatar,
  'agent-avatar': agentAvatar,
  'cursor-pointer': cursorPointer,
  'code-block': codeBlock,
  'terminal': terminal,
  'file-card': fileCard,
  'chat-bubble': chatBubble,
  'arrow': arrow,
  'checkmark': checkmark,
  'x-mark': xMark,
  'spinner': spinner,
  'progress-bar': progressBar,
  'badge-pill': badgePill,
};

/**
 * stampName 으로 prebuilt SVG 를 렌더. 알 수 없는 이름은 회색 placeholder 박스.
 * (서버 coerce 가 카탈로그 검증을 이미 하지만, 구버전 체크포인트 로드 등 방어).
 */
export function StampSvg({
  stampName,
  x,
  y,
  w,
  h,
  label,
  variant,
  selected,
  onClick,
}: {
  stampName: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label?: string;
  variant?: string;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}): JSX.Element {
  const spec = STAMP_CATALOG[stampName as keyof typeof STAMP_CATALOG];
  // v1.62 — defensive: NaN/undefined 가 흘러와도 SVG 좌표 깨지지 않게 클램프 (≥ 1px).
  const wRaw = typeof w === 'number' && Number.isFinite(w) ? w : (spec?.defaultW ?? 60);
  const hRaw = typeof h === 'number' && Number.isFinite(h) ? h : (spec?.defaultH ?? 40);
  const actualW = Math.max(1, wRaw);
  const actualH = Math.max(1, hRaw);
  const safeX = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  const safeY = typeof y === 'number' && Number.isFinite(y) ? y : 0;
  const render = RENDERERS[stampName];
  return (
    <g transform={`translate(${safeX}, ${safeY})`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {render ? (
        render({ w: actualW, h: actualH, label, variant, selected })
      ) : (
        <g>
          <rect x={0} y={0} width={actualW} height={actualH} rx={3} fill={C.bgSubtle} stroke={C.danger} strokeWidth={1.5} strokeDasharray="3 2" />
          <text x={actualW / 2} y={actualH / 2 + 3} textAnchor="middle" fontSize={9} fill={C.danger}>
            ?{stampName.slice(0, 18)}
          </text>
        </g>
      )}
    </g>
  );
}
