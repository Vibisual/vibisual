import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, BubbleStyleConfig } from '@vibisual/shared';
import { BUBBLE_STYLES, BUBBLE_TEXT_WIDTH_RATIO, BUBBLE_TEXT_REF_SIZE, GIT_STATUS_CONFIG } from '@vibisual/shared';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';

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
  const baseStyle = BUBBLE_STYLES[data.bubbleType];
  // 에이전트 커스텀 색상 — AgentConfig.color가 있으면 기본 스타일 오버라이드
  const customColor = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.color : undefined);
  // §2.4 v1.67 — 갓 스폰된 커스텀 에이전트 idle empty-state: 라이브 세션 전 빈 하단을 설정 모델명으로 메움
  const configModel = useGraphStore((s) => data.bubbleType === 'agent' ? s.agentConfigs[data.id]?.model : undefined);
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
  const isBack = data.id === '__root_back__';
  // 더블클릭으로 동작이 있는 버블 — handleNodeDoubleClick(BubbleMap)과 1:1.
  // 이 버블들만 단일선택을 SELECT_DEFER_MS 만큼 늦춘다(나머지는 즉시 선택 유지).
  const isDoubleClickable =
    isAgent || isFolder || isIframe ||
    data.bubbleType === 'worktree' ||
    data.bubbleType === 'pipeline' ||
    data.bubbleType === 'conti' ||
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
  const effectiveContextSubLabel = effectiveSubOverride
    ? effectiveSubOverride.label
    : data.contextSourceSubLabel;

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
    if (!isAgent) return;
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
    if (isAgent && data.customCreated && isOnBorder(e)) {
      e.stopPropagation();
      e.preventDefault();
      startTaskEdgeDrag(data.id, e.clientX, e.clientY);
      pressRef.current = null;
      return;
    }

    // Back 버블은 네비게이션 전용 — 선택 불가
    if (data.id === '__root_back__') { pressRef.current = null; return; }

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

  // 테두리 두께: 기본 2px → 근접 시 4px, 연결 타겟 시 4px + 색상 변경
  const borderWidth = nearBorder || isConnectTarget ? 4 : 2;
  const borderHighlight = isConnectTarget
    ? 'border-cyan-400 shadow-lg shadow-cyan-400/40'
    : nearBorder
      ? 'border-blue-400 shadow-md shadow-blue-400/30'
      : '';

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

      {/* 바디 — 드래그 핸들 (원/네모 영역만 잡아끌기 가능) */}
      <div
        className={`bubble-body bubble-press absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-full ${borderHighlight || ringClass} ${isDisappearing ? 'bubble-ghost' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
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
          background: isCreatingError
            ? 'radial-gradient(circle at 35% 35%, #fca5a5, #ef4444)'
            : isCreating
              ? `radial-gradient(circle at 35% 35%, ${style.color}40, ${style.color}20)`
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
          {data.lastTool && isActive && size >= 55 && (
            <span style={{ fontSize: Math.max(6, Math.round(11 * ts)) }} className="font-medium text-white/70">
              {data.lastTool}
            </span>
          )}
        </div>

        {/* 에이전트: 모델명 + 컨텍스트 + 토큰 합산.
            커스텀 에이전트의 컨텍스트가 특정 서브에이전트에서 유래했으면 "opus-4-7 / Sub #7" 로 표시 */}
        {isAgent && effectiveModelName && (
          <div className="absolute z-10 flex flex-col items-center" style={{ bottom: Math.max(3, Math.round(6 * ts)) }}>
            <span className="font-semibold text-white/70" style={{ fontSize: Math.max(5, Math.round(9 * ts)) }}>
              {formatModelName(effectiveModelName)}
              {effectiveContextSubLabel ? ` / ${effectiveContextSubLabel}` : ''}
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

      {/* 펄스 링 — active 상태일 때만 표시 */}
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
