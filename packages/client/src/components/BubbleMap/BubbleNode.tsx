import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, BubbleStyleConfig } from '@vibisual/shared';
import { BUBBLE_STYLES, HOOK_AGENT_STYLE, BUBBLE_TEXT_WIDTH_RATIO, BUBBLE_TEXT_REF_SIZE, GIT_STATUS_CONFIG } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { useGraphStore, selectIDEOverlay, selectActiveBrainSummary } from '../../stores/graphStore.js';
import { PluginBubbleBadgeSlot } from '../../plugins/host.js';

type BubbleNodeData = BubbleData & Record<string, unknown>;

interface BubbleNodeComponentProps {
  data: BubbleNodeData;
  id: string;
  [key: string]: unknown;
}

// ─── 아이콘 SVG paths — config의 icon 필드로 선택 ───

const ICON_PATHS: Record<BubbleStyleConfig['icon'], { viewBox: string; d: string; fill: boolean }> = {
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
  // §5.10 — Project Brain 버블(두뇌 lobes)
  brain: {
    viewBox: '0 0 24 24',
    d: 'M12 5a3 3 0 0 0-5.6-1.5A2.5 2.5 0 0 0 4 6a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 2 4 3 3 0 0 0 6 .5 3 3 0 0 0 6-.5 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0-2.4-2.5A3 3 0 0 0 12 5Z M12 5v14',
    fill: false,
  },
  // §5.10 — 커스텀 에이전트 휴지통 버블(trash-2)
  trash: {
    viewBox: '0 0 24 24',
    d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6',
    fill: false,
  },
};

function BubbleIcon({ icon, px }: { icon: BubbleStyleConfig['icon']; px?: number }): React.JSX.Element {
  const cfg = ICON_PATHS[icon];
  const s = px ?? 20;
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

function WaveFill({ ratio, color, indeterminate }: { ratio: number; color: string; indeterminate?: boolean }): React.JSX.Element {
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
        {/* indeterminate 모드: 수위 자체가 위아래로 느리게 진동 — "작업 중" 시각화 */}
        {indeterminate && (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur="2.4s"
            repeatCount="indefinite"
            values="0 18; 0 -18; 0 18"
            calcMode="spline"
            keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
          />
        )}
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
/**
 * 더블클릭 가능한 버블(폴더/에이전트/iframe/conti/pipeline/위성/nav)은
 * 단일선택(=DetailPanel 열림)을 이만큼 늦춰 더블클릭 의도를 먼저 확인한다.
 * 이 창 안에 두 번째 클릭이 오면 단일선택을 취소하고 더블클릭 동작만 수행 → 패널 깜빡임 제거.
 */
const SELECT_DEFER_MS = 240;
/** 이 픽셀 이상 움직이면 클릭이 아니라 드래그 — 선택/DetailPanel 이벤트로 새지 않음 */
const DRAG_MOVE_THRESHOLD_PX = 5;
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
const BRAIN_INJECT_PULSE_MS = 1450;

/** §5.10 v3.82 — 주입 아크가 테두리 바깥을 돌 때 stroke 가 잘리지 않도록 두는 여백(px). */
const BRAIN_SWEEP_MARGIN = 6;

/**
 * §5.10 v3.49 — 이 버블의 우측 더블클릭 대상. null 이면 기억 대상 아님.
 *  Brain 상주 버블·커스텀 에이전트(휴지통 내부의 trashed 포함) → 기억 피드 오버레이,
 *  휴지통 상주 버블 → 기존 버블 내부 진입.
 */
type RightDblTarget =
  | { kind: 'brainFeed'; scope: 'project' }
  | { kind: 'agentFeed'; agentId: string }
  | { kind: 'trash' };
function interiorTargetFor(data: BubbleData): RightDblTarget | null {
  if (data.id === '__brain__') return { kind: 'brainFeed', scope: 'project' };
  if (data.id === '__trash__') return { kind: 'trash' };
  if (data.bubbleType === 'agent' && data.customCreated) return { kind: 'agentFeed', agentId: data.id };
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
  // §2.4 v1.67 — 갓 스폰된 커스텀 에이전트 idle empty-state: 라이브 세션 전 빈 하단을 설정 모델명으로 메움
  const configModel = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.model : undefined);
  // §5.11 v3.88 — 플러그인 배지 슬롯에 넘길 읽기 전용 설정. 에이전트 버블이 아니면 undefined 라 슬롯이 그냥 빈다.
  const pluginAgentConfig = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id] : undefined);
  // §5.10 — Brain 상주 버블: 두뇌 요약(카드 수/미확인/최근 제목). brain 타입 버블에서만 의미.
  const brainSummary = useGraphStore((s) => data.bubbleType === 'brain' ? selectActiveBrainSummary(s) : null);
  // §5.10 — 주입 발생 시 Brain 버블에 일시 펄스(4s time-limited). 최근 주입 시각(모든 에이전트 통틀어) max.
  const latestInjectionAt = useGraphStore((s) => {
    if (data.bubbleType !== 'brain') return 0;
    let m = 0;
    for (const list of Object.values(s.brainInjections)) {
      for (const ev of list) if (ev.at > m) m = ev.at;
    }
    return m;
  });
  // §5.10 — 휴지통 배지: 현재 프로젝트의 trashed 에이전트 수.
  //   store.agents 는 전 프로젝트 합본이라 여기서 세면 다른 프로젝트의 휴지통까지 합산된다(§3.5 프로젝트
  //   독립성 위반). 개수는 BubbleMap 이 프로젝트 필터를 거쳐 data.activity 로 실어 보낸다.
  const trashedCount = data.bubbleType === 'trash' ? data.activity : 0;
  const isBrainBubble = data.bubbleType === 'brain';
  const isTrashBubble = data.bubbleType === 'trash';
  // §5.10 v3.86 — 파일 버블의 실수/교훈 마커는 제거됐다. 그 정보는 에이전트가 file-notes 훅 주입으로
  //   본문까지 받으므로(§7.4), 캔버스에는 "지금 행동이 필요한 것"만 남긴다.
  // §5.10 v3.82 — Brain 버블의 두 신호 축. 좌상단 = 새로 저장된 기억(자동 저장분 가시화),
  //   우상단 = 사람 판단을 기다리는 카드(v3.81 — 확인해야 AI 에게 전달되는 유일한 행동 유발 수).
  const brainUnseen = isBrainBubble ? (brainSummary?.unseenCount ?? 0) : 0;
  const brainReview = isBrainBubble ? (brainSummary?.reviewCount ?? 0) : 0;

  // §5.10 v3.82 — 본체에서 뺀 최근 카드 제목 + 두 배지 수치를 네이티브 툴팁으로 모은다.
  //   맨 끝 줄은 우더블클릭(기억 라이브러리)이라는 비자명한 제스처의 발견 경로다.
  const brainBubbleTip = useMemo(() => {
    if (!isBrainBubble) return undefined;
    const lines = [t('brain.tipCards', { defaultValue: '기억 {{n}}장', n: brainSummary?.cardCount ?? 0 })];
    if (brainReview > 0) lines.push(t('brain.tipReview', { defaultValue: '검토 대기 {{n}}장', n: brainReview }));
    if (brainUnseen > 0) lines.push(t('brain.tipUnseen', { defaultValue: '새 기억 {{n}}장', n: brainUnseen }));
    if (brainSummary?.recentCardTitle) {
      lines.push(t('brain.tipRecent', { defaultValue: '최근: {{title}}', title: brainSummary.recentCardTitle }));
    }
    lines.push(t('brain.tipOpen', { defaultValue: '오른쪽 더블클릭 — 기억 라이브러리 열기' }));
    return lines.join('\n');
  }, [isBrainBubble, brainSummary?.cardCount, brainSummary?.recentCardTitle, brainReview, brainUnseen, t]);

  // §5.10 — 주입 펄스: 최근 주입 직후 1회 연출을 켜고, 남은 시간 뒤 자동 해제(무한 애니메이션 방지).
  const [injectionPulse, setInjectionPulse] = useState(false);
  useEffect(() => {
    if (!isBrainBubble || latestInjectionAt <= 0) { setInjectionPulse(false); return; }
    const remain = latestInjectionAt + BRAIN_INJECT_PULSE_MS - Date.now();
    if (remain <= 0) { setInjectionPulse(false); return; }
    setInjectionPulse(true);
    const timer = setTimeout(() => setInjectionPulse(false), remain);
    return () => clearTimeout(timer);
  }, [isBrainBubble, latestInjectionAt]);
  const style = useMemo<BubbleStyleConfig>(() => {
    if (!customColor) return baseStyle;
    return { ...baseStyle, color: customColor, glow: customColor };
  }, [baseStyle, customColor]);
  const localRange = (data as Record<string, unknown>)['_localRange'] as { min: number; max: number } | undefined;
  const globalRange = useGraphStore((s) => s.fileSizeRange);
  const range = localRange ?? globalRange;
  const size = useMemo(() => calcBubbleSize(data, range), [data.activity, data.status, data.bubbleType, data.childCount, data.fileSize, range]);
  // 단일 스케일 팩터 — 모든 텍스트/아이콘이 이 비율로 비례 축소/확대
  const ts = size / BUBBLE_TEXT_REF_SIZE;
  const isActive = data.status === 'active';
  const isCompleted = data.status === 'completed';
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
    data.bubbleType === 'brain' ||
    data.bubbleType === 'trash' ||
    data.id.startsWith('sat-') ||
    data.id === '__root_home__' ||
    data.id === '__pipeline_parent__';
  const isDespawning = !!(data as Record<string, unknown>)._despawning;

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
  const subAgentsMap = useGraphStore((s) => s.subAgents);
  const ideAgentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const ideActiveSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const stickySelectedSubId = useGraphStore((s) => s.selectedSubByAgent[data.id]);
  const effectiveSubOverride = useMemo(() => {
    if (!isAgent || !data.customCreated) return null;
    const subs = subAgentsMap[data.id];
    if (!subs || subs.length === 0) return null;
    const activeSub = subs.find((s) => s.status === 'active');
    if (activeSub) return activeSub;
    // IDE 오버레이가 열려 있고 탭이 선택돼 있으면 그걸 우선 (실시간 클릭 반응)
    if (ideAgentId === data.id && ideActiveSessionId) {
      const selected = subs.find((s) => s.id === ideActiveSessionId);
      if (selected) return selected;
    }
    // IDE 닫혀도 sticky 선택 유지
    if (stickySelectedSubId) {
      const selected = subs.find((s) => s.id === stickySelectedSubId);
      if (selected) return selected;
    }
    return null; // 서버 default 유지
  }, [isAgent, data.customCreated, data.id, subAgentsMap, ideAgentId, ideActiveSessionId, stickySelectedSubId]);

  // override 가 "있으면" 그 sub 기준으로만 일관되게 표기한다.
  // 부분 폴백(모델명만 override, 컨텍스트는 data.* 폴백)을 허용하면 라벨은 #16 인데 게이지는
  // 서버 default(최근 sub)가 그대로 남아 불일치가 발생한다 — 요구사항 위반.
  const effectiveModelName = effectiveSubOverride
    ? effectiveSubOverride.modelName
    : data.modelName;
  const effectiveContextUsed = effectiveSubOverride
    ? effectiveSubOverride.contextUsed
    : data.contextUsed;
  const effectiveContextMax = effectiveSubOverride
    ? effectiveSubOverride.contextMax
    : data.contextMax;

  const contextRatio = isAgent && effectiveContextMax ? (effectiveContextUsed ?? 0) / effectiveContextMax : 0;
  const isCreating = data.creatingStatus === 'creating';
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

  const ringClass = isAwaitingPermission
    ? 'border-amber-400 shadow-lg shadow-amber-400/40 animate-pulse'
    : isActive
      ? style.ringActive
      : isCompleted
        ? 'border-cyan-400 shadow-lg shadow-cyan-400/30'
        : style.ringIdle;

  // 마운트 시 스폰 애니메이션
  const [spawning, setSpawning] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSpawning(false), 300);
    return () => clearTimeout(t);
  }, []);

  // 단일선택 지연 타이머 — 더블클릭 가능한 버블에서 첫 클릭의 selectNode 를 보류.
  const pendingSelectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSelect = useCallback(() => {
    if (pendingSelectRef.current) {
      clearTimeout(pendingSelectRef.current);
      pendingSelectRef.current = null;
    }
  }, []);
  useEffect(() => () => cancelPendingSelect(), [cancelPendingSelect]);

  // 더블클릭 — 열림 애니메이션 (선택과 분리된 순수 시각 효과)
  const [opening, setOpening] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDoubleClick = useCallback(() => {
    // 더블클릭 확정 → 보류 단일선택 취소 + 1타에서 떴던 하이라이트 즉시 해제.
    cancelPendingSelect();
    useGraphStore.getState().setSelectIntent(null);
    if (openTimer.current) clearTimeout(openTimer.current);
    setOpening(true);
    openTimer.current = setTimeout(() => { setOpening(false); openTimer.current = null; }, 500);
  }, [cancelPendingSelect]);

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
  }, [isAgent, isOnBorder, clearHoverTimer]);
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

    if (data.bubbleType === 'agent' && data.status === 'completed') {
      fetch(`/api/dismiss-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: data.id }),
      }).catch(() => {});
    }
  }, [data.id, data.bubbleType, data.status]);

  // press 추적 — 눌렀다 "움직임 없이" 뗐을 때만 클릭(=선택)으로 인정.
  // 임계 초과 이동 = 드래그 → 선택/DetailPanel 이벤트로 새지 않음.
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // pointerdown: 테두리 클릭 → 연결 드래그. 그 외엔 press 시작만 기록(선택은 up 에서).
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // 커스텀 에이전트 테두리 클릭 → 연결 모드 진입 (노드 이동 차단).
    // Hook 에이전트/파이프라인/서브에이전트는 Task Edge 소스가 될 수 없다.
    if (isAgent && data.customCreated && !overlayMode && isOnBorder(e)) {
      e.stopPropagation();
      e.preventDefault();
      startTaskEdgeDrag(data.id, e.clientX, e.clientY);
      pressRef.current = null;
      return;
    }

    // Back 버블은 네비게이션 전용 — 선택 불가 (폴더 back + §5.10 기억 내부 back)
    if (data.id === '__root_back__' || data.id === '__interior_back__') { pressRef.current = null; return; }

    // 더블클릭 가능 버블에서 보류 중 단일선택이 있는데 다시 눌렀다 = 더블클릭 의도.
    // 보류 취소 + 이번 press 는 선택으로 잇지 않도록 moved 로 마킹.
    if (pendingSelectRef.current) {
      cancelPendingSelect();
      useGraphStore.getState().setSelectIntent(null);
      pressRef.current = { x: e.clientX, y: e.clientY, moved: true };
      return;
    }

    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }, [data.id, data.customCreated, isAgent, isOnBorder, startTaskEdgeDrag, cancelPendingSelect]);

  // 임계 초과 이동 → 드래그로 확정. 이후 up 에서 선택 안 함.
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const p = pressRef.current;
    if (!p || p.moved) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_MOVE_THRESHOLD_PX) {
      p.moved = true;
      cancelPendingSelect();
    }
  }, [cancelPendingSelect]);

  // pointerup: 움직임 없이 뗐을 때만 클릭 → 선택. 더블클릭 가능 버블은 지연 선택.
  const handlePointerUp = useCallback(() => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p || p.moved) return; // 드래그였거나 더블클릭 2타 → 선택 없음

    // 링 의도를 즉시 갱신 — 이전 선택 링은 지연 없이 바로 페이드아웃, 이 버블은 바로 페이드인.
    // (DetailPanel=selectedNodeId 는 performSelect 가 더블클릭 지연 후 갱신, 분리됨)
    const store = useGraphStore.getState();
    const intentId = data.id === '__root_home__'
      ? store.currentFolderId
      : (data.id.startsWith('sat-') ? data.id.slice(4) : data.id);
    store.setSelectIntent(intentId);

    if (!isDoubleClickable) { performSelect(); return; }
    cancelPendingSelect();
    pendingSelectRef.current = setTimeout(() => {
      pendingSelectRef.current = null;
      performSelect();
    }, SELECT_DEFER_MS);
  }, [data.id, isDoubleClickable, performSelect, cancelPendingSelect]);

  const handlePointerCancel = useCallback(() => {
    pressRef.current = null;
  }, []);

  // §5.10 — 우측 더블클릭 = 기억(머릿속) 내부 진입. 우클릭 1회는 브라우저 메뉴만 억제하고 통과,
  //   350ms 내 2번째 우클릭이면 내부 진입. 좌클릭 SELECT_DEFER_MS 상태기계는 건드리지 않는다.
  const lastRightClickRef = useRef(0);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // 노드 위 우클릭은 브라우저 기본 메뉴를 항상 억제(캔버스 생성 메뉴는 pane 우클릭 전용).
    e.preventDefault();
    const target = interiorTargetFor(data);
    if (!target) return;
    const now = Date.now();
    if (now - lastRightClickRef.current <= RIGHT_DBLCLICK_MS) {
      lastRightClickRef.current = 0;
      e.stopPropagation();
      cancelPendingSelect();
      const store = useGraphStore.getState();
      store.setSelectIntent(null);
      // §5.10 v3.49 — 좌더블클릭=IDE(작업) / 우더블클릭=기억(머릿속) 대칭.
      if (target.kind === 'trash') store.enterInterior({ kind: 'trash' });
      else if (target.kind === 'brainFeed') store.openBrainFeed({ scope: 'project' });
      else store.openBrainFeed({ scope: 'agent', agentId: target.agentId });
      return;
    }
    lastRightClickRef.current = now;
  }, [data, cancelPendingSelect]);

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

  // ── §5.10 v3.82 Brain 전용 지오메트리 ──
  // 주입 아크는 테두리 바로 바깥을 도므로 stroke 굵기만큼 여백을 준 별도 박스에 그린다.
  const brainSweepBox = size + BRAIN_SWEEP_MARGIN * 2;
  // 배지는 어떤 배율에서도 두 자리 숫자가 읽히도록 하한을 둔다(종전 14px·7px 은 판독 불가였다).
  const brainBadgeSize = Math.max(18, Math.round(21 * ts));
  const brainBadgeFont = Math.max(10, Math.round(12 * ts));

  // 테두리 두께: 기본 2px → 근접 시 4px, 연결 타겟 시 4px + 색상 변경
  const borderWidth = nearBorder || isConnectTarget ? 4 : 2;
  const borderHighlight = isConnectTarget
    ? 'border-cyan-400 shadow-lg shadow-cyan-400/40'
    : nearBorder
      ? 'border-blue-400 shadow-md shadow-blue-400/30'
      : '';

  // §4 v2.63 — 에이전트 종류 구분 배지(라벨 아래): CMD(인터랙티브 터미널) / 커스텀(우리가 오케스트레이션) /
  //   훅(Claude Code 이벤트 캡처). 셋 다 같은 위치·타이포로 색만 달라 한눈에 구분된다. auto 버블(bubbleType='auto')은
  //   고유 별 아이콘이 있어 제외(isAgent=false). 라벨 텍스트는 **영어 고정** — i18n 미대상(사용자 지정).
  const agentBadge = isCmdAgent
    ? { text: 'CMD', cls: 'bg-teal-500/25 text-teal-100' }
    : isAgent && data.customCreated
      ? { text: 'Custom', cls: 'bg-indigo-500/25 text-indigo-100' }
      : isAgent
        ? { text: 'Hook', cls: 'bg-slate-500/30 text-slate-200' }
        : null;

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
          opacity: isDisappearing
            ? disappearOpacity
            : isIframe && data.iframeAlive === false
              ? 0.35
              : undefined,
          transition: 'width 0.45s cubic-bezier(0.4, 0, 0.2, 1), height 0.45s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out',
        },
        cursor: nearBorder ? 'crosshair' : undefined,
      }}
    >
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} />

      {/* §5.10 v3.82 — 주입 1회 연출: 안쪽 블룸 + 림을 도는 아크 스윕(종전 animate-ping 대체).
          아크는 pathLength=100 이라 버블 크기가 변해도 대시 비율이 그대로다. */}
      {isBrainBubble && injectionPulse && (
        <>
          {/* z-10 필수 — 본체 div 가 DOM 상 뒤에 있어 불투명하게 덮으므로, 위로 올려야 표면에서 빛난다. */}
          <span
            className="animate-brain-inject-bloom pointer-events-none absolute inset-0 z-10 rounded-full"
            style={{ background: `radial-gradient(circle at 50% 50%, ${style.glow}00 40%, ${style.glow}59 76%, ${style.glow}00 100%)` }}
          />
          <svg
            className="pointer-events-none absolute z-10"
            width={brainSweepBox}
            height={brainSweepBox}
            viewBox={`0 0 ${brainSweepBox} ${brainSweepBox}`}
            style={{ left: -BRAIN_SWEEP_MARGIN, top: -BRAIN_SWEEP_MARGIN, filter: `drop-shadow(0 0 3px ${style.glow})` }}
            fill="none"
          >
            <circle
              className="animate-brain-inject-sweep"
              cx={brainSweepBox / 2}
              cy={brainSweepBox / 2}
              r={size / 2 + 1}
              pathLength={100}
              // 림 자체가 인디고라 같은 계열로는 아크가 묻힌다 — 흰빛 + glow 번짐으로 "빛이 돈다"로 읽히게.
              stroke="#ffffff"
              strokeOpacity={0.92}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="9 41"
            />
          </svg>
        </>
      )}

      {/* §5.10 v3.82 — 검토 대기 배지(우상단, 앰버): 사용자가 확인해야 AI 에게 전달되는 카드 수.
          Brain 에서 사람 손이 필요한 유일한 수라 가장 눈에 띄는 자리에 둔다. */}
      {isBrainBubble && brainReview > 0 && (
        <span
          className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full bg-amber-400 font-bold text-gray-950 ring-2 ring-gray-950"
          style={{ top: -1, right: -1, minWidth: brainBadgeSize, height: brainBadgeSize, fontSize: brainBadgeFont, padding: '0 4px' }}
          title={t('brain.reviewBadge', { defaultValue: '검토 대기 {{n}}장', n: brainReview })}
        >
          {brainReview > 99 ? '99+' : brainReview}
        </span>
      )}

      {/* §5.10 v3.82 — 새 기억 배지(좌상단, 인디고): 자동 저장돼 아직 사용자가 안 본 카드 수. */}
      {isBrainBubble && brainUnseen > 0 && (
        <span
          className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full bg-indigo-400 font-bold text-gray-950 ring-2 ring-gray-950"
          style={{ top: -1, left: -1, minWidth: brainBadgeSize, height: brainBadgeSize, fontSize: brainBadgeFont, padding: '0 4px' }}
          title={t('brain.unseenBadge', { defaultValue: '미확인 {{n}}장', n: brainUnseen })}
        >
          {brainUnseen > 99 ? '99+' : brainUnseen}
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        style={{
          borderWidth,
          borderStyle: 'solid',
          // 에이전트: 하단 모델/컨텍스트(최대 3줄) + idle 칩 블록 높이만큼 바닥 예약.
          // justify-center 가 이 영역 위에서만 일어나 2줄 라벨이 길어져도 위로 밀려 겹치지 않음.
          // absolute 하단 블록은 padding box 기준이라 이 padding 에 안 밀리고 바닥 유지.
          paddingBottom: isAgent
            ? Math.max(16, Math.round(6 * ts) + Math.round(9 * ts) + Math.round(8 * ts) + Math.round(7 * ts) + Math.round(6 * ts))
            : undefined,
          transition: 'border-width 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          // §5.10 v3.82 — Brain 만 원반이 아니라 구(orb)로: 위 그라디언트는 하이라이트→본색,
          //   아래 그라디언트는 가장자리 비네트. 색은 전부 style 에서 파생하므로 §2.2 팔레트를 벗어나지 않는다.
          background: isCreatingError
            ? 'radial-gradient(circle at 35% 35%, #fca5a5, #ef4444)'
            : isCreating
              ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
              : isAgent && contextRatio > 0
                ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
                : isAgent
                  // §2.4 v1.68/v1.69 — 모든 에이전트(커스텀+훅)는 컨텍스트 물결과 동일한 반투명 배경으로 시작
                  ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
                  : isBrainBubble
                    ? `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.5) 100%), radial-gradient(circle at 33% 27%, ${style.glow} 0%, ${style.color} 50%, ${style.color}D9 100%)`
                    : isActive
                      ? `radial-gradient(circle at 35% 35%, ${style.glow}, ${style.color})`
                      : `radial-gradient(circle at 35% 35%, ${style.glow}90, ${style.color}CC)`,
          // 구면감을 만드는 림라이트(위) + 바닥 그림자(아래). 테두리 하이라이트 상태에서는
          // 그쪽 shadow 클래스를 덮지 않도록 비운다.
          boxShadow: isBrainBubble && !nearBorder && !isConnectTarget
            ? 'inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -13px 20px rgba(30,27,75,0.45)'
            : undefined,
        }}
        title={isBrainBubble ? brainBubbleTip : undefined}
      >
        {/* 에이전트 물결 채움 */}
        {isAgent && contextRatio > 0 && (
          <WaveFill ratio={contextRatio} color={style.color} />
        )}
        {/* §2.4 v1.68 — 커스텀 에이전트는 컨텍스트 전엔 물결 ❌, 반투명 배경만(빈 상태).
            컨텍스트가 쌓이면 위 contextRatio>0 분기의 실측 물결로 자연 등장. */}
        {/* Worktree 생성 중 — 불확정 진행 물결 (수위가 느리게 오르내림) */}
        {isCreating && (
          <WaveFill ratio={0.5} color={style.color} indeterminate />
        )}

        <div className="z-10 flex flex-col items-center justify-center" style={{ gap: Math.max(0, Math.round(4 * ts)) }}>
          <BubbleIcon icon={style.icon} px={Math.max(12, Math.round(32 * ts))} />
          <span
            className={`${isAgent ? 'line-clamp-2 break-words leading-tight' : 'truncate'} text-center font-bold text-white drop-shadow-sm ${isDisappearing ? 'bubble-ghost-label' : ''}`}
            style={{ maxWidth: size * BUBBLE_TEXT_WIDTH_RATIO, fontSize: Math.max(7, Math.round(13 * ts)) }}
            title={isFolder ? (data.absolutePath ?? data.label) : isAgent ? data.label : undefined}
          >
            {data.label}
          </span>
          {agentBadge && (
            <span
              className={`rounded px-1 font-bold uppercase tracking-wide ${agentBadge.cls}`}
              style={{ fontSize: Math.max(5, Math.round(8 * ts)) }}
            >
              {agentBadge.text}
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
          {/* §5.10 v3.82 — Brain 상주 버블: 카드 수 한 줄만. 종전엔 여기에 최근 카드 제목까지
              얹어 8px·6px 두 줄이 겹쳐 있었는데, 축소 배율을 거치면 읽히지 않아 노이즈였다.
              최근 제목은 버블 툴팁·DetailPanel·기억 라이브러리가 담당한다. */}
          {isBrainBubble && (
            <span className="flex items-baseline text-white drop-shadow-sm" style={{ gap: Math.max(1, Math.round(2 * ts)) }}>
              <span className="font-bold tabular-nums" style={{ fontSize: Math.max(13, Math.round(19 * ts)) }}>
                {brainSummary?.cardCount ?? 0}
              </span>
              <span className="font-medium text-white/55" style={{ fontSize: Math.max(10, Math.round(11 * ts)) }}>
                {t('brain.cardCountUnit', { defaultValue: '장' })}
              </span>
            </span>
          )}
          {/* §5.10 — 휴지통 버블: 버려진 에이전트 수 */}
          {isTrashBubble && trashedCount > 0 && (
            <span className="font-semibold text-white/80" style={{ fontSize: Math.max(6, Math.round(9 * ts)) }}>
              {t('brain.trashCountShort', { defaultValue: '{{n}}개', n: trashedCount })}
            </span>
          )}
        </div>

        {/* 에이전트: 모델명 + 컨텍스트 + 토큰 합산.
            버블 본체에는 세션 라벨(서브에이전트 이름)을 표시하지 않는다 — 자동 주제명(첫 프롬프트)이
            긴 문장이라 작은 버블에 노이즈가 된다. 어느 세션 컨텍스트인지는 IDE 탭에서 확인. */}
        {isAgent && effectiveModelName && (
          <div className="absolute z-10 flex flex-col items-center" style={{ bottom: Math.max(3, Math.round(6 * ts)) }}>
            <span className="font-semibold text-white/70" style={{ fontSize: Math.max(5, Math.round(9 * ts)) }}>
              {formatModelName(effectiveModelName)}
            </span>
            {effectiveContextMax && (
              <span className="text-white/50" style={{ fontSize: Math.max(5, Math.round(8 * ts)) }}>
                {formatTokenCount(effectiveContextUsed ?? 0)}/{formatTokenCount(effectiveContextMax)}
              </span>
            )}
            {(data.totalInputTokens ?? 0) > 0 && (
              <span className="text-amber-300/60" style={{ fontSize: Math.max(5, Math.round(7 * ts)) }}>
                {formatTokenCount(data.totalInputTokens ?? 0)}+{formatTokenCount(data.totalOutputTokens ?? 0)}
                {(data.totalInputTokens ?? 0) > (data.ownInputTokens ?? 0) && ' *'}
              </span>
            )}
          </div>
        )}

        {/* §2.4 v1.67/v1.69 — 라이브 세션 전 에이전트 idle empty-state (커스텀+훅 공통).
            effectiveModelName(라이브)이 잡히거나 contextRatio>0(물결)·active 면 위/펄스 경로로 자연 전환.
            configModel(AgentConfig)이 있으면(커스텀) 모델명도 표시, 없으면(훅) idle 칩만. */}
        {isAgent && !effectiveModelName && !isActive && contextRatio === 0 && !isCreating && !isCreatingError && (
          <div className="absolute z-10 flex flex-col items-center" style={{ bottom: Math.max(3, Math.round(6 * ts)) }}>
            {/* §2.4 v1.70 — 라이브 모델/컨텍스트 블록과 동일 타이포 시스템.
                1줄: 모델명(font-semibold text-white/70, 9·ts), 2줄: 상태(text-white/50, 8·ts).
                글리프 ❌ — 라이브 블록처럼 텍스트 행만으로 정돈된 톤 유지. */}
            {configModel && (
              <span className="font-semibold text-white/70" style={{ fontSize: Math.max(5, Math.round(9 * ts)) }}>
                {formatModelName(configModel)}
              </span>
            )}
            <span className="text-white/50" style={{ fontSize: Math.max(5, Math.round(8 * ts)) }}>
              {t('common.bubble.idle')}
            </span>
          </div>
        )}

        {isFolder && (
          <div className="absolute text-white/60" style={{ bottom: Math.max(4, Math.round(8 * ts)), fontSize: Math.max(6, Math.round(10 * ts)) }}>
            {/* §2.1 v1.55 — 외부 폴더는 평탄화로 satellite 만 가지므로 satelliteFileCount 우선.
                내부 폴더는 기존 childCount(직속 하위 폴더 수) 우선. */}
            {data.bubbleType === 'external_folder'
              ? (data.satelliteFileCount ?? data.childCount ?? 0)
              : (data.childCount ?? 0)} files
          </div>
        )}

        {isIframe && (
          <div className="absolute z-10 flex items-center gap-1" style={{ bottom: Math.max(3, Math.round(6 * ts)) }}>
            <span className={`rounded px-1 py-0.5 font-semibold ${data.serverKind === 'frontend' ? 'bg-sky-500/30 text-sky-300' : 'bg-amber-500/30 text-amber-300'}`} style={{ fontSize: Math.max(5, Math.round(9 * ts)) }}>
              {data.serverKind === 'frontend' ? 'FE' : 'BE'}
            </span>
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
          aria-label="awaiting permission"
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
            <p className="line-clamp-6 break-words text-[11px] leading-relaxed text-gray-200">
              {data.summary}
            </p>
          </div>
        </div>
      )}

      {/* Disappearing 상태 뱃지 */}
      {isDisappearing && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700/80 px-2 py-0.5 text-[10px] text-gray-400">
          {isGhost && data.ghostInfo
            ? (data.ghostInfo.changeType === 'deleted' ? 'Deleted' : `Renamed → ${data.ghostInfo.toPath?.split('/').pop() ?? '?'}`)
            : 'Disappearing'}
        </div>
      )}

      {/* 폴더 더블클릭 힌트 — 클릭/드래그 투과 */}
      {isFolder && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.enter')}
        </div>
      )}

      {/* 에이전트 더블클릭 힌트 */}
      {isAgent && !isBack && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.openIDE')}
        </div>
      )}

      {/* Back 네비게이션 버블 hover 툴팁 — 더블클릭 시 상위 한 단계 복귀 */}
      {isBack && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.bubble.hint.goBack')}
        </div>
      )}

      {/* iframe 더블클릭 힌트 */}
      {isIframe && (
        <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
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
      <div className="whitespace-nowrap rounded bg-black/80 px-2 py-0.5 text-[9px] font-mono text-white">
        {saved && <><span className="text-yellow-400">S({Math.round(saved.x)},{Math.round(saved.y)})</span>{' '}</>}
        <span className="text-cyan-400">N({nxStr},{nyStr})</span>
      </div>
      {liveness && (
        <div
          className={`whitespace-nowrap rounded px-2 py-0.5 text-[9px] font-mono text-white ${
            liveness.inUse ? 'bg-emerald-700/90' : 'bg-rose-700/90'
          }`}
        >
          {liveness.inUse ? 'INUSE' : 'FREE'} · {liveness.durationMs}ms · {agoSec}s ago
        </div>
      )}
    </div>
  );
}
