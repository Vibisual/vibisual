import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, BubbleStyleConfig } from '@vibisual/shared';
import { BUBBLE_STYLES, HOOK_AGENT_STYLE, BUBBLE_TEXT_WIDTH_RATIO, BUBBLE_TEXT_REF_SIZE, GIT_STATUS_CONFIG, LINK_FOCUS, agentModelLabelOf } from '@vibisual/shared';
import { externalPlaceHint, formatHeatCount, heatColor, heatRatio, heatValueOf, isHeatBubbleType } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { useHeatScale } from '../../hooks/useHeatScale.js';
import { useGraphStore, selectIDEActiveSessionForAgent, selectSpecStaleTitle } from '../../stores/graphStore.js';
import { isAgentDormant } from '../../utils/sessionStatus.js';
// §5.4 #34 — 우클릭 메뉴는 캔버스가 그린다(원형 버블 안에서 그리면 잘린다). 여기서는 요청만 낸다.
import { BUBBLE_MENU_EVENT, type BubbleMenuRequest } from './BubbleContextMenu.js';
import { PluginBubbleBadgeSlot } from '../../plugins/host.js';
// §5.19 (G) — 로컬 버블 정체 판정은 패널과 **같은 함수**를 쓴다(두 화면이 어긋나지 않게).
import { localProviderOf, localModelLabelOf } from '../LocalModel/localModelEntry.js';
import { codexProviderOf, codexModelLabelOf } from '../Codex/codexModelEntry.js';
// §2.4 버블 타이포 오토핏 — 하단 블록 예약·요약·현(chord) 폭 계산은 전부 이 순수 모듈이 한다.
import { planBubbleText, BUBBLE_LINE_HEIGHT, type BubbleBottomLine, type BubbleCenterExtra } from './bubbleTextFit.js';
// 클릭=선택 / 더블클릭=열기 를 가르는 상태기계는 캔버스 **공용 한 벌**이다 — 이 버블이 그 기준이고,
// 앱·캡처·스펙·랩·선반·플레이·메모 버블이 같은 것을 쓴다(따로 두면 손버릇이 갈린다).
import { SELECT_DEFER_MS, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { shouldDismissOnSelect } from './agentDismiss.js';
// §5.4 #31 — Ctrl/Cmd 를 쥔 채 에이전트를 잡으면 그 무리만 남고 나머지는 뒤로 물러난다.
import { useLinkRole, useLinkFocusStore, promoteLinkGrab, releaseLinkGrab } from '../../stores/linkFocus.js';
import { linkFocusNodeStyle } from './linkedBubbles.js';
import { BRAND_ICON_PATHS } from './brandIconPaths.js';

type BubbleNodeData = BubbleData & Record<string, unknown>;

interface BubbleNodeComponentProps {
  data: BubbleNodeData;
  id: string;
  [key: string]: unknown;
}

// ─── 아이콘 SVG paths — config의 icon 필드로 선택 ───

type BubbleIconKind = BubbleStyleConfig['icon'] | 'claude' | 'codex';

const ICON_PATHS: Record<BubbleIconKind, { viewBox: string; d: string; fill: boolean }> = {
  codex: {
    viewBox: '0 0 24 24',
    d: BRAND_ICON_PATHS.codex,
    fill: true,
  },
  claude: {
    viewBox: '0 0 24 24',
    d: BRAND_ICON_PATHS.claude,
    fill: true,
  },
  agent: {
    viewBox: '0 0 24 24',
    d: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4',
    fill: false,
  },
  folder: {
    viewBox: '0 0 24 24',
    d: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z',
    fill: true,
  },
  file: {
    viewBox: '0 0 24 24',
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6',
    fill: true,
  },
  terminal: {
    viewBox: '0 0 24 24',
    d: 'M4 17l6-5-6-5m8 10h8',
    fill: false,
  },
  root: {
    viewBox: '0 0 24 24',
    d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z M9 22V12h6v10',
    fill: true,
  },
  ghost: {
    viewBox: '0 0 24 24',
    d: 'M12 2C6.48 2 2 6.48 2 12v8c0 1.1.9 2 2 2h1.5c.83 0 1.5-.67 1.5-1.5S6.33 19 7.5 19s1.5.67 1.5 1.5S9.83 22 11 22h2c1.17 0 1.5-.67 1.5-1.5S15.17 19 16.5 19s1.5.67 1.5 1.5.67 1.5 1.5 1.5H22c1.1 0 2-.9 2-2v-8c0-5.52-4.48-10-10-10z M9 14a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z M15 14a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    fill: true,
  },
  iframe: {
    viewBox: '0 0 24 24',
    d: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM4 12c0-.93.16-1.82.46-2.65L8 12.83V14a2 2 0 0 0 2 2v3.73A8.01 8.01 0 0 1 4 12zm14.54 3.35A2 2 0 0 0 17 14h-1v-3a1 1 0 0 0-1-1H9V8h2a1 1 0 0 0 1-1V5.08A7.97 7.97 0 0 1 20 12c0 1.2-.27 2.34-.74 3.35z',
    fill: true,
  },
  pipeline: {
    viewBox: '0 0 24 24',
    d: 'M7 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 23a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 10.5l4-3M10 13.5l4 3',
    fill: false,
  },
  back: {
    viewBox: '0 0 24 24',
    d: 'M15 18l-6-6 6-6',
    fill: false,
  },
  // §5.3 #28 v1.47 — 콘티(스토리보드) 4 frame 격자 아이콘
  conti: {
    viewBox: '0 0 24 24',
    d: 'M3 4h7v7H3zM14 4h7v7h-7zM3 13h7v7H3zM14 13h7v7h-7z',
    fill: false,
  },
  // Auto Agent (메타 에이전트) — 별 + 작은 회전 점 (병행 작업 stub)
  auto: {
    viewBox: '0 0 24 24',
    d: 'M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z M19 16l.7 1.8L21.5 19l-1.8.7L19 22l-.7-1.8L16.5 19l1.8-.7L19 16z',
    fill: false,
  },
  // §5.10 — 커스텀 에이전트 휴지통 버블(trash-2)
  trash: {
    viewBox: '0 0 24 24',
    d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6',
    fill: false,
  },
  // §5.15 — 스펙 보드. 체크가 든 문서(요구사항 + 수용 기준).
  spec: {
    viewBox: '0 0 24 24',
    d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8.5 13.5l1.5 1.5 3-3M8.5 18h7',
    fill: false,
  },
  // §5.18 — 에이전트 랩. 플라스크(같은 과제를 여러 벌 태워 비교한다).
  lab: {
    viewBox: '0 0 24 24',
    d: 'M10 2v6.5L4.8 17.4A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3.1L14 8.5V2M9 2h6M7.5 14h9',
    fill: false,
  },
  // §5.20 — 스크립트 선반. 칸이 나뉜 선반 옆모습.
  shelf: {
    viewBox: '0 0 24 24',
    d: 'M3 4h18M3 12h18M3 20h18M6 4v8M18 12v8',
    fill: false,
  },
  // §5.13 v4.45 — Vibistudio 영상 문서. 재생 삼각형이 든 화면.
  video: {
    viewBox: '0 0 24 24',
    d: 'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm8 3 5 3-5 3V9z',
    fill: false,
  },
  // §5.23 — 도메인 버블. 경선·위선이 그려진 지구(lucide `globe`).
  globe: {
    viewBox: '0 0 24 24',
    d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
    fill: false,
  },
};

/** claude·codex 는 우리가 그린 lucide 톤 글리프가 아니라 **브랜드 로고**다(속이 꽉 찬 그림). */
function isBrandIcon(icon: BubbleIconKind): boolean {
  return icon === 'claude' || icon === 'codex';
}

/**
 * 브랜드 로고는 선으로 그린 아이콘과 시각 무게가 다르다 — 같은 px·같은 흰색이면 혼자 한 덩어리로
 * 튀어 버블의 주인공(라벨)을 눌러 버린다. 그래서 두 곳을 낮춘다.
 *
 * - 크기: 선 아이콘의 0.74 배. 채워진 그림은 같은 변 길이에서 훨씬 넓은 면적을 먹는다.
 * - 농도: 선 아이콘의 채움(0.3 + 또렷한 윤곽)과 라벨(흰색)의 **사이**. 브랜드 로고는 윤곽선을
 *   씌우면 얇은 갈래가 뭉개지므로 stroke 대신 채움 농도만 내려 버블 그라디언트가 비쳐 보이게 한다.
 */
const BRAND_ICON_SCALE = 0.74;
const BRAND_ICON_FILL_OPACITY = 0.55;

function BubbleIcon({ icon, px }: { icon: BubbleIconKind; px?: number }): React.JSX.Element {
  const cfg = ICON_PATHS[icon];
  const s = px ?? 20;
  if (isBrandIcon(icon)) {
    return (
      <svg width={s} height={s} viewBox={cfg.viewBox} fill="white" fillOpacity={BRAND_ICON_FILL_OPACITY} fillRule="evenodd" aria-hidden="true" className="shrink-0">
        <path d={cfg.d} />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox={cfg.viewBox} fill={cfg.fill ? 'white' : 'none'} fillOpacity={cfg.fill ? 0.3 : undefined} stroke="white" strokeWidth={cfg.fill ? 1.5 : 2}>
      <path d={cfg.d} />
    </svg>
  );
}

// ─── 컨텍스트 표시 유틸 ───

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatModelName(model: string): string {
  // "claude-opus-4-6" → "opus-4-6", "claude-sonnet-4-5-20250414" → "sonnet-4-5"
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
}

// ─── 물결 채움 SVG — 컨텍스트 비율로 높이 결정 ───

// (§5.7 #26 에서 `indeterminate` 모드 제거 — 수위가 위아래로 진동하던 "작업 중" 물결은 워크트리
//  생성 연출 전용이었고, 그 연출 자체가 폐기됐다. 여기 남은 물결은 **실측 컨텍스트 비율**뿐이다.)
function WaveFill({ ratio, color }: { ratio: number; color: string }): React.JSX.Element {
  // ratio 0~1 → 물 높이 (0 = 바닥, 1 = 꼭대기)
  const clamped = Math.max(0, Math.min(1, ratio));
  // SVG viewBox 100x100, 물결 y위치: 100(빈) → 0(가득)
  const baseY = 100 - clamped * 100;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <clipPath id="wave-clip">
          <circle cx="50" cy="50" r="49" />
        </clipPath>
      </defs>
      <g clipPath="url(#wave-clip)">
        {/* 뒤쪽 물결 (느린 반투명) */}
        <path opacity={0.3} fill={color}>
          <animate
            attributeName="d"
            dur="4s"
            repeatCount="indefinite"
            values={`
              M0 ${baseY + 4} Q15 ${baseY - 3} 30 ${baseY + 4} T60 ${baseY + 4} T90 ${baseY + 4} T120 ${baseY + 4} V100 H0 Z;
              M0 ${baseY - 2} Q15 ${baseY + 5} 30 ${baseY - 2} T60 ${baseY - 2} T90 ${baseY - 2} T120 ${baseY - 2} V100 H0 Z;
              M0 ${baseY + 4} Q15 ${baseY - 3} 30 ${baseY + 4} T60 ${baseY + 4} T90 ${baseY + 4} T120 ${baseY + 4} V100 H0 Z
            `}
          />
        </path>
        {/* 앞쪽 물결 (메인) */}
        <path opacity={0.45} fill={color}>
          <animate
            attributeName="d"
            dur="3s"
            repeatCount="indefinite"
            values={`
              M0 ${baseY + 2} Q12 ${baseY - 4} 25 ${baseY + 2} T50 ${baseY + 2} T75 ${baseY + 2} T100 ${baseY + 2} V100 H0 Z;
              M0 ${baseY - 3} Q12 ${baseY + 4} 25 ${baseY - 3} T50 ${baseY - 3} T75 ${baseY - 3} T100 ${baseY - 3} V100 H0 Z;
              M0 ${baseY + 2} Q12 ${baseY - 4} 25 ${baseY + 2} T50 ${baseY + 2} T75 ${baseY + 2} T100 ${baseY + 2} V100 H0 Z
            `}
          />
        </path>
      </g>
    </svg>
  );
}

// ─── 핸들 스타일 (중심 1개 — CurvedEdge가 원 둘레 계산) ───

const HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

// 테두리 근접 판정 — 반지름 비율을 기본으로 하되 화면px 상/하한으로 클램프
// - 줌아웃(버블 작음): MIN으로 중심 클릭 영역 확보
// - 줌인(버블 큼): MAX로 테두리 띠가 과하게 두꺼워지지 않도록 제한
const BORDER_HIT_RATIO = 0.22;
const BORDER_HIT_MIN = 5;
const BORDER_HIT_MAX = 20;
/** 테두리 하이라이트 반응까지 머물러야 하는 시간 (ms) — 스쳐 지나갈 때 깜빡임 방지 */
const BORDER_HOVER_DELAY_MS = 300;
/** 선택 하이라이트 퇴장 페이드 길이 (ms) — 언마운트 타이밍도 이 값 */
const SELECT_FADE_MS = 240;
/** 등장 페이드는 ~30% 빠르게 (반응성) */
const SELECT_FADE_IN_MS = 170;

/** §5.10 — 우측 더블클릭(기억 내부 진입) 판정 창(ms). 우클릭 컨텍스트 메뉴와 겹치지 않게. */
const RIGHT_DBLCLICK_MS = 350;

/**
 * §5.10 v3.82 — 주입 연출(림 아크 스윕 + 블룸)이 살아 있는 시간(ms).
 * 두 애니메이션 중 긴 쪽(bloom 1.35s)보다 약간 길게 잡아, 끝난 뒤에도 남아 도는
 * 빈 엘리먼트 없이 정확히 한 번만 재생되고 언마운트되게 한다(종전 4000ms 는
 * `animate-ping` 무한 반복을 시간으로 끊던 값이라 1회 연출엔 과했다).
 */

/** §5.10 v3.82 — 주입 아크가 테두리 바깥을 돌 때 stroke 가 잘리지 않도록 두는 여백(px). */
/**
 * §5.10 — 이 버블의 우측 더블클릭 대상. null 이면 대상 아님.
 *
 * 종전에는 메모리 버블·커스텀 에이전트가 기억 피드 오버레이를 열었으나 그 축이 폐기돼
 * **휴지통 하나만** 남았다. 남은 제스처는 "안으로 들어간다" 한 뜻이다.
 */
type RightDblTarget = { kind: 'trash' };
function interiorTargetFor(data: BubbleData): RightDblTarget | null {
  if (data.id === '__trash__') return { kind: 'trash' };
  return null;
}

// ─── 컴포넌트 ───

export const BubbleNode = memo(function BubbleNode({
  data,
  id: nodeId,
  ...rest
}: BubbleNodeComponentProps): React.JSX.Element {
  const { t } = useTranslation();
  // React Flow v12: positionAbsoluteX/Y로 전달
  const xPos = (rest['positionAbsoluteX'] ?? rest['xPos']) as number | undefined;
  const yPos = (rest['positionAbsoluteY'] ?? rest['yPos']) as number | undefined;
  // §2.2 v2.67 (C안) — Hook 에이전트(외부 캡처, customCreated=false)는 Custom/CMD(#3B82F6)와 같은 파랑
  //   계열의 더 어둡고 탁한 톤(HOOK_AGENT_STYLE=#1E3A6B)으로 명도만 구분. bubbleType 은 그대로 'agent'.
  const isHookAgent = data.bubbleType === 'agent' && !data.customCreated;
  const baseStyle = isHookAgent ? HOOK_AGENT_STYLE : BUBBLE_STYLES[data.bubbleType];
  // 에이전트 커스텀 색상 — AgentConfig.color가 있으면 기본 스타일 오버라이드
  const customColor = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.color : undefined);
  // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트면 라벨 옆 'CMD' 배지로 구분.
  const isCmdAgent = useGraphStore((s) => data.bubbleType === 'agent' && s.agentConfigs[data.id]?.executionMode === 'interactive-terminal');
  // §2.4 v1.67 — 갓 스폰된 커스텀 에이전트 idle empty-state: 라이브 세션 전 빈 하단을 설정 모델명으로 메움.
  // §5.25 (J) — 주어는 `config.model` 하나가 아니라 **모델 칸 + 엔진 축** 둘이다(엔진을 안 보면
  //   코덱스 버블이 클로드 기본값 `opus` 를 자기 이름으로 말한다). 판정은 `agentModelLabelOf` 가
  //   하고, 여기서는 그 둘을 **원시값으로** 집는다 — 객체를 새로 만들어 돌려주면 매 프레임 새
  //   참조라 무변화에도 리렌더가 돈다(파생 선택자 함정).
  const configModel = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.model : undefined);
  const configProviderKind = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.provider?.kind : undefined);
  const configProviderModelId = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.provider?.modelId : undefined);
  const configProviderModelName = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.provider?.modelName : undefined);
  const idleModelConfig = useMemo(
    () => (configProviderKind
      ? { model: configModel, provider: { kind: configProviderKind, modelId: configProviderModelId ?? '', modelName: configProviderModelName } }
      : { model: configModel }),
    [configModel, configProviderKind, configProviderModelId, configProviderModelName],
  );
  /**
   * §5.19 (G) — All Model(로컬 LLM) 버블의 정체. 있으면 아래 모델·문맥·토큰 세 줄이 진실을
   * 가져올 곳은 클로드 세션이 아니라 이 프로바이더다 — `config.model`(기본값 `opus`)은 로컬 턴이
   * 읽지도 않는 칸이라 그대로 적으면 버블이 자기 정체를 거짓으로 말한다.
   */
  const localProvider = useGraphStore((s) => (data.bubbleType === 'agent' ? localProviderOf(s.agentConfigs[data.id]) : null));
  /**
   * §5.25 (J) — 코덱스 버블의 정체. 로컬과 같은 이유로 따로 든다: `config.model`(기본값 `opus`)
   * 은 코덱스 턴이 읽지도 않는 칸이라, 그대로 적으면 코덱스 버블이 자기를 클로드로 말한다.
   *
   * **문맥 상한은 없다** — 코덱스는 왕복마다 쓴 양만 알려 주고 상한은 말해 주지 않는다.
   * 없는 값을 지어내면 물결이 거짓 비율로 찬다(§5.19 가 로컬에서 상한을 받아 쓴 것과 다른 자리).
   */
  const codexProvider = useGraphStore((s) => (data.bubbleType === 'agent' ? codexProviderOf(s.agentConfigs[data.id]) : null));
  const isCodexAgent = codexProvider !== null;
  // §5.11 v3.88 — 플러그인 배지 슬롯에 넘길 읽기 전용 설정. 에이전트 버블이 아니면 undefined 라 슬롯이 그냥 빈다.
  const pluginAgentConfig = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id] : undefined);
  /**
   * §5.15 — 이 에이전트 버블이 스펙에서 나온 작업 카드이고, 그 스펙이 카드 생성 이후
   * 바뀌었으면 스펙 제목을 돌려준다(아니면 null).
   *
   * 서버가 준 두 숫자(`bodyRevision` vs 항목의 `generatedRevision`)의 비교뿐이다 — 판정도
   * 자동 재생성도 하지 않는다(§5.15). 셀렉터가 **원시값**을 돌려주므로 스냅샷이 흘러도
   * 실제로 낡음 여부가 바뀔 때만 리렌더한다.
   */
  const specStaleTitle = useGraphStore((s) => (
    data.bubbleType === 'agent' ? selectSpecStaleTitle(s, data.id) : null
  ));
  // §5.10 — 휴지통 배지: 현재 프로젝트의 trashed 에이전트 수.
  //   store.agents 는 전 프로젝트 합본이라 여기서 세면 다른 프로젝트의 휴지통까지 합산된다(§3.5 프로젝트
  //   독립성 위반). 개수는 BubbleMap 이 프로젝트 필터를 거쳐 data.activity 로 실어 보낸다.
  const trashedCount = data.bubbleType === 'trash' ? data.activity : 0;
  const isTrashBubble = data.bubbleType === 'trash';
  // §5.24 — 히트맵 척도. 켜져 있고 이 버블이 "읽히는 것"일 때만 색·지름이 갈린다.
  const heat = useHeatScale();
  const heatOn = !!heat && isHeatBubbleType(data.bubbleType);
  const style = useMemo<BubbleStyleConfig>(() => {
    // 히트 재도색이 타입 색·사용자 지정 색보다 앞선다 — 모드를 켠 동안은 색이 "얼마나 읽혔나"를
    //   말하기 때문이다. 대상은 file/폴더/domain 넷뿐이고 에이전트는 애초에 대상이 아니라
    //   `AgentConfig.color` 오버라이드와 부딪히지 않는다.
    if (heatOn && heat) {
      const r = heatRatio(heatValueOf(data, heat.axis), heat);
      // 글로우는 한 단계 더 뜨겁게 — 본체와 같은 색이면 평평해 보인다.
      return { ...baseStyle, color: heatColor(r), glow: heatColor(Math.min(1, r + 0.25)) };
    }
    // Provider identity stays visible even when the agent has a custom body color.
    const providerStyle = isCodexAgent
      ? { ...baseStyle, color: '#8B5CF6', glow: '#C4B5FD',
          ringIdle: 'border-violet-300',
          ringActive: 'border-violet-400 shadow-lg shadow-violet-500/30' }
      : baseStyle;
    if (!customColor) return providerStyle;
    return { ...providerStyle, color: customColor, glow: customColor };
  }, [baseStyle, customColor, isCodexAgent, heatOn, heat,
    data.readCount, data.writeCount, data.externalRollupReadCount, data.externalRollupWriteCount]);
  /**
   * §5.24 — 히트 숫자 배지가 적을 값. **색·지름과 같은 `heatValueOf` 한 함수에서 나온다** —
   * §2.1 (A) 접합이 자손 합으로 뜨겁게 칠해졌는데 숫자만 자기 카운터(=0)를 적으면 한 버블이
   * 두 가지 말을 한다.
   */
  const heatBadge = useMemo(() => {
    if (!heatOn || !heat) return null;
    const value = heatValueOf(data, heat.axis);
    return {
      value,
      axis: heat.axis,
      label: formatHeatCount(value),
      ring: heatColor(heatRatio(value, heat)),
    };
  }, [heatOn, heat,
    data.readCount, data.writeCount, data.externalRollupReadCount, data.externalRollupWriteCount]);
  const localRange = (data as Record<string, unknown>)['_localRange'] as { min: number; max: number } | undefined;
  const globalRange = useGraphStore((s) => s.fileSizeRange);
  const range = localRange ?? globalRange;
  const size = useMemo(() => calcBubbleSize(data, range, heat), [data.activity, data.status, data.bubbleType, data.childCount, data.fileSize, data.readCount, data.writeCount, data.externalRollupReadCount, data.externalRollupWriteCount, range, heat]);
  // 단일 스케일 팩터 — 모든 텍스트/아이콘이 이 비율로 비례 축소/확대
  const ts = size / BUBBLE_TEXT_REF_SIZE;
  const isActive = data.status === 'active';
  const isCompleted = data.status === 'completed';
  // 소속 세션이 실패로 끝났다 — completed(시안)와 **같은 자리, 다른 색**으로 그린다.
  //   종전에는 이 상태가 completed 로 내려가 실패가 완료로 보였다.
  const isFailed = data.status === 'error';
  // §4 v1.49 — Notification 시각 신호 (permission 대기). v1.73 — awaiting_input(모래시계) 제거.
  const isAwaitingPermission = data.status === 'awaiting_permission';
  const isFolder = data.bubbleType === 'internal_folder' || data.bubbleType === 'external_folder';
  const isAgent = data.bubbleType === 'agent';
  const isGhost = data.bubbleType === 'ghost';
  const isIframe = data.bubbleType === 'iframe';
  const isRoot = data.bubbleType === 'root';
  // §5.5 #17-6 v2.73 — 오버레이 위젯 창 안에서 렌더되는 버블. 시각·드래그·더블클릭은 캔버스와 동일,
  // 단 "엣지 연결"(테두리 잡고 Task Edge 드래그)만 비활성(연결할 다른 버블이 없는 단독 위젯이라).
  const overlayMode = (data as Record<string, unknown>)['_overlayMode'] === true;
  const isBack = data.id === '__root_back__';
  // 더블클릭으로 동작이 있는 버블 — handleNodeDoubleClick(BubbleMap)과 1:1.
  // 이 버블들만 단일선택을 SELECT_DEFER_MS 만큼 늦춘다(나머지는 즉시 선택 유지).
  const isDoubleClickable =
    isAgent || isFolder || isIframe ||
    // §5.12 (A) v4.43 — 프로젝트 root(home) 더블클릭 = 지휘통제실 창.
    // 지휘통제실은 desktop 전용(IPC)이라, 열 수 없는 환경(dev/web·모바일)에서는 더블클릭 대상에서
    // 빼 root 싱글 클릭이 공짜로 SELECT_DEFER_MS 만큼 느려지지 않게 한다.
    (isRoot && typeof window !== 'undefined' && !!window.api?.command) ||
    data.bubbleType === 'worktree' ||
    data.bubbleType === 'pipeline' ||
    data.bubbleType === 'conti' ||
    data.bubbleType === 'trash' ||
    data.id.startsWith('sat-') ||
    data.id === '__root_home__' ||
    data.id === '__pipeline_parent__';
  const isDespawning = !!(data as Record<string, unknown>)._despawning;

  /**
   * §5.4 #31 연결 무리 강조 — 이 버블이 지금 잡힌 무리에서 맡은 자리.
   *
   * 구독하는 것은 **판정 결과 한 글자**다(§9 "버블은 자기 것만 구독한다"). 무리 객체를 구독하면
   * 무리가 바뀔 때마다 화면의 모든 버블이 깨어난다.
   */
  const linkRole = useLinkRole(data.id);
  const linkPhase = useLinkFocusStore((s) => s.phase);
  /**
   * Ctrl/Cmd 를 쥐고 있는 동안에는 테두리 연결 손짓(Task Edge)을 재운다 — 같은 테두리에서 두
   * 동작이 경합하면 "무리를 잡으려다 엣지가 그어지는" 일이 생긴다. 수식 키를 쥔 쪽이 명시적이라
   * 그쪽에 자리를 내준다.
   */
  const linkModifierHeld = useLinkFocusStore((s) => s.modifierHeld);
  const linkVisual = useMemo(() => linkFocusNodeStyle(linkRole, linkPhase), [linkRole, linkPhase]);

  // 선택 하이라이트 링 — store.selectIntentId(클릭 확정 즉시 갱신, DetailPanel 지연과 무관).
  // selectNode/setSelectIntent 는 'sat-' 프리픽스를 떼고 저장 → 동일 규칙으로 비교.
  const selectIntentId = useGraphStore((s) => s.selectIntentId);
  const showSelectRing = useMemo(() => {
    if (!selectIntentId) return false;
    const myId = data.id.startsWith('sat-') ? data.id.slice(4) : data.id;
    return selectIntentId === myId;
  }, [selectIntentId, data.id]);

  // 등장/퇴장 모두 페이드. showSelectRing off 시 즉시 언마운트하지 않고
  // opacity 0 으로 트랜지션 후 SELECT_FADE_MS 뒤 언마운트.
  const [selectRender, setSelectRender] = useState(false);
  const [selectShown, setSelectShown] = useState(false);
  const selectHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (showSelectRing) {
      if (selectHideTimer.current) { clearTimeout(selectHideTimer.current); selectHideTimer.current = null; }
      setSelectRender(true);
      // 더블 rAF — opacity:0 프레임이 실제로 페인트된 뒤에 1 로 올려야
      // 트랜지션이 걸린다(단일 rAF 면 같은 커밋에 합쳐져 즉시 등장).
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setSelectShown(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setSelectShown(false); // opacity 1 → 0 페이드아웃
    selectHideTimer.current = setTimeout(() => {
      setSelectRender(false);
      selectHideTimer.current = null;
    }, SELECT_FADE_MS);
    return undefined;
  }, [showSelectRing]);
  useEffect(() => () => {
    if (selectHideTimer.current) clearTimeout(selectHideTimer.current);
  }, []);

  // 커스텀 에이전트: 표시할 "effective sub" 결정.
  // 우선순위: (1) 현재 active 인 sub → (2) IDE 오버레이에서 사용자가 선택한 탭 → (3) 서버가 준 default(가장 최근).
  //  - (1) 이 있으면 동작중 컨텍스트를 실시간 반영
  //  - 없으면 사용자가 IDE 에서 골라본 sub 로 전환(요구사항: "동작중인게 없을 경우 그 선택한거로 변경")
  // §5.3 #12-1 — 백단 작업 중임을 말하는 것은 **기존 동작중 이펙트 하나**다(별도 색·배지 ❌).
  //   서버가 그동안 버블을 `active` 로 유지하므로 위 `isActive` 경로가 그대로 그 일을 한다.
  // §9 — **자기 것만 구독한다.** 종전엔 `s.subAgents` 맵 통째였다: `loadSnapshot` 의 구조적 공유가
  //   에이전트 하나의 배열만 새것으로 바꿔도 **맵 자체는 새 참조**가 되므로, 어느 에이전트 하나가
  //   한 줄을 뱉을 때마다 화면의 **모든 버블**이 리렌더됐다(버블 200개면 200벌). 키 하나만 보면
  //   구조적 공유가 준 배열 참조가 그대로라 바뀐 그 버블만 깨어난다.
  const mySubAgents = useGraphStore((s) => s.subAgents[data.id]);
  // §5.5 #17-1 — 창이 여럿이므로 "IDE 의 활성 세션"이 아니라 **이 버블을 띄운 창의** 활성 세션을 본다.
  const ideActiveSessionId = useGraphStore((s) => selectIDEActiveSessionForAgent(s, data.id));
  const stickySelectedSubId = useGraphStore((s) => s.selectedSubByAgent[data.id]);
  // §2.4 (잠듦) — 서버가 유휴로 판정해 이 에이전트의 claude 자식 프로세스를 회수해 둔 상태.
  //   세션이 여럿이면 전부 잠들었을 때만 잠든 것이다(하나라도 자식을 들고 있으면 아니다).
  const isDormant = useMemo(
    () => isAgentDormant(isAgent ? mySubAgents : undefined),
    [isAgent, mySubAgents],
  );
  const effectiveSubOverride = useMemo(() => {
    if (!isAgent || !data.customCreated) return null;
    const subs = mySubAgents;
    if (!subs || subs.length === 0) return null;
    const activeSub = subs.find((s) => s.status === 'active');
    if (activeSub) return activeSub;
    // IDE 오버레이가 열려 있고 탭이 선택돼 있으면 그걸 우선 (실시간 클릭 반응)
    if (ideActiveSessionId) {
      const selected = subs.find((s) => s.id === ideActiveSessionId);
      if (selected) return selected;
    }
    // IDE 닫혀도 sticky 선택 유지
    if (stickySelectedSubId) {
      const selected = subs.find((s) => s.id === stickySelectedSubId);
      if (selected) return selected;
    }
    return null; // 서버 default 유지
  }, [isAgent, data.customCreated, mySubAgents, ideActiveSessionId, stickySelectedSubId]);

  // override 가 "있으면" 그 sub 기준으로만 일관되게 표기한다.
  // 부분 폴백(모델명만 override, 컨텍스트는 data.* 폴백)을 허용하면 라벨은 #16 인데 게이지는
  // 서버 default(최근 sub)가 그대로 남아 불일치가 발생한다 — 요구사항 위반.
  const effectiveModelName = effectiveSubOverride
    ? effectiveSubOverride.modelName
    : data.modelName;
  /**
   * §5.19 (G) — 버블 하단 모델 한 줄. 로컬 버블의 정체는 **지금 문 모델의 이름**이고, 아직 안
   * 골랐으면 그 사실 자체가 상태다(작은 원 안에 긴 안내문을 넣을 자리는 없으니 `All Model` 로만
   * 적는다 — 자세한 안내는 그 버블을 눌렀을 때 뜨는 설치 창이 한다).
   */
  const localModelLabel = localModelLabelOf(localProvider, t('ide.overlay.localLabel', { defaultValue: 'All Model' }));
  const codexModelLabel = codexModelLabelOf(codexProvider, t('ide.overlay.codexLabel', { defaultValue: 'Codex' }));
  /** 클로드 별칭만 접는다(`claude-` 접두·날짜 꼬리) — 로컬 파일명은 그 규칙의 대상이 아니다. */
  const modelLineText = localModelLabel ?? codexModelLabel ?? (effectiveModelName ? formatModelName(effectiveModelName) : '');
  /**
   * §5.25 (J) — **아직 한 턴도 안 돈 버블**의 모델 한 줄. 위 `modelLineText` 는 실측(`data.modelName`)
   * 을 주어로 삼는데, 첫 턴 전에는 그 값이 없어 설정에서 가져와야 한다. 그 설정 칸(`config.model`)
   * 이 클로드 전용이고 기본값이 `opus` 라 — 엔진을 안 보면 코덱스 버블이 `opus` 라고 말한다.
   * 판정은 `agentModelLabelOf` 한 곳이라 엔진이 늘어도 이 줄은 따라온다.
   */
  const idleModelText = useMemo(() => {
    const label = agentModelLabelOf(idleModelConfig, {
      codex: t('ide.overlay.codexLabel', { defaultValue: 'Codex' }),
      local: t('ide.overlay.localLabel', { defaultValue: 'All Model' }),
    });
    if (!label) return '';
    // 접기는 클로드 별칭에만 쓴다 — 로컬 파일명·코덱스 slug 는 그 규칙의 대상이 아니다.
    return idleModelConfig?.provider ? label : formatModelName(label);
  }, [idleModelConfig, t]);
  // 로컬 문맥은 엔진이 왕복마다 돌려준 값이다(클로드 세션의 contextUsed/Max 는 로컬에 없어 종전에는
  //   물결도 숫자도 영영 비어 있었다). 물결 높이와 아래 숫자가 같은 출처를 봐야 둘이 어긋나지 않는다.
  const effectiveContextUsed = localProvider
    ? localProvider.contextUsed
    : codexProvider ? (effectiveSubOverride ? effectiveSubOverride.contextUsed : data.contextUsed ?? codexProvider.contextUsed)
    : effectiveSubOverride ? effectiveSubOverride.contextUsed : data.contextUsed;
  const effectiveContextMax = localProvider
    ? localProvider.contextLimit
    // Codex rollout supplies the actual session window, including CLI configuration.
    : codexProvider ? (effectiveSubOverride ? effectiveSubOverride.contextMax : data.contextMax ?? codexProvider.contextLimit)
    : effectiveSubOverride ? effectiveSubOverride.contextMax : data.contextMax;
  const contextRatio = isAgent && effectiveContextMax ? (effectiveContextUsed ?? 0) / effectiveContextMax : 0;

  // §5.7 #26 — 워크트리 생성 연출은 폐기됐다. 남은 표식은 **실패** 하나뿐이다.
  const isCreatingError = data.creatingStatus === 'error';

  // 범용 disappearing fade: disappearStartedAt ~ disappearAt 사이에서 opacity 1→0.15
  const isDisappearing = data.status === 'disappearing';
  const disappearOpacity = useMemo(() => {
    if (!isDisappearing || !data.disappearStartedAt || !data.disappearAt) return 1;
    const total = data.disappearAt - data.disappearStartedAt;
    if (total <= 0) return 0.15;
    const elapsed = Date.now() - data.disappearStartedAt;
    const ratio = Math.max(0, 1 - elapsed / total);
    return Math.max(0.15, ratio * 0.85 + 0.15); // 0.15 ~ 1.0 범위
  }, [isDisappearing, data.disappearStartedAt, data.disappearAt]);

  /** §5.4 #31 — 무리 강조가 **곱해질** 원래 투명도(사라지는 중 / 죽은 프리뷰). 없으면 불투명. */
  const baseOpacity: number | undefined = isDisappearing
    ? disappearOpacity
    : isIframe && data.iframeAlive === false
      ? 0.35
      : undefined;

  const ringClass = isAwaitingPermission
    ? 'border-amber-400 shadow-lg shadow-amber-400/40 animate-pulse'
    : isActive
      ? style.ringActive
      : isFailed
        ? 'border-rose-500 shadow-lg shadow-rose-500/30'
        : isCompleted
          ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
          : style.ringIdle;

  // 마운트 시 스폰 애니메이션
  const [spawning, setSpawning] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSpawning(false), 300);
    return () => clearTimeout(t);
  }, []);

  // 더블클릭 — 열림 애니메이션 (선택과 분리된 순수 시각 효과).
  // 핸들러 자체는 선택 제스처(`gesture`)가 만들어진 뒤에 정의된다 — 아래 `handleDoubleClick`.
  const [opening, setOpening] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 에이전트 테두리 근접 감지 — 마우스가 테두리 근처면 두꺼워짐
  const [nearBorder, setNearBorder] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /** 마우스가 원 테두리 근처인지 판정 — zoom으로 버블이 작아져도 중심 영역 보장 */
  const isOnBorder = useCallback((e: { clientX: number; clientY: number }): boolean => {
    if (!wrapperRef.current) return false;
    const rect = wrapperRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = rect.width / 2;
    const threshold = Math.min(BORDER_HIT_MAX, Math.max(BORDER_HIT_MIN, radius * BORDER_HIT_RATIO));
    return Math.abs(dist - radius) < threshold;
  }, []);

  // 테두리 위에 머무르는 시간 측정 — 300ms 유지 시에만 하이라이트
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  }, []);
  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isAgent || overlayMode) return;
    // §5.4 #31 — Ctrl/Cmd 를 쥐고 있는 동안은 무리 잡기가 테두리를 쓴다. 연결 손짓은 재운다.
    if (linkModifierHeld) {
      clearHoverTimer();
      setNearBorder((prev) => (prev ? false : prev));
      return;
    }
    if (isOnBorder(e)) {
      if (hoverTimer.current == null) {
        hoverTimer.current = setTimeout(() => {
          setNearBorder(true);
          hoverTimer.current = null;
        }, BORDER_HOVER_DELAY_MS);
      }
    } else {
      clearHoverTimer();
      setNearBorder((prev) => (prev ? false : prev));
    }
  }, [isAgent, overlayMode, isOnBorder, clearHoverTimer, linkModifierHeld]);
  const handleMouseLeave = useCallback(() => {
    clearHoverTimer();
    setNearBorder(false);
  }, [clearHoverTimer]);

  // 글로벌 연결 모드 — 다른 커스텀 에이전트에서 연결 중일 때만 이 테두리 하이라이트.
  // Task Edge는 커스텀 에이전트 간(양쪽 customCreated) 연결만 허용하므로
  // 타겟도 customCreated일 때만 connect 타겟으로 표시.
  // §7.6 GitStatusCard — root 버블에서만 유효. label = projectName.
  const gitDirty = useGraphStore((s) => isRoot ? (s.gitDirty[data.label] ?? false) : false);
  const gitRefreshing = useGraphStore((s) => isRoot ? (s.gitRefreshing[data.label] ?? false) : false);

  const isConnectTarget = useGraphStore((s) =>
    s.connectingFrom !== null
    && s.connectingFrom !== data.id
    && isAgent
    && data.customCreated === true,
  );

  const startTaskEdgeDrag = useGraphStore((s) => s.startTaskEdgeDrag);

  // 실제 단일선택 동작 (클릭 확정 후 즉시 또는 지연 실행).
  const performSelect = useCallback((): void => {
    if (data.id === '__root_home__') {
      const folderId = useGraphStore.getState().currentFolderId;
      if (folderId) useGraphStore.getState().selectNode(folderId);
      return;
    }
    const rawId = data.id;
    const id = rawId.startsWith('sat-') ? rawId.slice(4) : rawId;
    useGraphStore.getState().selectNode(id);

    // 확인 dismiss(§2.4) — 어느 상태가 대상인지는 `agentDismiss` 한 벌이 정한다.
    if (data.bubbleType === 'agent' && shouldDismissOnSelect(data.status)) {
      fetch(`/api/dismiss-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: data.id }),
      }).catch(() => {});
    }
  }, [data.id, data.bubbleType, data.status]);

  /**
   * 선택 제스처 — 캔버스 공용 상태기계 한 벌(`bubbleSelectGesture`).
   *
   * 이 버블이 그 규칙의 기준이다: 움직임 없이 뗐을 때만 클릭(=선택)으로 인정하고, 더블클릭
   * 동작이 있는 버블이면 실제 선택을 {@link SELECT_DEFER_MS} 만큼 미뤄 2타를 먼저 확인한다.
   * 링(`selectIntentId`)은 미루지 않는다 — 손끝 반응과 패널 열림은 별개다.
   *
   * `ignore` 가 맡는 두 갈래는 이 버블에만 있는 것이다.
   *  - **커스텀 에이전트 테두리 누름** → 선택이 아니라 Task Edge 연결 드래그(노드 이동도 막는다).
   *  - **Back 버블** → 네비게이션 전용이라 선택 대상이 아니다.
   *
   * `leftButtonOnly:false` 인 이유: 이 버블은 우클릭도 "그 버블을 골랐다"로 쳐 왔다(메뉴가 뜬
   * 대상이 화면에 보여야 한다). 정리하면서 그 손버릇을 바꾸지 않는다.
   */
  const gesture = useBubbleSelectGesture({
    doubleClickable: isDoubleClickable,
    leftButtonOnly: false,
    select: performSelect,
    setIntent: (active) => {
      const store = useGraphStore.getState();
      if (!active) { store.setSelectIntent(null); return; }
      // selectNode/setSelectIntent 는 'sat-' 프리픽스를 떼고 저장 → 링 비교 규칙과 같은 모양으로.
      const intentId = data.id === '__root_home__'
        ? store.currentFolderId
        : (data.id.startsWith('sat-') ? data.id.slice(4) : data.id);
      store.setSelectIntent(intentId);
    },
    ignore: (e) => {
      // §5.4 #31 — Ctrl/Cmd 를 쥔 채 에이전트를 누르면 그건 "무리를 잡는" 손짓이다.
      //   ① 미리보기를 확정으로 올려 누르는 순간 세기가 한 단계 오르게 하고(무리 계산은 이미
      //      hover 가 해 뒀다 — 이 컴포넌트는 화면에 그려진 엣지 목록을 모른다),
      //   ② 선택으로는 치지 않는다(선택 링·우측 패널 ❌ — 강조와 겹쳐 무엇을 보는 중인지 흐려진다).
      //   `stopPropagation` 은 하지 않는다 — React Flow 의 노드 드래그가 그대로 살아 있어야
      //   그 손짓이 곧 동반 이동이 된다. 테두리 판정보다 **앞**에 둔다(수식 키 쪽이 명시적).
      if (isAgent && !overlayMode && linkModifierHeld) {
        promoteLinkGrab(data.id);
        return true;
      }
      // 커스텀 에이전트 테두리 클릭 → 연결 모드 진입 (노드 이동 차단).
      // Hook 에이전트/파이프라인/서브에이전트는 Task Edge 소스가 될 수 없다.
      if (isAgent && data.customCreated && !overlayMode && isOnBorder(e)) {
        e.stopPropagation?.();
        e.preventDefault?.();
        startTaskEdgeDrag(data.id, e.clientX, e.clientY);
        return true;
      }
      // Back 버블은 네비게이션 전용 — 선택 불가 (폴더 back + §5.10 기억 내부 back)
      return data.id === '__root_back__' || data.id === '__interior_back__';
    },
  });

  /**
   * §5.4 #31 — 손을 뗐다. 끌지 않고 누르기만 했다면 확정(`grab`)을 **미리보기로 되돌린다**
   * (수식 키를 놓았으면 스토어가 알아서 걷는다).
   *
   * 끌었을 때는 이 자리에 `pointerup` 이 오지 않을 수 있다(React Flow 의 드래그가 포인터를
   * 붙잡는다) — 그 경로는 `onNodeDragStop` 이 같은 함수를 부르므로 둘 중 무엇이 먼저 와도
   * 결과가 같다(멱등).
   */
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    gesture.handlers.onPointerUp(e);
    releaseLinkGrab();
  }, [gesture]);

  // 더블클릭 — 열림 애니메이션. 첫 줄에서 보류 단일선택 + 1타 하이라이트를 함께 접는다.
  const handleDoubleClick = useCallback(() => {
    gesture.cancelPendingSelect();
    if (openTimer.current) clearTimeout(openTimer.current);
    setOpening(true);
    openTimer.current = setTimeout(() => { setOpening(false); openTimer.current = null; }, 500);
  }, [gesture]);

  // §5.10 — 우측 더블클릭 = 기억(머릿속) 내부 진입.
  // §5.4 #34 — 그리고 **우클릭 1회 = 이 버블의 메뉴**(휴지통으로 이동·삭제). 둘은 같은 손짓의
  //   1타·2타라, 우더블클릭 대상인 버블에서는 메뉴를 `RIGHT_DBLCLICK_MS` 만큼 **미뤄** 연다 —
  //   그 창 안에 2타가 오면 미뤄 둔 메뉴를 접고 기억 화면으로 간다. 대상이 아닌 버블은 기다릴
  //   이유가 없으므로 즉시 연다. 좌클릭 SELECT_DEFER_MS 상태기계는 건드리지 않는다.
  const lastRightClickRef = useRef(0);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (menuTimerRef.current) clearTimeout(menuTimerRef.current); }, []);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // 노드 위 우클릭은 브라우저 기본 메뉴를 항상 억제(캔버스 생성 메뉴는 pane 우클릭 전용).
    e.preventDefault();
    // 좌표는 **지금** 뽑는다 — 미뤄서 여는 경로에서는 이벤트가 이미 지나간 뒤에 쓰이기 때문이다.
    const screenX = e.clientX;
    const screenY = e.clientY;
    const openMenu = (): void => {
      window.dispatchEvent(
        new CustomEvent<BubbleMenuRequest>(BUBBLE_MENU_EVENT, { detail: { nodeId, screenX, screenY } }),
      );
    };
    const target = interiorTargetFor(data);
    if (!target) { openMenu(); return; }
    const now = Date.now();
    if (now - lastRightClickRef.current <= RIGHT_DBLCLICK_MS) {
      lastRightClickRef.current = 0;
      // 2타가 왔다 — 미뤄 둔 메뉴는 열리지 않는다.
      if (menuTimerRef.current) { clearTimeout(menuTimerRef.current); menuTimerRef.current = null; }
      e.stopPropagation();
      // 보류 중 단일선택 + 1타에서 떴던 링을 함께 접는다(좌더블클릭과 같은 처리).
      gesture.cancelPendingSelect();
      const store = useGraphStore.getState();
      store.setSelectIntent(null);
      // §5.10 — 남은 우더블클릭은 휴지통 진입 하나다(기억 피드는 폐기).
      store.enterInterior({ kind: 'trash' });
      return;
    }
    lastRightClickRef.current = now;
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    menuTimerRef.current = setTimeout(() => { menuTimerRef.current = null; openMenu(); }, RIGHT_DBLCLICK_MS);
  }, [data, gesture, nodeId]);

  // 모든 버블은 원형 (size = 지름)
  const bubbleWidth = size;
  const bubbleHeight = size;

  // ── 선택 시 태양 코로나 SVG 지오메트리 ──
  // feTurbulence + feDisplacementMap 으로 외곽선을 진짜 일렁이게(태양 표면/플레어).
  // 픽셀 기준(viewBox=px)이라 버블 크기와 무관하게 일렁임 진폭이 일정.
  const SUN_MARGIN = 16;                       // 플레어/블러 여유 (작게 = 라인이 버블에 밀착)
  const sunBox = size + SUN_MARGIN * 2;
  const sunC = sunBox / 2;
  const sunR = size / 2;                        // 필라멘트를 버블 테두리 바로 위에 (안쪽은 클립)
  const sunFilterId = `sun-${String(nodeId).replace(/[^\w-]/g, '')}`;

  /**
   * §5.24 — 히트 배지 지오메트리. 자리는 **원의 45° 림 위**다(감싸는 사각형의 모서리에 두면
   * 원형 버블에서 배지가 림에서 떨어져 허공에 뜬 것처럼 보인다). 히트 버블은 44~150px 로 작아질 수 있어
   * 하한을 두지 않으면 가장 차가운 버블의 숫자가 판독 불가가 된다.
   */
  const heatBadgeSize = Math.max(17, Math.round(20 * ts));
  const heatBadgeFont = Math.max(11, Math.round(12 * ts));
  const heatBadgeInset = Math.max(0, Math.round((size / 2) * (1 - Math.SQRT1_2) - heatBadgeSize / 2));

  // 테두리 두께: 기본 2px → 근접 시 4px, 연결 타겟 시 4px + 색상 변경
  const borderWidth = nearBorder || isConnectTarget ? 4 : 2;
  const borderHighlight = isConnectTarget
    ? 'border-cyan-400 shadow-lg shadow-cyan-400/40'
    : nearBorder
      ? codexProvider
        ? 'border-violet-200 shadow-md shadow-violet-400/30'
        : 'border-blue-400 shadow-md shadow-blue-400/30'
      : '';

  // §4 v2.63 — 에이전트 종류 구분 배지(라벨 아래): All Model(로컬 LLM) / CMD(인터랙티브 터미널) /
  //   커스텀(우리가 오케스트레이션) / 훅(Claude Code 이벤트 캡처). 넷 다 같은 위치·타이포로 색만 달라
  //   한눈에 구분된다. auto 버블(bubbleType='auto')은 고유 별 아이콘이 있어 제외(isAgent=false).
  //   라벨 텍스트는 **영어 고정** — i18n 미대상(사용자 지정).
  // §5.19 (G) — All Model 버블은 커스텀 에이전트를 뼈대로 삼지만 **말을 거는 상대가 다르다.**
  //   여기에 `Custom` 을 달면 캔버스가 정체를 거짓으로 말한다 — 설정 창도 IDE 상태바도 이미
  //   `All Model` 이라 부르는데 버블만 다른 이름을 쓰면 같은 것이 두 이름으로 불린다.
  //   본체가 무채색(그레이파이트)이라 배지는 밝은 쪽으로 잡아야 읽힌다(훅의 어두운 슬레이트와 구분).
  //   §5.25 (B) — 코덱스 버블의 배지는 `Custom` 이 아니라 **Codex** 다. 위 All Model 과 같은 이유로,
  //   엔진이 다른데 같은 이름을 달면 캔버스가 정체를 거짓으로 말한다(우클릭 메뉴·설정 창·IDE 가
  //   이미 `Codex` 라 부른다). 그리고 남은 커스텀 에이전트는 실제로 **클로드**가 도는 것이므로
  //   배지도 `Claude` 라 쓴다 — "Custom" 은 엔진 축이 하나뿐이던 시절의 이름이었다.
  const agentBadge = localProvider
    ? { text: 'All Model', cls: 'bg-slate-200/25 text-slate-50' }
    : codexProvider
      ? { text: 'Codex', cls: 'bg-violet-400/25 text-violet-100 ring-1 ring-inset ring-violet-300/40' }
      : isCmdAgent
        ? { text: 'CMD', cls: 'bg-teal-500/25 text-teal-100' }
        : isAgent && data.customCreated
          ? { text: 'Claude', cls: 'bg-indigo-500/25 text-indigo-100' }
          : isAgent
            ? { text: 'Claude', cls: 'bg-indigo-500/25 text-indigo-100' }
            : null;
  // Engine identity is the main badge; hook tracking is a smaller, separate line.
  const showHookLabel = isAgent && !data.customCreated && !isCmdAgent && !localProvider;

  /**
   * §2.4 버블 타이포 오토핏 ① — 하단 블록을 **그릴 줄의 목록**으로 먼저 세운다.
   * 예약 높이가 이 목록에서 나오므로, 줄이 1줄이든 5줄이든 중앙 열이 밟히지 않는다.
   * (종전에는 예약이 고정 3줄치라 4줄째부터 배지·라벨이 모델명 위에 얹혔다.)
   */
  const bottomLines = useMemo<BubbleBottomLine[]>(() => {
    const px = (n: number, floor: number) => Math.max(floor, Math.round(n * ts));
    const lines: BubbleBottomLine[] = [];
    // 에이전트: 모델명 + 컨텍스트 + 상태 + 토큰 합산.
    // 버블 본체에는 세션 라벨(서브에이전트 이름)을 표시하지 않는다 — 자동 주제명(첫 프롬프트)이
    // 긴 문장이라 작은 버블에 노이즈가 된다. 어느 세션 컨텍스트인지는 IDE 탭에서 확인.
    if (isAgent && (localModelLabel ?? codexModelLabel ?? effectiveModelName)) {
      // §5.19 (G) — 로컬 모델명은 파일명이라 길 수 있다. 원 밖으로 삐져나가는 대신 현(chord) 폭에
      //   맞춰 잘리고 전체 이름은 툴팁으로 남는다(클로드 별칭은 짧아 잘릴 일이 없다).
      lines.push({
        key: 'model',
        text: modelLineText,
        fontSize: px(9, 5),
        cls: 'font-semibold text-white/70',
        priority: 100,
        title: localModelLabel ?? undefined,
        summarize: 'middle',
      });
      if (effectiveContextMax || (codexModelLabel && effectiveContextUsed !== undefined)) {
        lines.push({
          key: 'context',
          text: `${formatTokenCount(effectiveContextUsed ?? 0)}/${effectiveContextMax ? formatTokenCount(effectiveContextMax) : '?'}`,
          fontSize: px(8, 5),
          cls: 'text-white/50',
          priority: 80,
          mergeGroup: 'status',
        });
      }
      // §2.4 (잠듦) — 자식 프로세스를 회수해 둔 세션. 새 모양 ❌, 기존 하단 타이포에 한 줄만.
      if (isDormant) {
        lines.push({
          key: 'dormant',
          text: t('common.bubble.dormant'),
          fontSize: px(8, 5),
          cls: 'text-white/40',
          priority: 60,
          mergeGroup: 'status',
        });
      }
      // §5.19 (G) — 로컬 버블은 모델명이 설정에서 곧장 오므로 아래 idle empty-state 분기를 타지
      //   않는다. 그 분기가 하던 "대기" 한 줄을 여기서 이어 받는다 — 정체를 바로잡으면서 상태를
      //   잃으면 사용자는 이 버블이 쉬는 중인지 죽은 것인지 구분할 수 없다.
      if ((localModelLabel || (codexModelLabel && effectiveContextUsed === undefined)) && !isDormant && !isActive && !isCreatingError) {
        lines.push({
          key: 'idle',
          text: t('common.bubble.idle'),
          fontSize: px(8, 5),
          cls: 'text-white/50',
          priority: 60,
          mergeGroup: 'status',
        });
      }
      // 누적 토큰 줄(`입+출` + 공유 표식 `*`)은 버블에서 걷었다 — 되살리지 마라. 세션 누적은
      //   금세 억 단위로 자라 `973.1M+6.3M *` 처럼 하단에서 가장 긴 줄이 되고, 그 길이 때문에
      //   오토핏 축약 사다리가 정작 봐야 할 모델명·컨텍스트를 먼저 줄였다. 값 자체는 IDE 상태바
      //   (`statusBarContext`) · DetailPanel 세션 목록(`panel.subAgent.tokensInOut`) · 사용량
      //   팝업(`UsagePopup`)에 그대로 있어 캔버스에서 지워도 잃는 정보가 없다.
      return lines;
    }
    // §2.4 v1.67/v1.69 — 라이브 세션 전 에이전트 idle empty-state (커스텀+훅 공통).
    //   설정에서 모델을 알 수 있으면(커스텀) 모델명도, 없으면(훅) 상태 줄만.
    // §5.25 (J) — **엔진을 보고 적는다.** 종전에는 이 줄만 `config.model` 을 그대로 썼고,
    //   그 칸의 기본값이 `opus` 라 **아직 한 턴도 안 돈 코덱스·로컬 버블이 `opus` 로 떴다**
    //   (사용자 보고 — "GPT 에이전트 버블인데 왜 이름에 opus 가 뜨냐"). 위 활성 경로는 이미
    //   프로바이더를 보고 있었는데 이 idle 경로만 빠져 있던, 화면마다 따로 판정한 대가다.
    if (isAgent && !isActive && contextRatio === 0 && !isCreatingError) {
      if (idleModelText) {
        lines.push({
          key: 'model',
          text: idleModelText,
          fontSize: px(9, 5),
          cls: 'font-semibold text-white/70',
          priority: 100,
          summarize: 'middle',
        });
      }
      lines.push({
        key: 'state',
        text: t(isDormant ? 'common.bubble.dormant' : 'common.bubble.idle'),
        fontSize: px(8, 5),
        cls: 'text-white/50',
        priority: 60,
      });
      return lines;
    }
    if (isFolder) {
      // §2.1 v1.55 — 외부 폴더는 평탄화로 satellite 만 가지므로 satelliteFileCount 우선.
      //   내부 폴더는 기존 childCount(직속 하위 폴더 수) 우선.
      //   §2.1 #5 접합 트리 — 만진 파일이 없는 **접합** 외부 폴더는 위성이 0이다.
      //   그대로 두면 "0 files" 로 떠서 빈 버블처럼 보이므로 하위 폴더 수로 떨어진다.
      const satCount = data.satelliteFileCount ?? 0;
      const isExternalFolder = data.bubbleType === 'external_folder';
      // §2.1 (A) — 접합은 자기 위성이 0이라 종전에는 **직속 자식 수**로 떨어졌다(`4` 가 25곳을
      //   대표했다). 그 아래에서 실제로 만진 파일 수가 있으면 그것을 먼저 말한다.
      const descFiles = data.externalDescendantFiles ?? 0;
      const descFolders = data.externalDescendantFolders ?? 0;
      const count = isExternalFolder
        ? (satCount > 0 ? satCount : (descFiles > 0 ? descFiles : (data.childCount ?? 0)))
        : (data.childCount ?? 0);
      lines.push({ key: 'files', text: `${count} files`, fontSize: px(10, 6), cls: 'text-white/60', priority: 100 });
      if (isExternalFolder && descFolders > 0) {
        // "그 안에 몇 곳이 있나" — 접합이 자기 크기를 말하는 유일한 숫자.
        lines.push({
          key: 'extFolders',
          text: t('canvas.external.descendantFolders', { count: descFolders }),
          fontSize: px(8, 5),
          cls: 'text-white/45',
          priority: 80,
        });
      }
      if (isExternalFolder && (data.externalFoldedPlaces ?? 0) > 1) {
        // §2.1 (C) — 세션마다 새로 생기는 자리를 몇 곳 접었나("세션 4곳").
        lines.push({
          key: 'extFolded',
          text: t('canvas.external.foldedPlaces', { count: data.externalFoldedPlaces ?? 0 }),
          fontSize: px(8, 5),
          cls: 'text-white/40',
          priority: 60,
        });
      }
      const summaryChips = isExternalFolder ? data.externalSummaryChips : undefined;
      if (summaryChips && summaryChips.length > 0) {
        // "그 안에 **무엇이** 있나" — 경로만 적힌 접합이 아무 말도 하지 않던 자리를 메운다.
        lines.push({
          key: 'extChips',
          text: summaryChips.join(' · '),
          fontSize: px(8, 5),
          cls: 'text-white/50',
          priority: 90,
          summarize: 'middle',
        });
      }
      return lines;
    }
    if (isIframe) {
      lines.push({
        key: 'serverKind',
        text: data.serverKind === 'frontend' ? 'FE' : 'BE',
        fontSize: px(9, 5),
        cls: `rounded px-1 py-0.5 font-semibold ${data.serverKind === 'frontend' ? 'bg-sky-500/30 text-sky-300' : 'bg-amber-500/30 text-amber-300'}`,
        priority: 100,
        extraHeight: 4, // py-0.5 위아래
      });
      return lines;
    }
    return lines;
  }, [
    ts, isAgent, isFolder, isIframe, localModelLabel, codexModelLabel, effectiveModelName, modelLineText,
    effectiveContextMax, effectiveContextUsed, isDormant, isActive, isCreatingError,
    contextRatio, configModel, t,
    data.bubbleType, data.satelliteFileCount,
    data.childCount, data.serverKind,
    // §2.1 (A)(C) — 외부 폴더 요약. 값이 바뀌면 줄이 다시 서야 한다.
    data.externalDescendantFiles, data.externalDescendantFolders,
    data.externalFoldedPlaces, data.externalSummaryChips,
  ]);

  /** 중앙 열에 라벨·배지 말고 더 얹히는 줄 — 예약 계산에 함께 들어가야 라벨이 잘리지 않는다. */
  const centerExtras = useMemo<BubbleCenterExtra[]>(() => {
    const extras: BubbleCenterExtra[] = [];
    if (showHookLabel) extras.push({ fontSize: Math.max(4, Math.round(6 * ts)) });
    if (data.lastTool && isActive && size >= 55) extras.push({ fontSize: Math.max(6, Math.round(11 * ts)) });
    if (isTrashBubble && trashedCount > 0) extras.push({ fontSize: Math.max(6, Math.round(9 * ts)) });
    return extras;
  }, [showHookLabel, data.lastTool, isActive, size, ts, isTrashBubble, trashedCount]);

  /** 하단 블록 바닥 여백 — 폴더만 종전 값(8·ts)을 그대로 지킨다(보이던 자리를 옮기지 않는다). */
  const bottomOffset = isFolder ? Math.max(4, Math.round(8 * ts)) : Math.max(3, Math.round(6 * ts));

  /**
   * §2.4 버블 타이포 오토핏 ② — 배치를 정한다.
   * 원 안에 다 안 들어가면 간격 밀기 → 줄 병합 요약 → 라벨 가운데 줄임 → 최하 줄 접기 순으로
   * 내려간다. 접힌 내용은 `foldedText` 로 돌아와 툴팁에 남으므로 정보는 사라지지 않는다.
   */
  /**
   * §2.1 (D) — 알려진 자리면 경로 대신 그 자리의 **이름**을 보여 준다.
   *
   * `c--users-dev-work-my-app` 같은 slug 와 세션 UUID 는 읽을 수 없다.
   * 서버는 문구가 아니라 **i18n 키**만 실어 보내므로(12개 로케일) 고르는 것은 여기다.
   * 번역이 없으면 종전 라벨 그대로 — 경로·`absolutePath`·열기 동작은 한 글자도 바뀌지 않는다.
   */
  const displayLabel = useMemo(() => {
    const placeKey = data.externalPlaceKey;
    if (!placeKey) return data.label;
    // 같은 이름의 자리가 여럿 생기는 곳(프로젝트별 기록 · 스킬)은 그 자리를 가르는 조각을 함께 넣는다 —
    //   이름만 넣으면 둘이 똑같아져 읽히게 만들려던 것이 오히려 구분을 지운다.
    const hint = externalPlaceHint(data.absolutePath ?? data.path, placeKey);
    const named = t(`canvas.externalPlace.${placeKey}`, { name: hint, defaultValue: '' });
    // 구분자를 못 뽑았으면 넘기는 구두점을 걷는다. 걷는 것은 **힌트가 빈 때뿐**이다 — 어떤 글자가
    //   구분자인지는 로케일마다 다른데(`·` · `–` · `：` …), 힌트가 있는 문장까지 걷으면 멀집한 끝글자를
    //   잘라 버린다. 남는 글자가 없으면 종전 라벨이 더 정확하다.
    const cleaned = hint ? named : named.replace(/[\s·・:：|/,、\-–—]+$/u, '');
    return cleaned.trim() || data.label;
  }, [data.externalPlaceKey, data.absolutePath, data.path, data.label, t]);

  /**
   * §2.4 오토핏 — 중앙 아이콘. 종류와 px 를 **여기 한 곳에서** 정하고 예약(`iconPx`)과 실제 렌더가
   * 같은 값을 쓴다. 둘이 갈리면 예약 높이가 실제 높이와 어긋나 중앙 열이 하단 블록을 파고든다.
   */
  const bubbleIcon: BubbleIconKind = codexProvider ? 'codex' : isAgent && !localProvider ? 'claude' : style.icon;
  const bubbleIconPx = isBrandIcon(bubbleIcon)
    ? Math.max(10, Math.round(32 * ts * BRAND_ICON_SCALE))
    : Math.max(12, Math.round(32 * ts));

  const fit = useMemo(() => planBubbleText({
    size,
    ts,
    borderWidth,
    iconPx: bubbleIconPx,
    label: displayLabel,
    labelFontSize: Math.max(7, Math.round(13 * ts)),
    labelMaxLines: isAgent ? 2 : 1,
    labelWidthRatio: BUBBLE_TEXT_WIDTH_RATIO,
    badge: agentBadge ? { text: agentBadge.text, fontSize: Math.max(5, Math.round(8 * ts)) } : null,
    centerExtras,
    bottomLines,
    bottomOffset,
  }), [size, ts, borderWidth, bubbleIconPx, displayLabel, isAgent, agentBadge?.text, centerExtras, bottomLines, bottomOffset]);

  return (
    <div
      ref={wrapperRef}
      className={`group relative ${isDespawning ? 'bubble-despawn' : spawning ? 'bubble-spawn' : ''} ${opening ? 'animate-bubble-open' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        ...{
          width: bubbleWidth,
          height: bubbleHeight,
          // §5.4 #31 — 무리 강조는 이 버블이 이미 가진 투명도에 **곱한다**. 덮어쓰면 사라지는 중인
          // 버블이나 죽은 프리뷰가 강조 때문에 멀쩡해 보인다.
          opacity: linkVisual.opacityMul === 1 ? baseOpacity : (baseOpacity ?? 1) * linkVisual.opacityMul,
          filter: linkVisual.filter ?? undefined,
          // 무리 강조는 손끝 반응이라 페이드(0.4s)보다 빨라야 한다 — 걸린 동안만 짧은 곡선을 쓴다.
          transition: `width 0.45s cubic-bezier(0.4, 0, 0.2, 1), height 0.45s cubic-bezier(0.4, 0, 0.2, 1), opacity ${
            linkRole === 'off' ? '0.4s ease-out' : `${LINK_FOCUS.TRANSITION_MS}ms ease-out`
          }, filter ${LINK_FOCUS.TRANSITION_MS}ms ease-out`,
        },
        cursor: nearBorder ? 'crosshair' : undefined,
      }}
    >
      {/* §5.4 #31 — 무리 안 버블의 흰 빛 링·글로우. 본체 위에 얹되(z-10) 클릭은 통과시킨다.
          별도 겹면인 이유는 본체 div 가 자기 테두리·그림자를 이미 쓰고 있어서다(덮어쓰면
          카테고리 색 테두리가 사라진다). */}
      {linkVisual.boxShadow !== null && (
        <span
          className="pointer-events-none absolute inset-0 z-10 rounded-full"
          style={{ boxShadow: linkVisual.boxShadow, transition: `box-shadow ${LINK_FOCUS.TRANSITION_MS}ms ease-out` }}
        />
      )}
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} />

      {/* §5.24 — 히트 숫자 배지. 램프는 순서만 주고 양은 주지 않아서, 켠 동안은 그 값을 숫자로도 적는다.
          **칩은 어둡게 두고 글자는 흰색, 히트색은 링·글로우가 맡는다** — 본체와 같은 히트색으로 채우면
          뜨거운 버블 위에서 배지가 얼룩으로 뭉개지고, 차가운 남색 글자는 어두운 칩 위에서 읽히지 않는다.
          네 자리부터는 `1.2k` 로 접고(버블 안에서 다섯 글자는 안 읽힌다) 정확한 값은 title 에 남는다. */}
      {heatBadge && (
        <span
          className={`pointer-events-none absolute z-20 flex items-center justify-center rounded-full font-bold tabular-nums leading-none tracking-tight ${
            heatBadge.value > 0
              ? 'bg-gray-950/85 text-gray-50'
              // 0 은 뒤로 물러난다 — 한 번도 안 읽은 버블이 많은 지도에서 회색 숫자가 앞줄에 서면
              //   정작 뜨거운 곳의 숫자가 묻힌다(지우지는 않는다 — "왜 얘는 안 봤지?"가 이 절의 질문이다).
              : 'bg-gray-950/60 text-gray-400 opacity-75'
          }`}
          style={{
            top: heatBadgeInset,
            right: heatBadgeInset,
            minWidth: heatBadgeSize,
            height: heatBadgeSize,
            padding: '0 5px',
            fontSize: heatBadgeFont,
            // 동적 색은 캔버스 전반과 같이 style 로 준다(램프 색은 Tailwind 클래스로 표현할 수 없다).
            boxShadow: heatBadge.value > 0
              ? `0 0 0 1.5px ${heatBadge.ring}, 0 0 9px ${heatBadge.ring}80`
              : `0 0 0 1.5px ${heatBadge.ring}`,
          }}
          title={heatBadge.axis === 'write'
            ? t('canvas.heatmap.badgeWrite', { n: heatBadge.value.toLocaleString() })
            : t('canvas.heatmap.badgeRead', { n: heatBadge.value.toLocaleString() })}
        >
          {heatBadge.label}
        </span>
      )}

      {/* §5.15 — 스펙 변경됨 배지. 이 카드를 낳은 스펙이 그 뒤에 바뀌었다는 표시일 뿐,
          카드를 지우거나 다시 만들지는 않는다 — 무엇을 할지는 사람이 정한다. */}
      {specStaleTitle !== null && (
        <span
          className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full bg-amber-400 text-gray-950 ring-2 ring-gray-950"
          style={{ bottom: -1, right: -1, width: 16, height: 16 }}
          title={t('canvas.spec.staleBadge', { defaultValue: '스펙 변경됨 — {{title}}', title: specStaleTitle })}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </span>
      )}

      {/* §5.11 v3.88 — 플러그인 배지 슬롯. 코어는 "여기에 자리가 있다"만 알고, 무엇이 그려지는지는 모른다.
          활성 기여가 없으면 호스트가 null 을 돌려 DOM 자체가 안 생긴다. */}
      <PluginBubbleBadgeSlot
        bubbleId={data.id}
        bubbleType={data.bubbleType}
        label={data.label}
        customCreated={data.customCreated ?? false}
        agentConfig={pluginAgentConfig}
      />

      {/* 바디 — 드래그 핸들 (원/네모 영역만 잡아끌기 가능) */}
      <div
        className={`bubble-body bubble-press absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-full ${borderHighlight || ringClass} ${isDisappearing ? 'bubble-ghost' : ''} ${isTrashBubble && trashedCount === 0 ? 'opacity-50' : ''}`}
        {...gesture.handlers}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        style={{
          borderWidth,
          borderStyle: 'solid',
          // §2.4 오토핏 — 하단 블록 높이만큼 바닥 예약. 값은 **그릴 줄에서 계산**한다(고정 3줄치 ❌).
          // justify-center 가 이 영역 위에서만 일어나 2줄 라벨이 길어져도 위로 밀려 겹치지 않음.
          // absolute 하단 블록은 padding box 기준이라 이 padding 에 안 밀리고 바닥 유지.
          paddingBottom: fit.paddingBottom || undefined,
          transition: 'border-width 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          background: isCreatingError
            ? 'radial-gradient(circle at 35% 35%, #fca5a5, #ef4444)'
            : isAgent && contextRatio > 0
              ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
              : isAgent
                // §2.4 v1.68/v1.69 — 모든 에이전트(커스텀+훅)는 컨텍스트 물결과 동일한 반투명 배경으로 시작
                ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
                : isActive
                ? `radial-gradient(circle at 35% 35%, ${style.glow}, ${style.color})`
                : `radial-gradient(circle at 35% 35%, ${style.glow}90, ${style.color}CC)`,
        }}
      >
        {codexProvider && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full border border-violet-300/25"
            style={{ inset: Math.max(4, Math.round(6 * ts)) }}
          />
        )}
        {/* 에이전트 물결 채움 */}
        {isAgent && contextRatio > 0 && (
          <WaveFill ratio={contextRatio} color={style.color} />
        )}
        {/* §2.4 v1.68 — 커스텀 에이전트는 컨텍스트 전엔 물결 ❌, 반투명 배경만(빈 상태).
            컨텍스트가 쌓이면 위 contextRatio>0 분기의 실측 물결로 자연 등장. */}
        {/* §5.7 #26 — 워크트리 생성 연출(불확정 물결) 폐기. 만드는 동안 캔버스엔 아무것도 뜨지 않고
            다 만들어진 실물 버블이 그냥 나타난다. 실패했을 때의 붉은 표식만 남아 있다(아래 배경). */}

        {/* §2.4 오토핏 — gap·라벨 줄 수·배지 표시 여부는 fit 이 정한다(원 안에 들어갈 때까지 단계적으로).
            maxHeight 는 마지막 안전망 — 사다리를 다 내려가고도 안 들어가는 아주 작은 버블에서
            중앙 열이 예약 영역(하단 블록 자리)으로 흘러드는 것을 막는다(겹침 대신 잘림). */}
        <div
          className="z-10 flex flex-col items-center justify-center overflow-hidden"
          style={{ gap: fit.centerGap, maxHeight: fit.centerMaxHeight }}
        >
          <BubbleIcon icon={bubbleIcon} px={bubbleIconPx} />
          <span
            className={`${fit.labelLines > 1 ? 'line-clamp-2 break-words' : 'truncate'} leading-tight text-center font-bold text-white drop-shadow-sm ${isDisappearing ? 'bubble-ghost-label' : ''}`}
            style={{
              maxWidth: fit.labelMaxWidth,
              fontSize: Math.max(7, Math.round(13 * ts)),
            }}
            title={isFolder
              ? (data.absolutePath ?? data.label)
              : (isAgent || fit.labelText !== displayLabel) ? displayLabel : undefined}
          >
            {fit.labelText}
          </span>
          {fit.showBadge && agentBadge && (
            <span
              className={`rounded px-1 font-bold uppercase tracking-wide ${agentBadge.cls}`}
              style={{ fontSize: Math.max(5, Math.round(8 * ts)) }}
            >
              {agentBadge.text}
            </span>
          )}
          {fit.showBadge && showHookLabel && (
            <span
              className="font-medium tracking-widest text-white/45"
              style={{ fontSize: Math.max(4, Math.round(6 * ts)) }}
            >
              HOOK
            </span>
          )}
          {data.lastTool && isActive && size >= 55 && (
            <span
              style={{ fontSize: Math.max(6, Math.round(11 * ts)), maxWidth: size * BUBBLE_TEXT_WIDTH_RATIO }}
              className="block truncate text-center font-medium text-white/70"
              title={data.lastTool}
            >
              {data.lastTool}
            </span>
          )}
          {/* §5.10 — 카드 수는 위(라벨 앞)로 올라갔다. 최근 제목·단위는 툴팁·DetailPanel·라이브러리 담당. */}
          {/* §5.10 — 휴지통 버블: 버려진 에이전트 수 */}
          {isTrashBubble && trashedCount > 0 && (
            <span className="font-semibold text-white/80" style={{ fontSize: Math.max(6, Math.round(9 * ts)) }}>
              {t('trash.trashCountShort', { defaultValue: '{{n}}개', n: trashedCount })}
            </span>
          )}
        </div>

        {/* §2.4 오토핏 — 하단 블록(에이전트 모델/컨텍스트/상태/토큰 · 폴더 파일 수 · iframe 종류).
            무엇을 그릴지는 위 `bottomLines` 가 정하고, 바디의 예약(paddingBottom)이 **같은 목록**에서
            나오므로 줄이 몇이든 중앙 열과 겹치지 않는다. 원 안에 안 들어가면 오토핏이 병합·접기로
            줄인 뒤 접힌 내용을 이 블록 툴팁에 남긴다 — 글자는 줄어들어도 사라지지 않는다.
            가로는 그 높이에서의 현(chord) 폭이라 맨 아랫줄이 원 밖으로 삐져나가지 않는다. */}
        {fit.bottomLines.length > 0 && (
          <div
            className="absolute z-10 flex flex-col items-center"
            style={{ bottom: bottomOffset }}
            title={fit.foldedText || undefined}
          >
            {fit.bottomLines.map((line, i) => (
              <span
                key={line.key}
                className={`max-w-full truncate text-center ${line.cls}`}
                style={{
                  fontSize: line.fontSize,
                  lineHeight: BUBBLE_LINE_HEIGHT,
                  maxWidth: fit.bottomMaxWidths[i],
                }}
                title={line.title}
              >
                {line.text}
              </span>
            ))}
          </div>
        )}

      </div>

      {/* 펄스 링 — active 상태일 때만 표시 (§4 v3.71 — 저줌에선 링이 서로 겹쳐 뭉개지기만 하므로 생략) */}
      {isActive && (
        <>
          <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: style.glow }} />
          <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: style.glow, animationDelay: '0.75s' }} />
        </>
      )}

      {/* §7.6 root 버블: git 상태 보조 이펙트 (refresh sweep + dirty dot) */}
      {isRoot && gitRefreshing && (
        <div
          className="pointer-events-none absolute -inset-1 animate-git-sweep rounded-full opacity-70"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 300deg, ${GIT_STATUS_CONFIG.DIRTY_DOT_COLOR}66 340deg, ${GIT_STATUS_CONFIG.DIRTY_DOT_COLOR} 360deg)`,
            WebkitMask: 'radial-gradient(circle, transparent calc(50% - 2px), black calc(50% - 1px), black 50%, transparent calc(50% + 1px))',
            mask: 'radial-gradient(circle, transparent calc(50% - 2px), black calc(50% - 1px), black 50%, transparent calc(50% + 1px))',
          }}
        />
      )}
      {isRoot && gitDirty && (
        <div
          className="pointer-events-none absolute rounded-full border border-gray-900"
          style={{
            width: Math.max(7, Math.round(10 * ts)),
            height: Math.max(7, Math.round(10 * ts)),
            top: Math.max(2, Math.round(6 * ts)),
            right: Math.max(2, Math.round(6 * ts)),
            backgroundColor: GIT_STATUS_CONFIG.DIRTY_DOT_COLOR,
            boxShadow: `0 0 6px ${GIT_STATUS_CONFIG.DIRTY_DOT_COLOR}99`,
          }}
          title={t('common.uncommittedChanges')}
        />
      )}

      {/* completed 빨강 글로우 */}
      {isCompleted && (
        <>
          <div className="pointer-events-none absolute -inset-1 rounded-full border-[3px] border-cyan-400" />
          <div className="pointer-events-none absolute -inset-2 animate-pulse rounded-full opacity-50" style={{ boxShadow: '0 0 20px 8px #22D3EE', animationDuration: '3s' }} />
        </>
      )}

      {/* error 글로우 — completed 와 같은 형태, 색만 rose. 완료와 실패가 한눈에 갈려야 한다. */}
      {isFailed && (
        <>
          <div className="pointer-events-none absolute -inset-1 rounded-full border-[3px] border-rose-500" />
          <div className="pointer-events-none absolute -inset-2 animate-pulse rounded-full opacity-50" style={{ boxShadow: '0 0 20px 8px #F43F5E', animationDuration: '3s' }} />
        </>
      )}

      {/* 선택 하이라이트 — 태양 코로나(외곽선이 일렁이는 플레어). 등장/퇴장 모두 페이드. */}
      {selectRender && (
        <svg
            className="animate-sun-spin pointer-events-none absolute z-[14]"
            style={{
              left: -SUN_MARGIN,
              top: -SUN_MARGIN,
              width: sunBox,
              height: sunBox,
              opacity: selectShown ? 1 : 0,
              transition: `opacity ${selectShown ? SELECT_FADE_IN_MS : SELECT_FADE_MS}ms ease`,
              // 버블 반지름 안쪽은 강제 클립 — 일렁임/블러가 어떤 경우에도 내부로 못 들어옴.
              WebkitMask: `radial-gradient(circle closest-side, transparent calc(100% - ${SUN_MARGIN}px), #000 calc(100% - ${SUN_MARGIN - 1}px), #000 100%)`,
              mask: `radial-gradient(circle closest-side, transparent calc(100% - ${SUN_MARGIN}px), #000 calc(100% - ${SUN_MARGIN - 1}px), #000 100%)`,
            }}
            viewBox={`0 0 ${sunBox} ${sunBox}`}
            fill="none"
          >
            <defs>
              <filter id={sunFilterId} x="-60%" y="-60%" width="220%" height="220%">
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
              <radialGradient id={`${sunFilterId}-g`} gradientUnits="userSpaceOnUse" cx={sunC} cy={sunC} r={sunR + 12}>
                <stop offset={(sunR - 4) / (sunR + 12)} stopColor={style.glow} stopOpacity={0.44} />
                <stop offset={(sunR + 2) / (sunR + 12)} stopColor={style.glow} stopOpacity={0.32} />
                <stop offset={(sunR + 6) / (sunR + 12)} stopColor={style.glow} stopOpacity={0.1} />
                <stop offset={1} stopColor={style.glow} stopOpacity={0} />
              </radialGradient>
            </defs>
            {/* 느린 회전 = 플레어가 표면을 따라 흐름.
                레이어: (1) 안밝→밖흐림 그라디언트 띠  (2) 그 위 얇고 또렷한 빛 필라멘트 */}
            <g filter={`url(#${sunFilterId})`}>
              <circle cx={sunC} cy={sunC} r={sunR + 12} fill={`url(#${sunFilterId}-g)`} />
              <circle cx={sunC} cy={sunC} r={sunR} stroke={style.glow} strokeWidth={1.25} opacity={0.72} />
            </g>
          </svg>
      )}

      {/* §4 v1.49 — Notification 시각 신호: awaiting_permission(bell).
          v1.73 — awaiting_input(모래시계) 전면 제거. 입력 대기는 더 이상 버블에 표시하지 않는다
          (데몬 단일-세션은 --resume 으로 항상 이어지므로 "대기" 신호가 연속성 끊김으로 보였음). */}
      {isAwaitingPermission && (
        <div
          className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full border border-amber-300 bg-amber-500/90 text-amber-50 animate-pulse"
          style={{
            width: Math.max(14, Math.round(20 * ts)),
            height: Math.max(14, Math.round(20 * ts)),
            top: Math.max(2, Math.round(4 * ts)),
            right: Math.max(2, Math.round(4 * ts)),
          }}
          title={t('common.bubble.awaitingPermission')}
          aria-label={t('common.bubble.awaitingPermission')}
        >
          {/* bell (lucide stroke) */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '70%', height: '70%' }}>
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </div>
      )}

      {/* 완료 요약 말풍선 — 임시 비활성화 (사용자 요청 2026-04-19).
          복구하려면 아래 `false &&`를 제거하면 원상 복귀. */}
      {false && isCompleted && data.summary && (
        <div
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 animate-fade-in"
          style={{ top: '100%', marginTop: 12 }}
        >
          {/* 말풍선 꼬리 (삼각형) */}
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-gray-600 bg-gray-800" />
          {/* 말풍선 본문 */}
          <div className="max-w-[260px] rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 shadow-lg shadow-black/40">
            <p className="line-clamp-6 break-words text-[12px] leading-relaxed text-gray-200">
              {data.summary}
            </p>
          </div>
        </div>
      )}

      {/* Disappearing 상태 뱃지 */}
      {isDisappearing && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700/80 px-2 py-0.5 text-[12px] text-gray-400">
          {isGhost && data.ghostInfo
            ? (data.ghostInfo.changeType === 'deleted' ? 'Deleted' : `Renamed → ${data.ghostInfo.toPath?.split('/').pop() ?? '?'}`)
            : 'Disappearing'}
        </div>
      )}

      {/* 폴더 더블클릭 힌트 — 클릭/드래그 투과 */}
      {isFolder && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.enter')}
        </div>
      )}

      {/* 에이전트 더블클릭 힌트 */}
      {isAgent && !isBack && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.openIDE')}
        </div>
      )}

      {/* Back 네비게이션 버블 hover 툴팁 — 더블클릭 시 상위 한 단계 복귀 */}
      {isBack && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.goBack')}
        </div>
      )}

      {/* iframe 더블클릭 힌트 */}
      {isIframe && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[12px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.expand')}
        </div>
      )}


      {/* 디버그 모드 — TTL 카운트다운 */}
      <DebugTTL data={data} nodeId={nodeId} nx={xPos} ny={yPos} />
    </div>
  );
});

// ─── 디버그 상태 뱃지 ───

interface DebugTTLProps {
  data: BubbleNodeData;
  nodeId: string;
  nx?: number;
  ny?: number;
}

function DebugTTL({ data, nodeId, nx, ny }: DebugTTLProps): React.JSX.Element | null {
  const debugMode = useGraphStore((s) => s.debugMode);
  if (!debugMode) return null;

  const saved = data.position;
  const nxStr = nx != null ? Math.round(nx) : '?';
  const nyStr = ny != null ? Math.round(ny) : '?';

  // 에이전트 버블 활성 체크 결과 (isSessionInUse)
  const liveness = data.lastLivenessCheck;
  const agoSec = liveness ? Math.round((Date.now() - liveness.timestamp) / 1000) : null;

  return (
    <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
      <div className="whitespace-nowrap rounded bg-black/80 px-2 py-0.5 text-[12px] font-mono text-white">
        {saved && <><span className="text-yellow-400">S({Math.round(saved.x)},{Math.round(saved.y)})</span>{' '}</>}
        <span className="text-cyan-400">N({nxStr},{nyStr})</span>
      </div>
      {liveness && (
        <div
          className={`whitespace-nowrap rounded px-2 py-0.5 text-[12px] font-mono text-white ${
            liveness.inUse ? 'bg-emerald-700/90' : 'bg-rose-700/90'
          }`}
        >
          {liveness.inUse ? 'INUSE' : 'FREE'} · {liveness.durationMs}ms · {agoSec}s ago
        </div>
      )}
    </div>
  );
}
