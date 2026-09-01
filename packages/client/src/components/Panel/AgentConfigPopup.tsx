import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CMD_CLI_KINDS, type CmdCliKind } from '@vibisual/shared';

/** §4 (CMD ⑧) — 고른 CLI 가 "셸만"인가(모델 칸을 감출지 판정). 표를 읽는다 — 문자열 비교 ❌. */
function cliKindIsShell(kind: CmdCliKind | undefined): boolean {
  return (CMD_CLI_KINDS.find((k) => k.value === (kind ?? 'claude'))?.bin ?? 'claude') === '';
}
import type { AgentConfig, AgentDefinition, AgentProvider } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  CONTI_AGENT_RULES,
  LOCAL_CONTEXT_MIN,
  LOCAL_CONTEXT_MAX,
  LOCAL_DEFAULT_CONTEXT_SIZE,
  LOCAL_TOOL_NAMES,
  isOpusModel,
  supportsFastMode,
  isForwardSubagentTextEnabled,
  resolveAliasToLatest,
  listModelFamilies,
  listEffortLevels,
  parseModelSemver,
  AGENT_MEMORY_SCOPES,
  normalizeAgentMemoryScope,
  normalizeSubagentDepth,
  SUBAGENT_DEPTH_MAX,
  AVAILABLE_PERMISSION_MODES,
  PERMISSION_MODES_WITHOUT_PROMPT,
  AVAILABLE_SETTING_SOURCES,
  AVAILABLE_AUTOCOMPACT_VALUES,
  turnCompactTriggerTokens,
  TURN_COMPACT_TRIGGER_RATIO,
  resolveAutoCompact,
  normalizeBashTimeoutMs,
  BASH_TIMEOUT_MS_MAX,
  BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT,
  BASH_MAX_TIMEOUT_MS_CLI_DEFAULT,
  AGENT_MAX_TURNS_UI_FALLBACK,
  resolveAgentDefaults,
  diffAgentConfigFromDefaults,
  type AgentConfigComparedField,
} from '@vibisual/shared';
import { HexColorPicker } from 'react-colorful';
import { ScrollFade } from '../ScrollFade.js';
import { applyLocalProviderDraft } from './localProviderPayload.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useBackdropDismiss, useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

const API_BASE = '';

// `label` — 저장값(`value`)과 화면에 보일 이름이 다를 때만 쓴다(§4 CLI 사양 추종: 권한 모드
//   `'default'` 의 CLI 표시명은 **manual**, `--autocompact` 의 빈 값은 "미설정"). 저장값을 바꾸면
//   기존 체크포인트를 건드려야 하므로, 바꾸는 것은 이름뿐이다.
interface SelectOption { value: string; description: string; disabled?: boolean; label?: string }

// §4 v2.77 — Model 드롭다운은 더 이상 3종 하드코딩이 아니라 레지스트리 기반 동적 목록(`listModelFamilies`).
//   기본 alias(폴백) 만 상수로 둔다.
const KNOWN_MODEL_FAMILIES = ['opus', 'sonnet', 'haiku'] as const;
// §4 (CLI 사양 추종) — 권한 모드는 설치된 CLI 내부 enum 과 같은 6종. 하드코딩 사본을 두지 않고
//   shared 상수를 그대로 쓴다(CLI 가 값을 늘리면 여기 한 줄이 아니라 shared 한 곳만 고친다).
const PERMISSION_VALUES = AVAILABLE_PERMISSION_MODES;
const ISOLATION_VALUES = ['none', 'worktree'] as const;
// §4 (CLI 사양 추종) — Bash 타임아웃은 사용자가 말하는 단위(초)로 입력받고 저장은 ms(env 가 ms).
//   0 = 미설정 = CLI 기본(기본 2분 / 상한 10분) 유지. 범위 밖은 shared 정규화가 undefined 로 떨어뜨린다.
const bashSecToMs = (sec: number): number | undefined => normalizeBashTimeoutMs(Math.round(sec) * 1000);
const bashMsToSec = (ms: number | undefined): number => (typeof ms === 'number' && ms > 0 ? Math.round(ms / 1000) : 0);
// §4 — Effort 등급은 더 이상 하드코딩하지 않는다. 설치된 `claude --help` 에서 서버가 파싱해
//   `modelRegistry.effortLevels` 로 전달 → `listEffortLevels(registry)` 로 동적 구성(Model 드롭다운과 대칭).
//   CLI 미발견/파싱 실패 시에만 shared `AVAILABLE_EFFORT_LEVELS` 로 폴백.

// ─── Portal Tooltip ───

function HoverTip({ text, children, className }: {
  text: string; children: React.ReactNode; className?: string;
}): React.JSX.Element {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleEnter = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ x: r.left + r.width / 2, y: r.top - 6 });
    }
    setShow(true);
  }, []);

  return (
    <span ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)} className={className ?? 'inline-flex'}>
      {children}
      {show && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] max-w-56 -translate-x-1/2 -translate-y-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-[12px] leading-snug text-gray-300 shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}

function InfoTip({ text }: { text: string }): React.JSX.Element {
  return (
    <HoverTip text={text} className="ml-1 inline-flex cursor-help">
      <svg className="h-3 w-3 text-gray-600 hover:text-gray-400" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="4.5" r="0.8" />
        <rect x="7.2" y="6.5" width="1.6" height="5" rx="0.5" />
      </svg>
    </HoverTip>
  );
}

/**
 * §4 — 이 칸이 **설정 창의 전역 기본값과 다르다**는 표식. 점 하나가 전부다 — 테두리·배경·글자를
 * 더하면 설정 창 자체가 어지러워져 정작 값이 안 읽힌다. 무엇으로 되돌려야 하는지는 hover 에 있다.
 */
function DiffMark({ text }: { text: string }): React.JSX.Element {
  return (
    <HoverTip text={text} className="ml-1 inline-flex cursor-help items-center">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" role="img" aria-label={text} />
    </HoverTip>
  );
}

// ─── Portal Dropdown Hook ───

/** 드롭다운 패널이 뷰포트 가장자리(창 하단 = 작업표시줄 쪽)에 잘리지 않도록 두는 여백. */
const DD_VIEWPORT_MARGIN = 8;
/** 버튼과 패널 사이 간격. */
const DD_GAP = 4;
/** 패널 기본 높이 상한(= Tailwind max-h-72/max-h-80 과 동급). 실측 전 1차 추정에 사용. */
const DD_MAX_HEIGHT = 288;
/** 위/아래 어느 쪽도 넉넉하지 않을 때 그래도 확보하는 최소 높이(내부 스크롤로 소화). */
const DD_MIN_HEIGHT = 120;

/** 버튼 위치·패널 실측 크기·뷰포트 경계를 보고 위/아래(또는 좌측 배치의 세로 위치)를 결정한다.
 *  - 'below': 아래 공간이 모자라고 위가 더 넓으면 **위로 뒤집어** 버튼 상단에 붙인다.
 *  - 'left' : 가로는 버튼 왼쪽 고정, 세로만 뷰포트 안으로 클램프.
 *  패널 실측(scrollHeight)은 maxHeight 클램프와 무관한 콘텐츠 높이라 재측정해도 값이 안정적이다(무한 루프 없음). */
function computeDropdownPos(
  btn: HTMLElement,
  panel: HTMLElement | null,
  placement: 'below' | 'left',
): React.CSSProperties {
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 실측 전(패널 미마운트)에는 상한값으로 가정 — 마운트 직후 layout effect 가 실측으로 보정한다.
  const contentH = Math.min(panel?.scrollHeight ?? DD_MAX_HEIGHT, DD_MAX_HEIGHT);

  if (placement === 'left') {
    const availH = vh - DD_VIEWPORT_MARGIN * 2;
    const h = Math.min(contentH, availH);
    // 기본은 버튼 하단에 맞춰 위로 자라되, 뷰포트 위/아래를 넘으면 안으로 밀어 넣는다.
    const top = Math.min(Math.max(r.bottom - h, DD_VIEWPORT_MARGIN), vh - DD_VIEWPORT_MARGIN - h);
    return { top, right: Math.max(DD_VIEWPORT_MARGIN, vw - r.left + 6), maxHeight: h };
  }

  const spaceBelow = vh - r.bottom - DD_GAP - DD_VIEWPORT_MARGIN;
  const spaceAbove = r.top - DD_GAP - DD_VIEWPORT_MARGIN;
  const flipUp = contentH > spaceBelow && spaceAbove > spaceBelow;

  const panelW = panel?.offsetWidth ?? r.width;
  const left = Math.min(Math.max(r.left, DD_VIEWPORT_MARGIN), Math.max(DD_VIEWPORT_MARGIN, vw - DD_VIEWPORT_MARGIN - panelW));

  if (flipUp) {
    return {
      bottom: vh - r.top + DD_GAP,
      left,
      minWidth: r.width,
      maxHeight: Math.max(DD_MIN_HEIGHT, Math.min(contentH, spaceAbove)),
    };
  }
  return {
    top: r.bottom + DD_GAP,
    left,
    minWidth: r.width,
    maxHeight: Math.max(DD_MIN_HEIGHT, Math.min(contentH, spaceBelow)),
  };
}

function usePortalDropdown(placement: 'below' | 'left' = 'below') {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    setPos(computeDropdownPos(btnRef.current, panelRef.current, placement));
  }, [placement]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      // 1차 추정(패널 실측 전). 마운트 후 layout effect 가 실제 콘텐츠 높이로 보정한다.
      if (!prev) reposition();
      return !prev;
    });
  }, [reposition]);

  const close = useCallback(() => setOpen(false), []);

  // 패널이 실제로 그려진 뒤 실측 높이/너비로 위·아래 배치를 확정(첫 페인트 전에 보정).
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  // 바깥 press 로 닫기 — 드롭다운 안(패널·버튼)에서 시작한 드래그로는 닫히지 않는다(공통 규약).
  useOutsidePressDismiss({ enabled: open, onDismiss: close, refs: [panelRef, btnRef], capture: false });

  useEffect(() => {
    if (!open) return;
    const handleScroll = (e: Event): void => {
      // 드롭다운 내부 스크롤은 무시
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // 창 크기가 바뀌면 남은 공간도 바뀐다 — 닫지 않고 재배치.
    const handleResize = (): void => reposition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open, reposition]);

  return { btnRef, panelRef, open, pos, toggle, close };
}

// ─── Custom Select with Inline Descriptions ───

function CustomSelect({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; disabled?: boolean;
}): React.JSX.Element {
  const { btnRef, panelRef, open, pos, toggle, close } = usePortalDropdown();

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex items-center justify-between rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-left text-sm text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span>{options.find((o) => o.value === value)?.label ?? value}</span>
        <svg className="ml-2 h-3 w-3 text-gray-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
          <polyline points="2 4 6 8 10 4" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={panelRef} className="fixed z-[9999] max-h-72 overflow-y-auto rounded border border-gray-700 bg-gray-800 py-1 shadow-xl scrollbar-thin" style={{ ...pos, maxWidth: 340 }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => { if (opt.disabled) return; onChange(opt.value); close(); }}
              className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${opt.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-blue-500/15'} ${opt.value === value ? 'bg-blue-500/10' : ''}`}
            >
              <span className={`text-xs font-medium ${opt.value === value ? 'text-blue-400' : 'text-gray-200'}`}>{opt.label ?? opt.value}</span>
              <span className="text-[12px] leading-tight text-gray-500">{opt.description}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Tool Chip with Tooltip ───

function ToolChip({ tool, onRemove, variant }: {
  tool: string; onRemove: () => void; variant: 'allowed' | 'blocked';
}): React.JSX.Element {
  const { t } = useTranslation();
  const desc = t(`panel.agentConfig.tools.${tool}`, { defaultValue: '' });
  const colors = variant === 'allowed'
    ? { bg: 'bg-blue-500/15', text: 'text-blue-400', close: 'text-blue-400/60 hover:text-red-400' }
    : { bg: 'bg-red-500/15', text: 'text-red-400', close: 'text-red-400/60 hover:text-red-300' };

  const chip = (
    <span className={`flex items-center gap-1 rounded-full ${colors.bg} px-2.5 py-0.5 text-xs font-medium ${colors.text}`}>
      {tool}
      <button type="button" onClick={onRemove} className={`ml-0.5 ${colors.close}`}>×</button>
    </span>
  );

  return desc ? <HoverTip text={desc} className="inline-flex">{chip}</HoverTip> : chip;
}

// ─── Main Component ───

interface AgentConfigPopupProps {
  agentId: string;
  config: AgentConfig | null;
  currentColor: string;
  onClose: () => void;
}

/** v1.33 — 해당 agent 를 source 로 가진 outbound(primary) 엣지 목록 + 타겟 메타 계산.
 *  엣지 변경은 graphStore.taskEdges WS snapshot 구독으로 자동 재렌더.
 *  v1.38 — `inactive` 플래그 추가(타겟이 설정되어 있고 tools==[])로 프롬프트 비주입 상태를 UI 에 노출. */
function useOutboundEdgesForAgent(agentId: string): Array<{
  edgeId: string;
  command: string;
  returnFormat: string;
  hasArtifact: boolean;
  targetLabel: string;
  targetModel: string;
  targetTools: string[];
  inactive: boolean;
}> {
  const taskEdges = useGraphStore((s) => s.taskEdges);
  const agents = useGraphStore((s) => s.agents);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);

  return useMemo(() => {
    const all = Object.values(taskEdges);
    const primaryOutbound = all.filter(
      (e) => e.sourceAgentId === agentId && (e.bundleRole ?? 'primary') === 'primary',
    );
    return primaryOutbound.map((edge) => {
      const target = agents.find((a) => a.id === edge.targetAgentId);
      const cfg = agentConfigs[edge.targetAgentId];
      const artifact = edge.bundleId
        ? all.find((e) => e.bundleId === edge.bundleId && e.bundleRole === 'auto-artifact')
        : undefined;
      const inactive = cfg !== undefined && cfg.tools.length === 0;
      return {
        edgeId: edge.id,
        command: edge.command,
        returnFormat: edge.returnFormat ?? 'summary',
        hasArtifact: Boolean(artifact),
        targetLabel: target?.label ?? edge.targetAgentId,
        targetModel: cfg?.model ?? 'unknown',
        targetTools: cfg?.tools ?? [],
        inactive,
      };
    });
  }, [taskEdges, agents, agentConfigs, agentId]);
}

/** v1.37 — STRICT outbound 엣지의 타겟 툴 합집합(소스에서 박탈될 툴).
 *  서버 computeStrictStripSet 과 동일 규칙 — 툴은 전부 사용자 책임이라 특수 예외 없음.
 *  v1.38 — 타겟 tools==[] 엣지는 viability 필터로 skip(서버와 동일 판정).
 *  v1.44 — commandMode 게이트로 변경. 박탈 조건:
 *    - kind === 'command' (artifact/request/critique 는 박탈 ❌)
 *    - commandMode === 'tool-delegation' (shared / mode-delegation 은 박탈 ❌)
 *    - commandMode === undefined 인 기존 엣지는 delegationPolicy === 'strict' 일 때만 박탈
 *      (= v1.37~v1.43 거동 보존, 후방호환). */
function useStrictStripSet(agentId: string): Set<string> {
  const taskEdges = useGraphStore((s) => s.taskEdges);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  return useMemo(() => {
    const strip = new Set<string>();
    for (const edge of Object.values(taskEdges)) {
      if (edge.sourceAgentId !== agentId) continue;
      if ((edge.bundleRole ?? 'primary') !== 'primary') continue;
      if ((edge.kind ?? 'command') !== 'command') continue;
      const stripping = edge.commandMode !== undefined
        ? edge.commandMode === 'tool-delegation'
        : (edge.delegationPolicy ?? 'strict') === 'strict';
      if (!stripping) continue;
      const cfg = agentConfigs[edge.targetAgentId];
      if (cfg && cfg.tools.length === 0) continue;
      for (const tool of (cfg?.tools ?? [])) strip.add(tool);
    }
    return strip;
  }, [taskEdges, agentConfigs, agentId]);
}

function AutoEdgeSection({
  agentId,
  compact,
}: { agentId: string; compact?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const edges = useOutboundEdgesForAgent(agentId);
  if (edges.length === 0) {
    return compact ? null : (
      <div className="rounded border border-gray-800 bg-gray-950/40 px-2.5 py-2 text-[12px] text-gray-600">
        {t('panel.agentConfig.autoEdge.empty')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-indigo-800/50 bg-indigo-950/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-[12px] uppercase tracking-wider text-indigo-300">
          <svg viewBox="0 0 24 24" className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          {t('panel.agentConfig.autoEdge.title')}
        </span>
        <span className="text-[12px] text-indigo-500/70">{edges.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {edges.map((e) => {
          const rowCls = e.inactive
            ? 'rounded bg-gray-800/50 px-2 py-1 text-[12px] text-gray-500 opacity-70'
            : 'rounded bg-indigo-950/30 px-2 py-1 text-[12px] text-indigo-100';
          const labelCls = e.inactive
            ? 'font-semibold text-gray-400 line-through decoration-gray-500/60'
            : 'font-semibold text-indigo-200';
          const metaCls = e.inactive ? 'text-[12px] text-gray-500' : 'text-[12px] text-indigo-400/80';
          const usageCls = e.inactive ? 'mt-0.5 text-gray-500' : 'mt-0.5 text-indigo-100/90';
          const usagePh = e.inactive ? 'text-gray-600' : 'text-indigo-300/50';
          return (
            <div key={e.edgeId} className={rowCls}>
              <div className="flex items-center gap-1.5">
                <span className={labelCls}>→ {e.targetLabel}</span>
                <span className={metaCls}>
                  {e.targetModel}
                  {e.inactive
                    ? ` · ${t('panel.agentConfig.autoEdge.toolsNone')}`
                    : (e.targetTools.length > 0 ? ` · ${e.targetTools.join(', ')}` : '')}
                </span>
              </div>
              {!compact && (
                <>
                  <div className={usageCls}>{t('panel.agentConfig.autoEdge.usage')} {e.command || <span className={usagePh}>{t('panel.agentConfig.autoEdge.unspecified')}</span>}</div>
                  <div className={metaCls + ' mt-0.5'}>
                    returnFormat: {e.returnFormat} · {e.hasArtifact ? t('panel.agentConfig.autoEdge.sync') : t('panel.agentConfig.autoEdge.async')}
                  </div>
                  {e.inactive && (
                    <div className="mt-0.5 flex items-start gap-1 text-[12px] text-amber-400/80">
                      <svg viewBox="0 0 24 24" className="mt-px h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      <span>{t('panel.agentConfig.autoEdge.inactiveWarn')}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {!compact && (
        <div className="mt-1 text-[12px] text-indigo-500/70">
          {t('panel.agentConfig.autoEdge.footnote')}
        </div>
      )}
    </div>
  );
}

export function AgentConfigPopup({ agentId, config, currentColor, onClose }: AgentConfigPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  // §4 (설정 3층) — 저장분이 아직 없는 버블의 기본값도 **설정 창을 따른다**. 종전에는 내장
  //   기본값으로 떨어져, 같은 질문("이 에이전트의 기본은 무엇인가")에 이 창과 서버가 서로 다른
  //   답을 했다 — 그 상태로 저장을 누르면 사용자가 고른 적 없는 내장 값이 그 버블에 못 박혔고,
  //   창을 열자마자 모든 칸에 "기본값과 다름" 점이 붙었다.
  const userDefaults = useGraphStore((st) => st.userDefaults);
  const base = config ?? { ...resolveAgentDefaults(userDefaults), color: currentColor };
  // §5.19 (G) — 이 버블이 **내 PC 에서 도는 모델**인가. 아래 화면의 모든 갈림이 이 한 줄만 본다.
  //   `provider` 는 창을 열어 둔 사이에도 왕복마다 갱신되므로(문맥 게이지·누적 토큰) `base` 사본이
  //   아니라 **지금 값**(`config`)을 읽는다 — 사본을 그리면 열어 둔 창만 과거를 보여 준다.
  const provider = config?.provider;
  const isLocal = provider?.kind === 'local-llama';
  // §4 (CMD ⑧) — 이 버블이 임베디드 터미널(CMD)인가. `executionMode` 는 이 창이 만지지 않는
  //   정체성 축이라 **지금 값**(config)을 읽는다.
  const isCmdAgent = config?.executionMode === 'interactive-terminal';
  // v1.37 — STRICT outbound 엣지 타겟 툴은 소스에서 박탈(회색 표시). 서버 dispatch strip 과 동일.
  const strictStripSet = useStrictStripSet(agentId);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);

  // §4 v2.77 — Model 드롭다운을 레지스트리 기반 동적 목록으로. 기본 alias 3종은 항상 포함,
  //   CLI-scan/`/v1/models` 가 발견한 신규 패밀리(fable/mythos 등)도 자동 추가. known 3종은 전용 설명,
  //   미지 패밀리는 displayName(있으면) + 공통 'unknown' 설명으로 폴백.
  const MODEL_OPTIONS: SelectOption[] = useMemo(() => {
    const known = new Set<string>(KNOWN_MODEL_FAMILIES);
    return listModelFamilies(modelRegistry).map((fam) => {
      if (known.has(fam)) return { value: fam, description: t(`panel.agentConfig.model.${fam}`) };
      const latest = modelRegistry?.entries.find((e) => e.family === fam && e.isLatestOfFamily)
        ?? modelRegistry?.entries.find((e) => e.family === fam);
      const label = latest?.displayName ?? fam;
      return {
        value: fam,
        description: t('panel.agentConfig.model.unknown', {
          defaultValue: '{{name}} — newly released model. Capabilities and cost inferred from family defaults.',
          name: label,
        }),
      };
    });
  }, [t, modelRegistry]);
  // §4 (CLI 사양 추종) — 저장값 `'default'` 의 CLI 표시명은 **manual** 이라 이름만 바꿔 보여준다
  //   (저장값을 바꾸면 기존 에이전트 설정을 전부 마이그레이션해야 하고, CLI 내부 enum 도 여전히 `default` 다).
  const PERMISSION_OPTIONS: SelectOption[] = useMemo(() => PERMISSION_VALUES.map((v) => ({
    value: v,
    label: v === 'default' ? 'manual' : v,
    description: t(`panel.agentConfig.permissionMode.${v}`),
  })), [t]);
  const ISOLATION_OPTIONS: SelectOption[] = useMemo(() => ISOLATION_VALUES.map((v) => ({ value: v, description: t(`panel.agentConfig.isolation.${v}`) })), [t]);
  // §4 (CLI 사양 추종) — `--autocompact`. 맨 앞 빈 값은 "미설정" = **설정 창의 전역 기본을 따름**
  //   (플래그 없음 ❌ — 그 뜻이었다면 CLI 기본인 창 전체가 되어 사실상 압축이 사라진다).
  //   종전처럼 CLI 판단에 맡기려면 `'auto'` 를 고른다.
  const AUTOCOMPACT_OPTIONS: SelectOption[] = useMemo(() => AVAILABLE_AUTOCOMPACT_VALUES.map((v) => ({
    value: v,
    label: v === '' ? t('panel.agentConfig.autoCompact.unsetLabel') : v === 'auto' ? 'auto' : `${Number(v) / 1000}k`,
    description: v === ''
      ? t('panel.agentConfig.autoCompact.unset')
      : v === 'auto'
        ? t('panel.agentConfig.autoCompact.auto')
        : t('panel.agentConfig.autoCompact.tokens', { tokens: `${Number(v) / 1000}k` }),
  })), [t]);
  // §5.3 v4.89 — 자기 기억 범위. 'default' 는 저장하지 않는 값(= 레포 공용 기억)이라 목록 맨 앞에 둔다.
  const MEMORY_OPTIONS: SelectOption[] = useMemo(() => (
    ['default', ...AGENT_MEMORY_SCOPES].map((v) => ({ value: v, description: t(`panel.agentConfig.memory.${v}`) }))
  ), [t]);
  // §4 — 설치된 CLI 가 실제로 받는 effort 등급(`modelRegistry.effortLevels`) 기반 동적 목록.
  //   known 등급은 전용 설명, CLI 가 새로 노출한 미지 등급은 공통 'unknown' 설명으로 폴백.
  const EFFORT_OPTIONS: SelectOption[] = useMemo(() => listEffortLevels(modelRegistry).map((v) => ({
    value: v,
    description: t(`panel.agentConfig.effort.${v}`, {
      defaultValue: t('panel.agentConfig.effort.unknown', {
        defaultValue: '{{name}} — reasoning effort level supported by the installed CLI.',
        name: v,
      }),
    }),
  })), [t, modelRegistry]);
  // §4 (CLI 사양 추종) — 목록을 손으로 따로 적으면 도구가 늘 때마다 여기만 빠진다(실제로 `TodoWrite` 가
  //   그래서 설명 자리에 키 문자열이 그대로 찍혔다). 도구 목록 SSOT 를 그대로 돌고, 번역이 없는 도구는
  //   빈 문자열로 두어 설명 줄 자체가 생기지 않게 한다.
  const TOOL_DESCRIPTIONS: Record<string, string> = useMemo(() => Object.fromEntries(
    AVAILABLE_AGENT_TOOLS.map((tool) => [tool, t(`panel.agentConfig.tools.${tool}`, { defaultValue: '' })]),
  ), [t]);
  const FIELD_TIPS = useMemo(() => ({
    model: t('panel.agentConfig.fieldTips.model'),
    permissionMode: t('panel.agentConfig.fieldTips.permissionMode'),
    rules: t('panel.agentConfig.fieldTips.rules'),
    tools: t('panel.agentConfig.fieldTips.tools'),
    maxTurns: t('panel.agentConfig.fieldTips.maxTurns'),
    maxBudgetUsd: t('panel.agentConfig.fieldTips.maxBudgetUsd'),
    isolation: t('panel.agentConfig.fieldTips.isolation'),
    memory: t('panel.agentConfig.fieldTips.memory'),
    subagentDepth: t('panel.agentConfig.fieldTips.subagentDepth'),
    effort: t('panel.agentConfig.fieldTips.effort'),
    skills: t('panel.agentConfig.fieldTips.skills'),
    color: t('panel.agentConfig.fieldTips.color'),
  }), [t]);

  const [model, setModel] = useState(base.model);
  // §4 (CMD ⑧) — 이 CMD 버블이 띄울 CLI. CMD(임베디드 터미널) 버블에서만 의미가 있어
  //   아래 화면에서도 그 경우에만 칸이 뜬다(헤드리스는 이 값을 읽지 않는다).
  const [cliKind, setCliKind] = useState<CmdCliKind | undefined>(base.cliKind);
  // 순수 셸이면 모델 칸이 가리키는 대상이 없다 — 빈칸을 남기느니 감춘다.
  const isShellOnly = isCmdAgent && cliKindIsShell(cliKind);
  // §4 v2.38 — 특정 풀ID 핀. undefined = alias=latest 모드.
  const [modelVersion, setModelVersion] = useState<string | undefined>(base.modelVersion);
  // §5.5 #17-20 ⑥ v4.74 — 이 창에는 UI 가 없지만 저장할 때 함께 실어 보내야 하는 값(통과용).
  //   IDE 디버그 뷰에서 켠 MCP 도구 선택이 이 창의 [저장]으로 꺼지지 않게 한다.
  const mcpServers = base.mcpServers;
  // v1.37 — 툴 구성은 사용자 책임 (Bash 등 자동 포함 없음).
  const [tools, setTools] = useState<string[]>([...base.tools]);
  const [permissionMode, setPermissionMode] = useState(base.permissionMode);
  // §5.3 #12-1 v1.90 — 60초 무응답 fallback (기본 allow). bypass/plan 이면 UI 숨김(무의미).
  const [permissionTimeoutPolicy, setPermissionTimeoutPolicy] = useState<'allow' | 'deny'>(
    base.permissionTimeoutPolicy ?? 'allow',
  );
  // §5.3 #28 v1.47 — Vibisual Custom Mode (conti/review/debug). undefined='none'
  const [customMode, setCustomMode] = useState<'none' | 'conti' | 'review' | 'debug'>(base.customMode ?? 'none');
  const [skills, setSkills] = useState<string[]>([...base.skills]);
  const [color, setColor] = useState(base.color ?? currentColor);
  const [maxTurns, setMaxTurns] = useState(base.maxTurns ?? 3000);
  // §4 v2.88 — API 비용 상한($). 0 = 무제한(기본). 양수면 헤드리스 스폰에 --max-budget-usd 전달.
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(base.maxBudgetUsd ?? 0);
  const [isolation, setIsolation] = useState(base.isolation ?? 'none');
  // §5.3 v4.89 — 자기 기억 범위 · 서브에이전트 중첩 깊이. 둘 다 미지정이 기본(CLI 기본 동작 유지).
  const [memory, setMemory] = useState<string>(base.memory ?? 'default');
  const [subagentDepth, setSubagentDepth] = useState<number>(base.subagentDepth ?? 0);
  const [effort, setEffort] = useState(base.effort ?? 'default');
  // §4 (CLI 사양 추종) — 설치된 CLI 가 받는 신규 옵션들. 전부 "미설정"이 기본이고, 미설정이면
  //   해당 플래그를 아예 붙이지 않아 종전과 같은 인자로 스폰된다.
  const [fallbackModel, setFallbackModel] = useState(base.fallbackModel ?? '');
  // §4 (CLI 사양 추종) — 폴백 모델은 드롭다운이 기본이고, 목록에 없는 값(정확한 버전 id·콤마
  //   목록·구버전 저장분)일 때만 '직접 입력'으로 연다. 목록에 없다고 값을 버리면 사용자가 넣어
  //   둔 설정이 창을 여는 것만으로 사라진다.
  const [fallbackCustom, setFallbackCustom] = useState(() => {
    const v = (base.fallbackModel ?? '').trim();
    return v !== '' && !listModelFamilies(modelRegistry).includes(v);
  });
  const [autoCompact, setAutoCompact] = useState(base.autoCompact ?? '');
  const [excludeDynamicSections, setExcludeDynamicSections] = useState(base.excludeDynamicSystemPromptSections === true);
  const [settingSources, setSettingSources] = useState<string[]>([...(base.settingSources ?? [])]);
  const [safeMode, setSafeMode] = useState(base.safeMode === true);
  const [agentCanCompact, setAgentCanCompact] = useState(base.agentCanCompact === true);
  // §4 (Fast 모드) — 같은 Opus 를 출력 속도만 빠르게. 플래그가 아니라 settings 키라 서버가
  //   `--settings` 파일 한 장에 실어 보낸다. 미설정(false) 이면 그 키 자체가 안 생긴다.
  const [fastMode, setFastMode] = useState(base.fastMode === true);
  // §4 (스트림 3종) — CLI 가 주는데 우리가 안 받던 것들. ①은 기본 켬이라 판정 함수를 거친다.
  const [forwardSubagentText, setForwardSubagentText] = useState(isForwardSubagentTextEnabled(base.forwardSubagentText));
  const [replayUserMessages, setReplayUserMessages] = useState(base.replayUserMessages === true);
  const [promptSuggestions, setPromptSuggestions] = useState(base.promptSuggestions === true);
  // §4 (CLI 사양 추종) — 훅 생명주기를 스트림에도. 켜면 대화록에 훅 줄이 시간순으로 끼어든다.
  const [includeHookEvents, setIncludeHookEvents] = useState(base.includeHookEvents === true);
  const [betas, setBetas] = useState((base.betas ?? []).join(', '));
  // §4 (CLI 사양 추종) — 이 세션에만 존재하는 서브에이전트 정의(`--agents`). 파일을 만들지 않는다.
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinition[]>(
    () => (base.agentDefinitions ?? []).map((d) => ({ ...d })),
  );
  // §4 (CLI 사양 추종) — 세션 한정 플러그인 폴더(`--plugin-dir`). **줄 단위**로 받는다 —
  //   경로에 쉼표가 들어갈 수 있어 쉼표 구분(betas 방식)을 쓰면 그 경로가 두 조각으로 잘린다.
  const [pluginDirs, setPluginDirs] = useState((base.pluginDirs ?? []).join('\n'));
  // §4 (CLI 사양 추종) — Bash 타임아웃(초). 0 = 미설정. 상한 쪽이 "600초에서 걸린다"를 푸는 축.
  const [bashDefaultTimeoutSec, setBashDefaultTimeoutSec] = useState(bashMsToSec(base.bashDefaultTimeoutMs));
  const [bashMaxTimeoutSec, setBashMaxTimeoutSec] = useState(bashMsToSec(base.bashMaxTimeoutMs));
  // §4 v1.53 — disallowedTools UI 노출 (Tools 아래 빨간 칩 라인)
  const [disallowedTools, setDisallowedTools] = useState<string[]>([...(base.disallowedTools ?? [])]);
  // §4 v1.53 — Opus 1M 컨텍스트 토글. **기본 ON** — undefined/'1m' 둘 다 체크, '200k' 만 언체크.
  const [contextWindow, setContextWindow] = useState<'1m' | '200k' | undefined>(base.contextWindow);
  const oneMillionEnabled = contextWindow !== '200k';
  // §4 v1.53 — 프리셋 트레이스 (UI 제거됨, 기존 값은 save 시 그대로 보존)
  const [presetId] = useState<string | undefined>(base.presetId);
  const [rules, setRules] = useState(base.rules ?? '');
  // §5.19 (G) — 로컬 버블에서만 서는 세 칸. 입력 중에는 문자열이고 저장할 때 숫자로 굳는다
  //   (숫자 상태로 들고 있으면 지우는 도중의 빈 칸이 0 으로 튄다).
  const [localContext, setLocalContext] = useState(
    String(base.provider?.contextSize ?? LOCAL_DEFAULT_CONTEXT_SIZE),
  );
  // 비워 두면 엔진 기본값 — "0" 과 "안 정함"은 다르다(0 은 항상 같은 말만 하는 설정이다).
  const [localTemperature, setLocalTemperature] = useState(
    typeof base.provider?.temperature === 'number' ? String(base.provider.temperature) : '',
  );
  // §5.19 (H) — 도구 강등(`toolSupport='none'`)은 **판정**이지 사용자가 정한 값이 아니다.
  //   잘못 박히면 그 버블은 영영 파일을 못 보므로 되돌릴 손잡이가 화면에 있어야 한다.
  const [retryToolSupport, setRetryToolSupport] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  // §5.3 #28 (K) v1.48 — Rules 히스토리 미리보기 선택 (null=텍스트영역, ts=해당 항목 본문)
  const [historyPreviewTs, setHistoryPreviewTs] = useState<number | null>(null);
  const rulesHistory = base.rulesHistory ?? [];
  const [saving, setSaving] = useState(false);
  const [contextItems, setContextItems] = useState<{ name: string; type: string; summary?: string; lines?: number; path?: string }[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string; source: 'project' | 'global' | 'plugin'; pluginName?: string }[]>([]);

  // §5.5 #17-6 v2.73 — 오버레이 위젯 창 토글(packaged Electron + customCreated 한정).
  const overlayAgentIds = useGraphStore((s) => s.overlayAgentIds);
  const isCustomAgent = useGraphStore(
    (s) => (s.nodeMap[agentId] as { customCreated?: boolean } | undefined)?.customCreated ?? false,
  );
  const hasOverlayApi = typeof window !== 'undefined' && !!window.api?.overlay;
  const isInOverlay = overlayAgentIds.includes(agentId);
  const handleToggleOverlay = useCallback(() => {
    const ov = window.api?.overlay;
    if (!ov) return;
    if (isInOverlay) {
      void ov.close(agentId);
      return;
    }
    const projectId = useGraphStore.getState().agentProjects[agentId];
    if (!projectId) return;
    void ov.open({ agentId, projectId });
  }, [agentId, isInOverlay]);

  // §5.19 (B)(G) — 모델을 바꾸는 자리는 **이미 있는 설치 창** 하나뿐이다(새 창 ❌ — 카탈로그·받기·
  //   삭제가 거기 있고, 상태바 뱃지도 같은 창을 연다). 이 창은 닫는다 — 두 창이 겹쳐 뜨면 어느 쪽이
  //   지금 값인지 알 수 없고, 그쪽에서 모델을 매면 여기 열려 있던 값은 이미 옛것이다.
  const openLocalModelWindow = useGraphStore((s) => s.openLocalModelWindow);
  const handleSwitchLocalModel = useCallback(() => {
    openLocalModelWindow(agentId);
    onClose();
  }, [openLocalModelWindow, agentId, onClose]);

  const toolPicker = usePortalDropdown();
  const skillPicker = usePortalDropdown('left');
  // §4 v1.53 — disallowedTools 추가용 picker (별도 인스턴스)
  const denyPicker = usePortalDropdown();

  // Fetch project context + available skills on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/project-context`)
      .then((r) => r.json())
      .then((data: { ok: boolean; items: typeof contextItems }) => {
        if (data.ok) setContextItems(data.items);
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/available-skills`)
      .then((r) => r.json())
      .then((data: { ok: boolean; skills: typeof availableSkills }) => {
        if (data.ok) setAvailableSkills(data.skills);
      })
      .catch(() => {});
  }, []);

  const isOpus = model === 'opus';

  const backdrop = useBackdropDismiss(onClose);
  const closeRulesEditor = useCallback(() => setShowRulesEditor(false), []);
  const rulesBackdrop = useBackdropDismiss(closeRulesEditor);

  // Esc — **캡처 단계에서 소비한다**. 종전에는 버블 단계에서 듣고 전파를 끊지 않아, 같은 Esc 가
  //   `window` 에 붙은 다른 리스너(특히 IDE 창 닫기)까지 함께 발동했다 — 설정창을 닫으려 한 번
  //   눌렀을 뿐인데 뒤에 있던 IDE 창까지 닫혔다. 규칙 편집기가 열려 있으면 그것부터 닫는다
  //   (안쪽 창이 열려 있는데 바깥 창이 먼저 닫히면 편집 중이던 글이 사라진다).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (showRulesEditor) {
        setShowRulesEditor(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose, showRulesEditor]);

  const handleModelChange = useCallback((v: string) => {
    setModel(v);
    if (v !== 'opus') setEffort('default');
    // §4 v2.38 — 패밀리 변경 시 기존 modelVersion 핀 무효 → alias=latest 모드로 복귀
    setModelVersion(undefined);
  }, []);

  // §4 v2.41 — 현재 패밀리(alias) 의 버전 옵션 목록 (compact).
  // CLI 바이너리 raw scan 결과에서 패밀리 필터 + semver 내림차순.
  // VSCode 스타일로 **최신 + 직전 1개** 만 노출 → 총 2 + Latest(alias) + Custom = 최대 4 옵션.
  const VERSION_OPTIONS = useMemo((): SelectOption[] => {
    // §4 v2.77 — opus/sonnet/haiku 화이트리스트 제거. 현재 선택된 패밀리(alias) 에 해당하는
    //   레지스트리 entry 가 있으면 그대로 버전 목록을 구성(신규 패밀리도 동일 경로).
    const family = model || null;
    if (!family) return [];
    const fams = (modelRegistry?.entries ?? []).filter((e) => e.family === family);
    fams.sort((a, b) => {
      const [aMaj, aMin] = parseModelSemver(a.id);
      const [bMaj, bMin] = parseModelSemver(b.id);
      if (aMaj !== bMaj) return bMaj - aMaj;
      if (aMin !== bMin) return bMin - aMin;
      return b.id.localeCompare(a.id);
    });
    // 최신 + 직전 1개만 (사용자가 핀한 modelVersion 이 그 둘에 없으면 추가로 포함 — 표시 유지)
    const topTwo = fams.slice(0, 2).map((e) => e.id);
    const visible = new Set(topTwo);
    if (modelVersion && !visible.has(modelVersion)) visible.add(modelVersion);
    const latestId = resolveAliasToLatest(family, modelRegistry);
    const latestLabel = latestId
      ? t('panel.agentConfig.modelVersion.latestWith', { defaultValue: 'Latest ({{id}})', id: latestId })
      : t('panel.agentConfig.modelVersion.latest', { defaultValue: 'Latest (alias)' });
    const opts: SelectOption[] = [{ value: '__latest__', description: latestLabel }];
    for (const e of fams) {
      if (!visible.has(e.id)) continue;
      opts.push({ value: e.id, description: e.id });
    }
    opts.push({ value: '__custom__', description: t('panel.agentConfig.modelVersion.custom', { defaultValue: 'Custom…' }) });
    return opts;
  }, [model, modelRegistry, modelVersion, t]);

  // 현재 modelVersion 이 옵션 리스트에 있는지 — 없으면 Custom 모드(사용자 직접 타이핑)
  const isCustomVersion = useMemo(() => {
    if (!modelVersion) return false;
    return !(modelRegistry?.entries ?? []).some((e) => e.id === modelVersion);
  }, [modelVersion, modelRegistry]);

  const effectiveVersionValue = modelVersion
    ? (isCustomVersion ? '__custom__' : modelVersion)
    : '__latest__';

  const handleVersionChange = useCallback((v: string) => {
    if (v === '__latest__') setModelVersion(undefined);
    else if (v === '__custom__') setModelVersion((prev) => prev ?? `claude-${model}-`);
    else setModelVersion(v);
  }, [model]);

  // §4 (CLI 사양 추종) — `--fallback-model` 선택지. 종전에는 자유 입력이라 모델 이름을 외워
  //   타이핑해야 했고, 오타는 스폰이 죽고 나서야 드러났다. 목록은 Model 드롭다운과 **같은
  //   레지스트리**(`MODEL_OPTIONS` = `listModelFamilies`)를 그대로 쓴다 — 이 파일에 모델 이름을
  //   박지 않으므로 CLI/`/v1/models` 가 새 패밀리를 내면 여기에도 저절로 생긴다.
  //   맨 끝 '직접 입력'은 종전 자유 입력을 잃지 않기 위한 자리다(콤마 목록·정확한 버전 id).
  const FALLBACK_MODEL_OPTIONS: SelectOption[] = useMemo(() => ([
    {
      value: '',
      label: t('panel.agentConfig.fallbackModel.unsetLabel'),
      description: t('panel.agentConfig.fallbackModel.unset'),
    },
    ...MODEL_OPTIONS,
    {
      value: '__custom__',
      label: t('panel.agentConfig.fallbackModel.customLabel'),
      description: t('panel.agentConfig.fallbackModel.custom'),
    },
  ]), [t, MODEL_OPTIONS]);
  const effectiveFallbackValue = fallbackCustom ? '__custom__' : fallbackModel.trim();
  const handleFallbackChange = useCallback((v: string) => {
    // '직접 입력'은 지금 값을 그대로 둔 채 입력칸만 연다 — 고른 순간 값이 지워지면 안 된다.
    if (v === '__custom__') { setFallbackCustom(true); return; }
    setFallbackCustom(false);
    setFallbackModel(v);
  }, []);

  // §4 v2.41 — Model 셀렉트 바로 아래 작은 글씨 라벨: CLI 에 실제로 전달될 모델 인자.
  // alias 모드면 "opus[1m]" 식, 풀ID 핀이면 "claude-opus-4-7[1m]" 식.
  const effectiveCliArg = useMemo(() => {
    const base = modelVersion?.trim() || model;
    const suffix = (model === 'opus' && contextWindow !== '200k') ? '[1m]' : '';
    return base + suffix;
  }, [model, modelVersion, contextWindow]);

  // §4 (Fast 모드) — Opus 계열에서만 실제로 켜진다. 판정 대상은 `--model` 로 나가는 값과 같아야
  //   하므로 풀ID 핀을 alias 보다 먼저 본다(서버 `wantsFastMode` 와 같은 규칙).
  const fastModeSupported = useMemo(
    () => supportsFastMode(modelVersion?.trim() || model),
    [model, modelVersion],
  );

  const removeTool = useCallback((t: string) => setTools((p) => p.filter((x) => x !== t)), []);
  const removeSkill = useCallback((s: string) => setSkills((p) => p.filter((x) => x !== s)), []);

  const addSkill = useCallback((name: string) => {
    setSkills((p) => p.includes(name) ? p : [...p, name]);
  }, []);

  /**
   * §5.19 (G) — 저장할 `provider` 한 벌.
   *
   * 바닥은 **지금 스토어에 있는 값**이다(창을 연 시점의 사본이 아니다) — 이 창이 열려 있는 동안에도
   * 왕복은 `contextUsed`·`contextLimit`·`tokensIn/Out` 을 갱신하고, 옛 사본을 되돌려 보내면 그
   * 값들이 뒤로 간다. 그 위에 이 창이 실제로 만진 칸만 얹는다.
   */
  const buildLocalProvider = useCallback((): AgentProvider | undefined => {
    const live = useGraphStore.getState().agentConfigs[agentId]?.provider ?? provider;
    if (!live) return undefined;
    // 굳히는 규칙(클램프 · 빈 칸 = 엔진 기본값 · 판정 되돌리기 · 라이브 값 보존)은 순수 함수 한 곳에
    //   있고 `localProviderPayload.test.ts` 가 지킨다.
    return applyLocalProviderDraft(live, {
      contextDraft: localContext,
      temperatureDraft: localTemperature,
      retryToolSupport,
    });
  }, [agentId, provider, localContext, localTemperature, retryToolSupport]);

  const buildPayload = useCallback((): AgentConfig => ({
    model, tools, permissionMode, skills, color,
    maxTurns: maxTurns > 0 ? maxTurns : undefined,
    // §4 v2.88 — 0 = 무제한 → undefined 로 직렬화 최소화. 양수만 저장.
    maxBudgetUsd: maxBudgetUsd > 0 ? maxBudgetUsd : undefined,
    isolation: isolation !== 'none' ? isolation : undefined,
    // §5.3 v4.89 — 'default'(미지정)는 저장하지 않는다. 0 은 "깊이 미지정" 이라 undefined 로.
    memory: normalizeAgentMemoryScope(memory),
    subagentDepth: normalizeSubagentDepth(subagentDepth),
    effort: (isOpus && effort !== 'default') ? effort : undefined,
    disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
    rules: rules.trim() || undefined,
    // §5.3 #12-1 v1.90 — 'deny' 만 저장, 'allow'(기본)는 undefined 로 직렬화 최소화
    permissionTimeoutPolicy: permissionTimeoutPolicy === 'deny' ? 'deny' : undefined,
    // §5.3 #28 v1.47 — 'none' (기본) 은 undefined 로 저장
    customMode: customMode === 'none' ? undefined : customMode,
    // §4 v1.53 — 1M 컨텍스트. 기본 ON.
    //   - Opus 모델 + uncheck → '200k' 저장 (명시적 opt-out)
    //   - Opus 모델 + check → undefined (= 기본 1M, 직렬화 최소화)
    //   - 그 외 모델 → undefined (어차피 의미 없음)
    contextWindow: isOpus && contextWindow === '200k' ? '200k' : undefined,
    // §4 v1.53 — 프리셋 트레이스 메타
    presetId,
    // §4 v2.38 — 풀ID 핀 (undefined = alias=latest 모드)
    modelVersion,
    // §4 (CMD ⑧) — 고른 CLI. 'claude'(기본)는 undefined 로 보내 직렬화를 최소화한다.
    cliKind: cliKind && cliKind !== 'claude' ? cliKind : undefined,
    // §5.5 #17-20 ⑥ v4.74 — MCP 디버그 도구 선택은 이 창이 아니라 IDE 디버그 뷰에서 켠다.
    //   PUT 은 body 로 config 전량을 재구축하므로 **여기서 그대로 실어 보내지 않으면 저장할 때
    //   조용히 꺼진다** — 이 창이 모르는 필드라도 통과시켜야 한다.
    mcpServers: mcpServers && mcpServers.length > 0 ? mcpServers : undefined,
    // §4 (CLI 사양 추종) — 미설정은 undefined 로 보내 플래그가 붙지 않게 한다.
    fallbackModel: fallbackModel.trim() || undefined,
    autoCompact: autoCompact.trim() || undefined,
    excludeDynamicSystemPromptSections: excludeDynamicSections ? true : undefined,
    settingSources: settingSources.length > 0 ? settingSources : undefined,
    safeMode: safeMode ? true : undefined,
    agentCanCompact: agentCanCompact ? true : undefined,
    // §4 (Fast 모드) — 지원 모델일 때만 저장한다. 모델을 바꾼 뒤에도 값이 남아 있으면
    //   나중에 그 모델로 되돌렸을 때 사용자가 켠 적 없는 Fast 가 되살아난다.
    fastMode: fastMode && fastModeSupported ? true : undefined,
    // §4 (스트림 3종) — ①은 켬이 기본이라 **끌 때만** 값을 남긴다(undefined = 켬).
    forwardSubagentText: forwardSubagentText ? undefined : false,
    replayUserMessages: replayUserMessages ? true : undefined,
    promptSuggestions: promptSuggestions ? true : undefined,
    includeHookEvents: includeHookEvents ? true : undefined,
    // §4 (CLI 사양 추종) — 필수 칸이 빈 정의는 저장하지 않는다. 반쯤 채운 채로 나가면 CLI 가
    //   인자 파싱에서 거부해 **그 에이전트가 통째로 못 뜬다**(서버도 같은 규칙으로 한 번 더 접는다).
    agentDefinitions: (() => {
      const kept = agentDefinitions.filter(
        (d) => d.name.trim() !== '' && d.description.trim() !== '' && d.prompt.trim() !== '',
      );
      return kept.length > 0 ? kept : undefined;
    })(),
    pluginDirs: (() => {
      const parsed = pluginDirs.split('\n').map((d) => d.trim()).filter(Boolean);
      return parsed.length > 0 ? parsed : undefined;
    })(),
    betas: (() => {
      const parsed = betas.split(',').map((b) => b.trim()).filter(Boolean);
      return parsed.length > 0 ? parsed : undefined;
    })(),
    // §4 (CLI 사양 추종) — 초 → ms. 0/범위 밖은 undefined = 미설정(env 키 자체가 안 붙는다).
    bashDefaultTimeoutMs: bashSecToMs(bashDefaultTimeoutSec),
    bashMaxTimeoutMs: bashSecToMs(bashMaxTimeoutSec),
    // §5.19 (G) — 로컬 버블의 프로바이더. **저장하는 순간의 최신값**(스토어)을 바닥에 깔고 이 창이
    //   만진 칸만 얹는다. 창을 연 시점의 사본을 그대로 되돌려 보내면 그사이 왕복이 갱신한
    //   `contextUsed`·`tokensIn/Out` 이 옛 값으로 되돌아가 게이지가 뒤로 간다.
    //   로컬이 아니면 **아무것도 보내지 않는다** — 서버가 이전 값을 유지하므로 종전과 같다.
    provider: isLocal ? buildLocalProvider() : undefined,
  }), [
    model, tools, permissionMode, permissionTimeoutPolicy, skills, color, maxTurns, maxBudgetUsd, isolation, effort,
    memory, subagentDepth,
    isOpus, disallowedTools, rules, customMode,
    contextWindow, presetId, modelVersion, mcpServers,
    fallbackModel, autoCompact, agentCanCompact, excludeDynamicSections, settingSources, safeMode, fastMode, fastModeSupported, forwardSubagentText, replayUserMessages, promptSuggestions, includeHookEvents, betas, agentDefinitions, pluginDirs,
    bashDefaultTimeoutSec, bashMaxTimeoutSec,
    isLocal, buildLocalProvider,
  ]);

  // §4 — 이 창의 값이 **설정 창(Options › Agent Defaults)의 전역 기본값**과 어디서 갈라지는가.
  //   두 화면이 같은 모양이라 표식이 없으면 어느 칸이 이 버블만의 값인지 알 길이 없다.
  //   저장분이 아니라 **지금 폼이 저장하려는 값**으로 재므로 고르는 즉시 붙고 되돌리면 사라진다.
  //   §4 (설정 3층) — 점이 붙은 칸이 곧 **저장될 칸**이다(서버가 같은 판정으로 갈라진 칸만 남긴다).
  const agentDefaults = useMemo(() => resolveAgentDefaults(userDefaults), [userDefaults]);
  // §4 (CLI 사양 추종) — 지금 고른 값이면 **실제로 몇 토큰에서 접히는가**. 고른 숫자는 CLI 에게
  //   창 크기라 그보다 낮은 자리에서 접히므로, 그 숫자를 화면이 직접 말해야 놀라지 않는다.
  //   3층 그대로다: 이 에이전트 값 → 설정 창 전역 기본 → 내장 기본. 'auto' 는 모델 창을 런타임에야
  //   아는 값이라 숫자가 없다 → null.
  // §4 — 화면에 적는 비율. 상수 한 곳(shared)에서 와야 값을 바꿔도 12개 로케일이 안 틀어진다.
  const compactFoldsAtPercent = Math.round(TURN_COMPACT_TRIGGER_RATIO * 100);
  const compactFoldsAtTokens = useMemo(
    () => turnCompactTriggerTokens(resolveAutoCompact(autoCompact, userDefaults?.agentConfig?.autoCompact)),
    [autoCompact, userDefaults],
  );
  // 이 창이 **지금 그리지 않는** 축은 세지 않는다 — 화면의 점이 3개인데 머리의 숫자가 5 면
  //   그 숫자는 설명이 아니라 수수께끼가 된다.
  const hiddenDiffFields = useMemo(() => {
    const hidden: string[] = [];
    if (isLocal) {
      hidden.push(
        'model', 'modelVersion', 'contextWindow', 'fastMode', 'customMode', 'tools', 'disallowedTools',
        'maxTurns', 'isolation', 'effort', 'memory', 'subagentDepth', 'maxBudgetUsd', 'fallbackModel',
        'autoCompact', 'agentCanCompact', 'settingSources',
        'excludeDynamicSystemPromptSections', 'safeMode', 'forwardSubagentText', 'replayUserMessages',
        'promptSuggestions', 'includeHookEvents', 'betas', 'agentDefinitions', 'pluginDirs',
        'bashDefaultTimeoutMs', 'bashMaxTimeoutMs', 'skills',
      );
    }
    if (isShellOnly) hidden.push('model', 'modelVersion', 'contextWindow', 'fastMode');
    if (PERMISSION_MODES_WITHOUT_PROMPT.includes(permissionMode)) hidden.push('permissionTimeoutPolicy');
    return hidden;
  }, [isLocal, isShellOnly, permissionMode]);
  const diffFields = useMemo(
    () => diffAgentConfigFromDefaults(buildPayload(), agentDefaults, { skip: hiddenDiffFields }),
    [buildPayload, agentDefaults, hiddenDiffFields],
  );
  const diffSet = useMemo(() => new Set<string>(diffFields), [diffFields]);
  /** 요약이 부르는 이름 — 각 칸의 라벨을 그대로 쓴다(창과 다른 이름을 지어내면 찾아갈 수 없다). */
  const DIFF_FIELD_LABELS = useMemo((): Record<AgentConfigComparedField, string> => ({
    model: t('panel.agentConfig.model.label'),
    modelVersion: t('panel.agentConfig.modelVersion.label', { defaultValue: 'Version' }),
    contextWindow: t('panel.agentConfig.contextWindow.oneMillion', { defaultValue: '1M context window' }),
    fastMode: t('panel.agentConfig.fastMode.label'),
    permissionMode: t('panel.agentConfig.permissionMode.label'),
    permissionTimeoutPolicy: t('panel.agentConfig.permissionTimeoutPolicy.label', { defaultValue: 'On no response (60s)' }),
    customMode: t('panel.agentConfig.customMode.label', { defaultValue: 'Custom Mode' }),
    rules: t('panel.agentConfig.agentRules'),
    tools: t('panel.agentConfig.tools.label'),
    disallowedTools: t('panel.agentConfig.disallowedTools.label', { defaultValue: 'Disallowed Tools' }),
    maxTurns: t('panel.agentConfig.maxTurns'),
    isolation: t('panel.agentConfig.isolation.label'),
    effort: t('panel.agentConfig.effort.label'),
    memory: t('panel.agentConfig.memory.label'),
    subagentDepth: t('panel.agentConfig.subagentDepth.label'),
    maxBudgetUsd: t('panel.agentConfig.maxBudgetUsd', { defaultValue: 'Budget ($, 0=Inf)' }),
    fallbackModel: t('panel.agentConfig.fallbackModel.label'),
    autoCompact: t('panel.agentConfig.autoCompact.label'),
    agentCanCompact: t('panel.agentConfig.agentCanCompact.label'),
    settingSources: t('panel.agentConfig.settingSources.label'),
    excludeDynamicSystemPromptSections: t('panel.agentConfig.excludeDynamicSections.label'),
    safeMode: t('panel.agentConfig.safeMode.label'),
    forwardSubagentText: t('panel.agentConfig.forwardSubagentText.label'),
    replayUserMessages: t('panel.agentConfig.replayUserMessages.label'),
    promptSuggestions: t('panel.agentConfig.promptSuggestions.label'),
    includeHookEvents: t('panel.agentConfig.includeHookEvents.label'),
    betas: t('panel.agentConfig.betas.label'),
    agentDefinitions: t('panel.agentConfig.agentDefinitions.label'),
    pluginDirs: t('panel.agentConfig.pluginDirs.label'),
    bashDefaultTimeoutMs: t('panel.agentConfig.bashTimeout.defaultLabel'),
    bashMaxTimeoutMs: t('panel.agentConfig.bashTimeout.maxLabel'),
    skills: t('panel.agentConfig.defaultSkills'),
  }), [t]);
  /** hover 에 띄울 **기본값 자체**. "다르다"만 알려 주면 무엇으로 되돌려야 할지 알 수 없다. */
  const defaultValueText = useCallback((field: AgentConfigComparedField): string => {
    const raw = (agentDefaults as unknown as Record<string, unknown>)[field];
    const unset = t('panel.agentConfig.diff.unset');
    const on = t('panel.agentConfig.diff.on');
    const off = t('panel.agentConfig.diff.off');
    if (Array.isArray(raw)) {
      if (raw.length === 0) return unset;
      const head = raw.slice(0, 4).join(', ');
      return raw.length > 4 ? head + ' +' + (raw.length - 4) : head;
    }
    switch (field) {
      // 저장분에 값이 없을 때의 **뜻이 축마다 다르다** — 전부 "미설정"이라 적으면 거짓말이 된다.
      case 'contextWindow': return raw === '200k' ? '200k' : '1M';
      case 'permissionTimeoutPolicy': return raw === 'deny' ? 'deny' : 'allow';
      case 'forwardSubagentText': return raw === false ? off : on;
      case 'maxTurns': return String(typeof raw === 'number' && raw > 0 ? raw : AGENT_MAX_TURNS_UI_FALLBACK);
      case 'rules': {
        const body = typeof raw === 'string' ? raw.trim() : '';
        return body ? t('panel.agentConfig.lines', { count: body.split('\n').length }) : unset;
      }
      default: break;
    }
    if (typeof raw === 'boolean') return raw ? on : off;
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? String(raw) : unset;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return unset;
    return text.length > 48 ? text.slice(0, 48) + '...' : text;
  }, [agentDefaults, t]);
  /** 다른 칸에만 붙는 점. 같은 칸에는 아무것도 그리지 않는다 — 그게 심플함의 전부다. */
  const diffDot = (field: AgentConfigComparedField): React.JSX.Element | null => (
    diffSet.has(field)
      ? <DiffMark text={t('panel.agentConfig.diff.tip', { value: defaultValueText(field) })} />
      : null
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/agent-config/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      onClose();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [agentId, buildPayload, onClose]);

  const availableToAdd = AVAILABLE_AGENT_TOOLS.filter((t) => !tools.includes(t));

  // §5.5 #17-1 — **body 포털**. 이 창은 지금까지 `DetailPanel`(`z-30`) 안에서 그려졌는데, 부모가
  //   z-index 를 가지면 자식은 그 층 **안**에 갇힌다 — `fixed inset-0 z-50` 이라고 적혀 있어도
  //   실제로는 30층에 머물러 IDE 창(40층대) 뒤로 깔렸다. 여는 자리가 상세 패널이든 IDE 타이틀바든
  //   설정창은 늘 맨 위여야 하므로 부모의 층에서 빼낸다.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" {...backdrop}>
      <div className="flex max-h-[80vh] w-[420px] max-w-[94vw] flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-100">
              {t('panel.agentConfig.title')}
              <HoverTip text={t('panel.agentConfig.fieldTips.agentSettingsNote')} className="inline-flex cursor-help">
                <svg className="h-3.5 w-3.5 text-yellow-500/70 hover:text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4Zm.75 7a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                </svg>
              </HoverTip>
            </h3>
            {/* §4 — 이 에이전트만 다르게 설정된 칸이 몇 개인가. 아래 점들과 **같은 수**를 센다. */}
            {diffFields.length > 0 && (
              <HoverTip
                text={t('panel.agentConfig.diff.summaryTip', { list: diffFields.map((f) => DIFF_FIELD_LABELS[f]).join(', ') })}
                className="inline-flex w-fit cursor-help items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[12px] font-medium text-indigo-300"
              >
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" aria-hidden="true" />
                {t('panel.agentConfig.diff.badge', { count: diffFields.length })}
              </HoverTip>
            )}
            {/* §5.19 (G) — 정체를 창이 스스로 말한다. 이 한 줄이 없으면 **왜 칸이 적은지**를
                설명할 것이 없어 빈자리가 고장으로 읽힌다. */}
            {isLocal && (
              <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
                <span className="flex-shrink-0 rounded bg-slate-500/15 px-1.5 py-0.5 font-semibold text-slate-300">
                  {t('ide.overlay.localLabel', { defaultValue: 'All Model' })}
                </span>
                <span className="truncate text-slate-400">
                  {provider?.modelName || provider?.modelId
                    || t('panel.agentConfig.local.noModel', { defaultValue: '아직 모델을 고르지 않았습니다' })}
                </span>
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <ScrollFade fill className="flex-1">
          <div className="flex flex-col gap-4 p-4">

            {/* §5.19 (G) — 로컬 버블의 모델 자리. 이름과 [바꾸기] 뿐이다 — 카탈로그·받기·삭제는
                이미 설치 창에 있고, 같은 목록을 두 곳에 그리면 둘이 어긋나는 날이 온다. */}
            {isLocal && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center text-xs font-medium text-gray-400">
                  {t('panel.agentConfig.model.label')}
                  <InfoTip text={t('panel.agentConfig.local.modelTip', {
                    defaultValue: '이 버블이 말할 때 쓰는 로컬 모델입니다. 바꾸면 다음 턴부터 그 모델이 답합니다.',
                  })} />
                </label>
                <div className="flex items-center gap-2 rounded border border-gray-700 bg-gray-800/60 px-2.5 py-1.5">
                  <span className={`min-w-0 flex-1 truncate text-xs ${provider?.modelId ? 'text-gray-200' : 'text-gray-500'}`}>
                    {provider?.modelName || provider?.modelId
                      || t('panel.agentConfig.local.noModel', { defaultValue: '아직 모델을 고르지 않았습니다' })}
                  </span>
                  <button
                    type="button"
                    onClick={handleSwitchLocalModel}
                    className="flex-shrink-0 rounded bg-gray-700 px-2.5 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-600"
                  >
                    {provider?.modelId
                      ? t('panel.agentConfig.local.switchModel', { defaultValue: '모델 바꾸기' })
                      : t('panel.agentConfig.local.pickModel', { defaultValue: '모델 고르기' })}
                  </button>
                </div>

                {/* §5.19 (D) — 대화 창 크기 · 온도. 로컬 턴이 **실제로 읽는** 두 값이다. */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center text-xs font-medium text-gray-400">
                      {t('localModel.contextTitle', { defaultValue: '대화 창 크기' })}
                      <InfoTip text={t('localModel.contextHint', {
                        defaultValue: '길수록 더 오래 기억하지만 메모리를 더 쓰고 느려집니다. 모델이 학습된 길이보다 크게 잡으면 그 길이로 낮춰서 씁니다. 바꾼 값은 이 모델을 다음에 올릴 때부터 적용됩니다.',
                      })} />
                    </label>
                    <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                      <input
                        type="number"
                        min={LOCAL_CONTEXT_MIN}
                        max={LOCAL_CONTEXT_MAX}
                        step={1024}
                        value={localContext}
                        onChange={(e) => setLocalContext(e.target.value)}
                        className="w-full min-w-0 flex-1 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="flex items-center px-2 text-[12px] text-gray-500">
                        {t('localModel.contextUnit', { defaultValue: '토큰' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center text-xs font-medium text-gray-400">
                      {t('panel.agentConfig.local.temperature', { defaultValue: '온도' })}
                      <InfoTip text={t('panel.agentConfig.local.temperatureTip', {
                        defaultValue: '낮으면 또박또박 같은 답을, 높으면 더 자유로운 답을 냅니다. 비워 두면 엔진 기본값을 씁니다.',
                      })} />
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={localTemperature}
                      onChange={(e) => setLocalTemperature(e.target.value)}
                      placeholder={t('panel.agentConfig.local.temperatureDefault', { defaultValue: '엔진 기본값' })}
                      className="w-full min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-center text-sm text-gray-200 outline-none placeholder:text-[12px] placeholder:text-gray-600 focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* §4 (CMD ⑧) — CLI 종류. CMD(임베디드 터미널) 버블에서만. */}
            {isCmdAgent && (
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">
                  {t('panel.agentConfig.cliKind.label', { defaultValue: 'CLI' })}
                  <InfoTip text={t('panel.agentConfig.cliKind.tip', { defaultValue: '이 CMD 터미널이 띄울 에이전트 CLI입니다. Claude Code 외에는 우리 훅의 자식이 아니므로 대화 이어받기·규칙 주입이 붙지 않고, 상태는 터미널 출력으로 읽습니다.' })} />
                </label>
                <select
                  value={cliKind ?? 'claude'}
                  onChange={(e) => setCliKind(e.target.value as CmdCliKind)}
                  className="w-full cursor-pointer rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
                >
                  {CMD_CLI_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
                {/* 고른 CLI 가 claude 가 아니면 **아래 칸들이 전달되지 않는다** — 말해 주지 않으면
                    설정을 채워 놓고 안 먹는다고 읽는다. 반영 시점(새 세션)도 함께 알린다. */}
                {cliKind && cliKind !== 'claude' && (
                  <p className="text-[12px] leading-relaxed text-amber-300/80">
                    {t('panel.agentConfig.cliKind.nonClaudeNote', { defaultValue: '이 CLI 는 Claude Code 가 아니라 아래 설정(모델·권한·도구·규칙)이 전달되지 않습니다. 상태는 터미널 출력으로 읽습니다. 바꾼 값은 "+" 로 연 새 세션부터 적용됩니다.' })}
                  </p>
                )}
                {cliKind === 'claude' && base.cliKind && base.cliKind !== 'claude' && (
                  <p className="text-[12px] leading-relaxed text-gray-500">
                    {t('panel.agentConfig.cliKind.applyNote', { defaultValue: '바꾼 CLI 는 "+" 로 연 새 세션부터 적용됩니다(이미 떠 있는 터미널은 그대로).' })}
                  </p>
                )}
              </div>
            )}

            {/* Model */}
            {!isLocal && !isShellOnly && (
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.model.label')}<InfoTip text={FIELD_TIPS.model} />{diffDot('model')}</label>
              <CustomSelect value={model} onChange={handleModelChange} options={MODEL_OPTIONS} />

              {/* §4 v2.41 — 작은 인라인 버전 라인. `version: claude-opus-4-8 ▾` 식.
                  native <select> 로 컴팩트 + 옵션 4개 이내 (Latest / 최신 / 직전 / Custom…) */}
              <div className="mt-0.5 flex items-center gap-1 px-0.5 text-[12px] text-gray-500">
                <span className="uppercase tracking-wider">{t('panel.agentConfig.modelVersion.label', { defaultValue: 'Version' })}:</span>{diffDot('modelVersion')}
                <select
                  value={effectiveVersionValue}
                  onChange={(e) => handleVersionChange(e.target.value)}
                  className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 font-mono text-[12px] text-gray-300 outline-none hover:border-gray-600 focus:border-blue-500"
                >
                  {VERSION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.description}</option>
                  ))}
                </select>
                {/* alias 모드일 때 → 실제 전달 인자 미리보기 */}
                {modelVersion === undefined && (
                  <span className="font-mono text-gray-600">→ {effectiveCliArg}</span>
                )}
                {isCustomVersion && (
                  <input
                    type="text"
                    value={modelVersion ?? ''}
                    onChange={(e) => setModelVersion(e.target.value)}
                    placeholder={`claude-${model}-X-Y`}
                    className="flex-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-0 font-mono text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                )}
              </div>

              {/* §4 v1.53 — Opus 1M 컨텍스트 토글. 기본 ON (undefined === checked). uncheck 시 '200k' opt-out 저장 */}
              {isOpusModel(model) && (
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded border border-gray-700/60 bg-gray-900/40 px-2.5 py-1.5 hover:border-gray-600">
                  <input
                    type="checkbox"
                    checked={oneMillionEnabled}
                    onChange={(e) => setContextWindow(e.target.checked ? undefined : '200k')}
                    className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
                  />
                  <span className="text-xs text-gray-300">
                    {t('panel.agentConfig.contextWindow.oneMillion', { defaultValue: '1M context window' })}{diffDot('contextWindow')}
                  </span>
                </label>
              )}

              {/* §4 (Fast 모드) — 같은 Opus 를 출력 속도만 빠르게. 지원하지 않는 모델에서는 CLI 가
                  사유도 없이 조용히 무시하므로, 숨기지 않고 **비활성 + 이유**로 보여 준다. */}
              <label
                className={`mt-1 flex items-center gap-2 rounded border px-2.5 py-1.5 ${
                  fastModeSupported
                    ? 'cursor-pointer border-gray-700/60 bg-gray-900/40 hover:border-gray-600'
                    : 'cursor-not-allowed border-gray-800/60 bg-gray-900/20'
                }`}
              >
                <input
                  type="checkbox"
                  checked={fastMode && fastModeSupported}
                  disabled={!fastModeSupported}
                  onChange={(e) => setFastMode(e.target.checked)}
                  className="h-3.5 w-3.5 accent-blue-500 disabled:cursor-not-allowed"
                />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-3.5 w-3.5 ${fastModeSupported ? 'text-sky-400' : 'text-gray-600'}`}
                  aria-hidden="true"
                >
                  <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
                </svg>
                <span className={`text-xs ${fastModeSupported ? 'text-gray-300' : 'text-gray-600'}`}>
                  {t('panel.agentConfig.fastMode.label')}{diffDot('fastMode')}
                  <span className="ml-1 text-gray-600">
                    {fastModeSupported ? t('panel.agentConfig.fastMode.hint') : t('panel.agentConfig.fastMode.unsupported')}
                  </span>
                </span>
                <InfoTip text={t('panel.agentConfig.fastMode.tip')} />
              </label>
            </div>
            )}

            {/* Permission Mode */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.permissionMode.label')}<InfoTip text={FIELD_TIPS.permissionMode} />{diffDot('permissionMode')}</label>
              <CustomSelect value={permissionMode} onChange={setPermissionMode} options={PERMISSION_OPTIONS} />
            </div>

            {/* §5.3 #12-1 v1.90 — On no response (60s) fallback. 팝업이 원천적으로 안 뜨는 모드
                (bypassPermissions·plan·auto·dontAsk)에서는 무의미해서 숨긴다 — §4 CLI 사양 추종으로
                auto·dontAsk 가 늘었으므로 조건을 shared 목록 한 곳으로 모았다. */}
            {!PERMISSION_MODES_WITHOUT_PROMPT.includes(permissionMode) && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center text-xs font-medium text-gray-400">
                  {t('panel.agentConfig.permissionTimeoutPolicy.label', { defaultValue: 'On no response (60s)' })}{diffDot('permissionTimeoutPolicy')}
                  <InfoTip text={t('panel.agentConfig.permissionTimeoutPolicy.tip', {
                    defaultValue: 'If the approval popup is not answered within 60s — Allow: auto-approve so the agent keeps working while you are away. Deny: auto-block (safe). Only applies when Permission Mode actually pops a dialog.',
                  })} />
                </label>
                <div className="relative flex h-8 overflow-hidden rounded-md border border-gray-700/80 bg-gray-900/60">
                  <span
                    aria-hidden
                    className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded transition-all duration-250 ease-out"
                    style={{
                      left: permissionTimeoutPolicy === 'allow' ? 2 : 'calc(50% + 0px)',
                      background: permissionTimeoutPolicy === 'deny'
                        ? 'linear-gradient(180deg, rgba(248,113,113,0.22), rgba(248,113,113,0.06))'
                        : 'linear-gradient(180deg, rgba(16,185,129,0.22), rgba(16,185,129,0.06))',
                      boxShadow: permissionTimeoutPolicy === 'deny'
                        ? 'inset 0 0 0 1px rgba(248,113,113,0.45), 0 0 10px -2px rgba(248,113,113,0.3)'
                        : 'inset 0 0 0 1px rgba(16,185,129,0.4), 0 0 10px -2px rgba(16,185,129,0.25)',
                    }}
                  />
                  {(['allow', 'deny'] as const).map((p) => {
                    const active = permissionTimeoutPolicy === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPermissionTimeoutPolicy(p)}
                        className={`relative flex flex-1 items-center justify-center gap-1.5 rounded text-[12px] font-semibold uppercase tracking-wide transition-colors ${
                          active
                            ? (p === 'deny' ? 'text-red-300' : 'text-emerald-200')
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {p === 'allow' ? (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        )}
                        <span>{t(`panel.agentConfig.permissionTimeoutPolicy.${p}`, { defaultValue: p })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* §5.3 #28 v1.47 — Custom Mode (Vibisual 콘티/리뷰/디버그 모드 축, claude CLI 와 직교)
                §5.19 (G) — 콘티는 클로드 세션이 낸 결과를 읽어 보드를 채우는 축이라 로컬에는 안 뜬다. */}
            {!isLocal && (
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">
                {t('panel.agentConfig.customMode.label', { defaultValue: 'Custom Mode' })}{diffDot('customMode')}
                <InfoTip text={t('panel.agentConfig.customMode.tip', {
                  defaultValue: 'Vibisual 자체 모드. 콘티모드 ON 저장 시 에이전트 규칙이 콘티 전용 룰로 덮어쓰여집니다 (이전 규칙은 히스토리에 보관). 리뷰/디버그는 추후 지원.',
                })} />
              </label>
              <CustomSelect
                value={customMode}
                onChange={(v) => {
                  const next = v as 'none' | 'conti' | 'review' | 'debug';
                  // §5.3 #28 (K) v1.48 — 서버 전이 거동을 클라에서도 즉시 미러:
                  //   conti 진입 = rules 를 CONTI_AGENT_RULES 로 덮어쓰기 (사용자 보고 dirty 인지)
                  //   conti 이탈 = rules 비우기 (자동 복원 ❌)
                  // 사용자가 Save 누르기 전에도 Rules 편집기에서 즉시 확인 가능.
                  if (next === 'conti' && customMode !== 'conti') {
                    setRules(CONTI_AGENT_RULES);
                  } else if (customMode === 'conti' && next !== 'conti') {
                    // base.customMode === 'conti' (실제 저장된 콘티 상태) 면 서버처럼 비움.
                    // 그 외 (= 이번 편집 세션에서 잠깐 켰다 끄는 경우) 는 원래 사용자 룰 복원.
                    setRules(base.customMode === 'conti' ? '' : (base.rules ?? ''));
                  }
                  setCustomMode(next);
                }}
                options={[
                  { value: 'none', description: t('panel.agentConfig.customMode.none', { defaultValue: '(none)' }) },
                  { value: 'conti', description: t('panel.agentConfig.customMode.conti', { defaultValue: '콘티모드' }) },
                  { value: 'review', description: t('panel.agentConfig.customMode.reviewDisabled', { defaultValue: '리뷰모드 (coming soon)' }), disabled: true },
                  { value: 'debug', description: t('panel.agentConfig.customMode.debugDisabled', { defaultValue: '디버그모드 (coming soon)' }), disabled: true },
                ]}
              />
              {/* §5.3 #28 (K) v1.48 — 콘티모드 ON 으로 전이될 때만 룰 덮어쓰기 경고 노출 */}
              {customMode === 'conti' && base.customMode !== 'conti' && (
                <p className="flex items-start gap-1.5 text-[12px] leading-tight text-amber-400/85">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    {t('panel.agentConfig.customMode.contiOverwriteWarn', {
                      defaultValue: '저장 시 에이전트 규칙이 콘티 전용 룰로 덮어쓰여집니다 (이전 규칙은 히스토리에 보관).',
                    })}
                  </span>
                </p>
              )}
              {customMode !== 'conti' && base.customMode === 'conti' && (
                <p className="flex items-start gap-1.5 text-[12px] leading-tight text-gray-400">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>
                    {t('panel.agentConfig.customMode.contiOffNotice', {
                      defaultValue: '저장 시 콘티 룰이 비워집니다 (콘티 데이터는 유지). 이전 룰은 히스토리에서 직접 복원.',
                    })}
                  </span>
                </p>
              )}
              {customMode === 'review' || customMode === 'debug' ? (
                <p className="text-[12px] leading-tight text-amber-400/70">
                  {t('panel.agentConfig.customMode.placeholderHint', {
                    defaultValue: '이 모드는 아직 구현되지 않았습니다 — 저장은 되지만 동작은 비활성.',
                  })}
                </p>
              ) : null}
              {customMode === 'conti' && (
                <p className="text-[12px] leading-tight text-emerald-400/80">
                  {t('panel.agentConfig.customMode.contiHint', {
                    defaultValue: '저장 시 에이전트 옆에 콘티 버블이 자동 생성됩니다 (단일 클릭=히스토리, 더블 클릭=보드).',
                  })}
                </p>
              )}
            </div>
            )}

            {/* Agent Rules */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.agentRules')}<InfoTip text={FIELD_TIPS.rules} />{diffDot('rules')}</label>
              <button type="button" onClick={() => setShowRulesEditor(true)} className="flex items-center gap-2 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-left transition-colors hover:border-blue-500/50">
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span className="truncate text-xs text-gray-400">
                  {rules.trim() ? t('panel.agentConfig.lines', { count: rules.trim().split('\n').length }) : t('panel.agentConfig.noRulesDefined')}
                </span>
              </button>
              {/* v1.33 — outbound 엣지 자동 섹션 (읽기 전용 · 서버가 같은 내용을 rules 에 자동 인젝션) */}
              <AutoEdgeSection agentId={agentId} compact />
            </div>

            {/* Project Context (read-only) */}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setContextOpen((p) => !p)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-300"
              >
                <svg className={`h-3 w-3 transition-transform ${contextOpen ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="currentColor">
                  <path d="M4 2l5 4-5 4V2z" />
                </svg>
                {t('panel.agentConfig.projectContext')}
                <InfoTip text={t('panel.agentConfig.fieldTips.projectContext')} />
                <span className="ml-auto text-[12px] text-gray-600">{t('panel.agentConfig.contextItems', { count: contextItems.length })}</span>
              </button>
              {contextOpen && (
                <div className="mt-1 flex flex-col gap-0.5 rounded border border-gray-700/50 bg-gray-800/50 p-2">
                  {contextItems.filter((i) => i.type === 'readable').map((item) => (
                    <div key={item.name} className="group/ctx flex flex-col gap-0.5 rounded px-2 py-1 hover:bg-gray-700/30">
                      <div className="flex items-center gap-1.5">
                        <svg className="h-3 w-3 flex-shrink-0 text-emerald-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.3 5.7-4 4a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06L6.75 9.1l3.47-3.47a.75.75 0 1 1 1.06 1.06Z" /></svg>
                        <span className="text-[12px] font-medium text-gray-300">{item.name}</span>
                        {/* File open + Folder open buttons */}
                        {item.path && (
                          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/ctx:opacity-100">
                            {item.lines != null && <span className="mr-1 text-[12px] text-gray-600">{item.lines}L</span>}
                            <HoverTip text="Open file in editor" className="inline-flex">
                              <button type="button" onClick={() => { fetch(`${API_BASE}/api/open-context-path`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: item.path, mode: 'file' }) }).catch(() => {}); }} className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300">
                                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" /></svg>
                              </button>
                            </HoverTip>
                            <HoverTip text="Open containing folder" className="inline-flex">
                              <button type="button" onClick={() => { fetch(`${API_BASE}/api/open-context-path`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: item.path, mode: 'folder' }) }).catch(() => {}); }} className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300">
                                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.464 0 .909.184 1.237.513l1.414 1.414a.25.25 0 0 0 .177.073h5.672c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 13.75 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.909.513-1.237Z" /></svg>
                              </button>
                            </HoverTip>
                          </span>
                        )}
                        {!item.path && item.lines != null && <span className="ml-auto text-[12px] text-gray-600">{item.lines}L</span>}
                      </div>
                      {item.summary && <span className="pl-[18px] text-[12px] leading-tight text-gray-500">{item.summary}</span>}
                    </div>
                  ))}
                  {contextItems.some((i) => i.type === 'not_accessible') && (
                    <div className="mt-1 border-t border-gray-700/30 pt-1">
                      <span className="px-2 text-[12px] font-medium text-gray-600">{t('panel.agentConfig.contextNotAccessible')}</span>
                      {contextItems.filter((i) => i.type === 'not_accessible').map((item) => (
                        <div key={item.name} className="flex flex-col gap-0.5 rounded px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <svg className="h-3 w-3 flex-shrink-0 text-gray-600" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4a4 4 0 0 1 8 0v2h.25A1.75 1.75 0 0 1 14 7.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5A1.75 1.75 0 0 1 3.75 6H4V4Zm6 0v2H6V4a2 2 0 1 1 4 0ZM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" /></svg>
                            <span className="text-[12px] text-gray-500">{item.name}</span>
                          </div>
                          {item.summary && <span className="pl-[18px] text-[12px] leading-tight text-gray-600">{item.summary}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* §5.19 (H) — 로컬 버블의 도구. **고를 것이 없다** — 러너는 언제나 같은 목록(`LOCAL_TOOL_DEFS`)을
                싣는다. 그래서 이 자리는 허용 목록이 아니라 "이 모델이 도구를 실제로 쓰는가"를 말한다. */}
            {isLocal && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center text-xs font-medium text-gray-400">
                  {t('panel.agentConfig.tools.label')}
                  <InfoTip text={t('panel.agentConfig.local.toolsTip', {
                    defaultValue: '로컬 모델에게는 아래 도구가 통째로 갑니다(고르는 목록이 아닙니다). 실행 직전에는 위 권한 모드와 승인 팝업이 클로드 버블과 똑같이 걸립니다.',
                  })} />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {LOCAL_TOOL_NAMES.map((tool) => {
                    const desc = t(`panel.agentConfig.tools.${tool}`, { defaultValue: '' });
                    const chip = (
                      <span className="flex items-center rounded-full bg-gray-700/40 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                        {tool}
                      </span>
                    );
                    return desc
                      ? <HoverTip key={tool} text={desc} className="inline-flex">{chip}</HoverTip>
                      : <span key={tool} className="inline-flex">{chip}</span>;
                  })}
                </div>
                {(() => {
                  // 저장하기 전에도 화면은 [다시 확인]을 누른 결과를 보여 준다 — 누르고도 그대로면
                  //   눌리지 않은 줄 알고 또 누른다.
                  const verdict = retryToolSupport ? 'unknown' : (provider?.toolSupport ?? 'unknown');
                  const tone = verdict === 'ok' ? 'text-emerald-400' : verdict === 'none' ? 'text-amber-400' : 'text-gray-500';
                  const line = verdict === 'ok'
                    ? t('panel.agentConfig.local.toolsOk', { defaultValue: '이 모델은 도구를 씁니다 — 파일을 읽고 고칠 수 있습니다.' })
                    : verdict === 'none'
                      ? t('panel.agentConfig.local.toolsNone', { defaultValue: '이 모델은 도구를 못 씁니다 — 대화만 합니다.' })
                      : t('panel.agentConfig.local.toolsUnknown', { defaultValue: '아직 확인 전입니다 — 다음 턴에 도구를 실어 보내 확인합니다.' });
                  return (
                    <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
                      <span className={`min-w-0 flex-1 text-[12px] leading-snug ${tone}`}>{line}</span>
                      {provider?.toolSupport === 'none' && !retryToolSupport && (
                        <button
                          type="button"
                          onClick={() => setRetryToolSupport(true)}
                          className="flex-shrink-0 rounded bg-gray-700 px-2 py-1 text-[12px] text-gray-200 transition-colors hover:bg-gray-600"
                        >
                          {t('panel.agentConfig.local.toolsRecheck', { defaultValue: '다시 확인' })}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Tools */}
            {!isLocal && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.tools.label')}<InfoTip text={FIELD_TIPS.tools} />{diffDot('tools')}</label>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((tool) => {
                  const stripped = strictStripSet.has(tool);
                  if (!stripped) {
                    return <ToolChip key={tool} tool={tool} variant="allowed" onRemove={() => removeTool(tool)} />;
                  }
                  const desc = t(`panel.agentConfig.tools.${tool}`, { defaultValue: '' });
                  const stripHint = t('panel.agentConfig.tools.strippedByEdgeHint', {
                    defaultValue: 'STRICT 엣지로 위임되는 도구 — 이 에이전트는 런타임에 사용 불가 (엣지 해제 시 복구)',
                  });
                  const chip = (
                    <span
                      className="flex cursor-not-allowed items-center gap-1 rounded-full bg-gray-700/30 px-2.5 py-0.5 text-xs font-medium text-gray-500 line-through opacity-70"
                      aria-disabled="true"
                    >
                      {tool}
                      <button
                        type="button"
                        onClick={() => removeTool(tool)}
                        className="ml-0.5 no-underline text-gray-500 hover:text-red-400"
                        aria-label="remove"
                      >×</button>
                    </span>
                  );
                  const tooltip = desc ? `${stripHint}\n\n${desc}` : stripHint;
                  return (
                    <HoverTip key={tool} text={tooltip} className="inline-flex">
                      {chip}
                    </HoverTip>
                  );
                })}
              </div>
              <div className="relative">
                <button ref={toolPicker.btnRef} type="button" onClick={toolPicker.toggle} disabled={availableToAdd.length === 0} className="rounded border border-dashed border-gray-600 px-2.5 py-1 text-xs text-gray-500 hover:border-blue-500 hover:text-blue-400 disabled:opacity-30">{t('panel.agentConfig.tools.addTool')}</button>
                {toolPicker.open && createPortal(
                  <div ref={toolPicker.panelRef} className="fixed z-[9999] max-h-72 overflow-y-auto rounded border border-gray-700 bg-gray-800 py-1 shadow-xl scrollbar-thin" style={{ ...toolPicker.pos, maxWidth: 320 }}>
                    {availableToAdd.map((t) => (
                      <button key={t} type="button" onClick={() => { setTools((p) => [...p, t]); toolPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-blue-500/15">
                        <span className="text-xs font-medium text-gray-200">{t}</span>
                        {TOOL_DESCRIPTIONS[t] && <span className="text-[12px] leading-tight text-gray-500">{TOOL_DESCRIPTIONS[t]}</span>}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
            )}

            {/* §4 v1.53 — Disallowed Tools (deny-list). Tools allow-list 와 직교 — Tools 에 있어도 이 칩에 있으면 CLI --disallowedTools 로 차단
                §5.19 (G) — CLI 플래그라 로컬에는 뜨지 않는다(로컬의 차단축은 권한 모드 하나다). */}
            {!isLocal && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">
                {t('panel.agentConfig.disallowedTools.label', { defaultValue: 'Disallowed Tools' })}{diffDot('disallowedTools')}
                <InfoTip text={t('panel.agentConfig.disallowedTools.tip', {
                  defaultValue: 'CLI --disallowedTools 로 강제 차단. Tools(allow) 에 포함되어 있어도 우선됩니다. 모든 도구를 사용자 책임으로 두되, 특정 도구만 한 번에 금지하고 싶을 때 사용.',
                })} />
              </label>
              <div className="flex flex-wrap gap-1.5">
                {disallowedTools.map((tool) => {
                  const desc = t(`panel.agentConfig.tools.${tool}`, { defaultValue: '' });
                  const chip = (
                    <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-400">
                      {tool}
                      <button
                        type="button"
                        onClick={() => setDisallowedTools((p) => p.filter((x) => x !== tool))}
                        className="ml-0.5 text-red-400/60 hover:text-red-300"
                        aria-label="remove"
                      >×</button>
                    </span>
                  );
                  return desc ? <HoverTip key={tool} text={desc} className="inline-flex">{chip}</HoverTip> : chip;
                })}
              </div>
              <div className="relative">
                <button
                  ref={denyPicker.btnRef}
                  type="button"
                  onClick={denyPicker.toggle}
                  disabled={AVAILABLE_AGENT_TOOLS.filter((tool) => !disallowedTools.includes(tool)).length === 0}
                  className="rounded border border-dashed border-gray-600 px-2.5 py-1 text-xs text-gray-500 hover:border-red-500 hover:text-red-400 disabled:opacity-30"
                >
                  {t('panel.agentConfig.disallowedTools.addTool', { defaultValue: '+ Block tool' })}
                </button>
                {denyPicker.open && createPortal(
                  <div ref={denyPicker.panelRef} className="fixed z-[9999] max-h-72 overflow-y-auto rounded border border-gray-700 bg-gray-800 py-1 shadow-xl scrollbar-thin" style={{ ...denyPicker.pos, maxWidth: 320 }}>
                    {AVAILABLE_AGENT_TOOLS.filter((tool) => !disallowedTools.includes(tool)).map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => { setDisallowedTools((p) => [...p, tool]); denyPicker.close(); }}
                        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-red-500/15"
                      >
                        <span className="text-xs font-medium text-gray-200">{tool}</span>
                        {TOOL_DESCRIPTIONS[tool] && <span className="text-[12px] leading-tight text-gray-500">{TOOL_DESCRIPTIONS[tool]}</span>}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
            )}

            {/* Compact row: Max Turns / Isolation / Effort / Memory
                §5.19 (G) — 여섯 칸 전부 클로드 스폰 인자·env 라 로컬에는 뜨지 않는다
                (왕복 상한은 러너의 `LOCAL_TOOL_MAX_ROUNDS`, 비용은 0, 격리·기억·깊이는 CLI 축). */}
            {!isLocal && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.maxTurns')}<InfoTip text={FIELD_TIPS.maxTurns} />{diffDot('maxTurns')}</label>
                <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                  <button type="button" onClick={() => setMaxTurns((v) => { const step = v <= 100 ? 10 : v <= 1000 ? 50 : 100; return Math.max(1, v - step); })} className="flex w-7 items-center justify-center text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200">
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><line x1="2" y1="6" x2="10" y2="6" /></svg>
                  </button>
                  <input type="number" min={1} max={10000} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value) || 3000)} className="w-full min-w-0 flex-1 border-x border-gray-700 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <button type="button" onClick={() => setMaxTurns((v) => { const step = v < 100 ? 10 : v < 1000 ? 50 : 100; return Math.min(10000, v + step); })} className="flex w-7 items-center justify-center text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200">
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><line x1="2" y1="6" x2="10" y2="6" /><line x1="6" y1="2" x2="6" y2="10" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.isolation.label')}<InfoTip text={FIELD_TIPS.isolation} />{diffDot('isolation')}</label>
                <CustomSelect value={isolation} onChange={setIsolation} options={ISOLATION_OPTIONS} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.effort.label')}<InfoTip text={FIELD_TIPS.effort} />{diffDot('effort')}</label>
                <CustomSelect value={isOpus ? effort : 'default'} onChange={setEffort} options={EFFORT_OPTIONS} disabled={!isOpus} />
              </div>
              {/* §5.3 v4.89 — 자기 기억 범위. 이 에이전트가 세션을 넘어 무엇을 기억할지 정한다. */}
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.memory.label')}<InfoTip text={FIELD_TIPS.memory} />{diffDot('memory')}</label>
                <CustomSelect value={memory} onChange={setMemory} options={MEMORY_OPTIONS} />
              </div>
              {/* §5.3 v4.89 — 서브에이전트 중첩 깊이. 0 = 미지정(CLI 기본 3층). */}
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.subagentDepth.label')}<InfoTip text={FIELD_TIPS.subagentDepth} />{diffDot('subagentDepth')}</label>
                <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                  <button type="button" onClick={() => setSubagentDepth((v) => Math.max(0, v - 1))} className="flex w-7 items-center justify-center text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200">
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><line x1="2" y1="6" x2="10" y2="6" /></svg>
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={SUBAGENT_DEPTH_MAX}
                    value={subagentDepth}
                    onChange={(e) => setSubagentDepth(Math.max(0, Math.min(SUBAGENT_DEPTH_MAX, Number(e.target.value) || 0)))}
                    className="w-full min-w-0 flex-1 border-x border-gray-700 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button type="button" onClick={() => setSubagentDepth((v) => Math.min(SUBAGENT_DEPTH_MAX, v + 1))} className="flex w-7 items-center justify-center text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200">
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}><line x1="2" y1="6" x2="10" y2="6" /><line x1="6" y1="2" x2="6" y2="10" /></svg>
                  </button>
                </div>
              </div>
              {/* §4 v2.88 — API 비용 상한($). 0 = 무제한. 양수면 헤드리스 스폰에 --max-budget-usd 전달. */}
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.maxBudgetUsd', { defaultValue: 'Budget ($, 0=∞)' })}<InfoTip text={FIELD_TIPS.maxBudgetUsd} />{diffDot('maxBudgetUsd')}</label>
                <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                  <span className="flex w-7 items-center justify-center text-sm text-gray-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={maxBudgetUsd}
                    onChange={(e) => setMaxBudgetUsd(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full min-w-0 flex-1 border-l border-gray-700 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </div>
            )}

            {/* §4 (CLI 사양 추종) — 설치된 claude 가 받는 신규 옵션. 전부 "미설정"이 기본이고,
                미설정이면 해당 플래그를 붙이지 않아 종전과 같은 인자로 스폰된다.
                §5.19 (G) — 이름 그대로 CLI 옵션이라 로컬에는 뜨지 않는다. */}
            {!isLocal && (
            <div className="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900/40 p-2.5">
              <span className="flex items-center text-xs font-medium text-gray-400">
                {t('panel.agentConfig.cliOptions.label')}
                <InfoTip text={t('panel.agentConfig.cliOptions.tip')} />
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="flex items-center text-[12px] font-medium text-gray-500">
                    {t('panel.agentConfig.fallbackModel.label')}{diffDot('fallbackModel')}
                    <InfoTip text={t('panel.agentConfig.fallbackModel.tip')} />
                  </label>
                  <CustomSelect value={effectiveFallbackValue} onChange={handleFallbackChange} options={FALLBACK_MODEL_OPTIONS} />
                  {fallbackCustom && (
                    <input
                      type="text"
                      value={fallbackModel}
                      onChange={(e) => setFallbackModel(e.target.value)}
                      placeholder={t('panel.agentConfig.fallbackModel.placeholder')}
                      className="mt-0.5 min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 font-mono text-[12px] text-gray-200 outline-none focus:border-blue-500"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center text-[12px] font-medium text-gray-500">
                    {t('panel.agentConfig.autoCompact.label')}{diffDot('autoCompact')}
                    <InfoTip text={t('panel.agentConfig.autoCompact.tip', { percent: compactFoldsAtPercent })} />
                  </label>
                  <CustomSelect value={autoCompact} onChange={setAutoCompact} options={AUTOCOMPACT_OPTIONS} />
                  {/* §4 (CLI 사양 추종) — **이 숫자 하나가 전부다.** 옆에 있던 "턴이 끝나면 압축"
                      체크박스는 같은 일을 해 헷갈리기만 했고(그리고 같은 숫자를 쓰는 한 CLI 가 늘 먼저
                      접어 뜨지도 못했다) 이 값 안으로 합쳤다. 실제로 접히는 토큰 수는 고른 값과 다르므로
                      숨기지 않고 여기서 직접 말한다. */}
                  <span className="text-[12px] leading-snug text-gray-400">
                    {compactFoldsAtTokens === null
                      ? t('panel.agentConfig.autoCompact.foldsAtAuto', { percent: compactFoldsAtPercent })
                      : t('panel.agentConfig.autoCompact.foldsAt', { tokens: `${Math.round(compactFoldsAtTokens / 1000)}k` })}
                  </span>
                  {/* §4 (CLI 사양 추종) — 이 축만 직교로 남는다: 숫자로 못 잡는 자리를 에이전트가 부른다. */}
                  <label className="mt-2 flex items-start gap-2 text-[12px] text-gray-400">
                    <input
                      type="checkbox"
                      checked={agentCanCompact}
                      onChange={(e) => setAgentCanCompact(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                    />
                    <span>
                      {t('panel.agentConfig.agentCanCompact.label')}{diffDot('agentCanCompact')}
                      <span className="ml-1 text-gray-600">{t('panel.agentConfig.agentCanCompact.hint')}</span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-[12px] font-medium text-gray-500">
                  {t('panel.agentConfig.settingSources.label')}{diffDot('settingSources')}
                  <InfoTip text={t('panel.agentConfig.settingSources.tip')} />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_SETTING_SOURCES.map((src) => {
                    const on = settingSources.includes(src);
                    return (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setSettingSources((p) => (p.includes(src) ? p.filter((x) => x !== src) : [...p, src]))}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          on ? 'bg-sky-500/15 text-sky-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {src}
                      </button>
                    );
                  })}
                  {settingSources.length === 0 && (
                    <span className="self-center text-[12px] text-gray-600">{t('panel.agentConfig.settingSources.all')}</span>
                  )}
                </div>
              </div>
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={excludeDynamicSections}
                  onChange={(e) => setExcludeDynamicSections(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                />
                <span>
                  {t('panel.agentConfig.excludeDynamicSections.label')}{diffDot('excludeDynamicSystemPromptSections')}
                  <span className="ml-1 text-gray-600">{t('panel.agentConfig.excludeDynamicSections.hint')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={safeMode}
                  onChange={(e) => setSafeMode(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                />
                <span>
                  {t('panel.agentConfig.safeMode.label')}{diffDot('safeMode')}
                  <span className="ml-1 text-amber-500/80">{t('panel.agentConfig.safeMode.warn')}</span>
                </span>
              </label>
              {/* §4 (스트림 3종) — CLI 가 주는데 우리가 안 받던 것들. ①만 기본 켬. */}
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={forwardSubagentText}
                  onChange={(e) => setForwardSubagentText(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                />
                <span>
                  {t('panel.agentConfig.forwardSubagentText.label')}{diffDot('forwardSubagentText')}
                  <span className="ml-1 text-gray-600">{t('panel.agentConfig.forwardSubagentText.hint')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={replayUserMessages}
                  onChange={(e) => setReplayUserMessages(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                />
                <span>
                  {t('panel.agentConfig.replayUserMessages.label')}{diffDot('replayUserMessages')}
                  <span className="ml-1 text-gray-600">{t('panel.agentConfig.replayUserMessages.hint')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={promptSuggestions}
                  onChange={(e) => setPromptSuggestions(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                />
                <span>
                  {t('panel.agentConfig.promptSuggestions.label')}{diffDot('promptSuggestions')}
                  <span className="ml-1 text-gray-600">{t('panel.agentConfig.promptSuggestions.hint')}</span>
                </span>
              </label>
              {/* §4 (CLI 사양 추종) — 훅 생명주기를 스트림에도. 훅은 이미 다른 통로로 받고 있지만,
                  그건 대화록 **바깥**이라 어느 자리에서 떴는지는 알 수 없다. 켜면 그 사건이 대화록
                  안에 시간순으로 끼어든다(끄면 종전과 완전히 같다). */}
              <label className="flex items-start gap-2 text-[12px] text-gray-400">
                <input
                  type="checkbox"
                  checked={includeHookEvents}
                  onChange={(e) => setIncludeHookEvents(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                />
                <span>
                  {t('panel.agentConfig.includeHookEvents.label')}{diffDot('includeHookEvents')}
                  <span className="ml-1 text-gray-600">{t('panel.agentConfig.includeHookEvents.hint')}</span>
                </span>
              </label>
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-[12px] font-medium text-gray-500">
                  {t('panel.agentConfig.betas.label')}{diffDot('betas')}
                  <InfoTip text={t('panel.agentConfig.betas.tip')} />
                </label>
                <input
                  type="text"
                  value={betas}
                  onChange={(e) => setBetas(e.target.value)}
                  placeholder={t('panel.agentConfig.betas.placeholder')}
                  className="min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500"
                />
              </div>

              {/* §4 (CLI 사양 추종) — 이 세션에만 존재하는 서브에이전트 정의(`--agents`).
                  파일(`~/.claude/agents/*.md`)을 만들지 않으므로 다른 프로젝트로 새지 않는다.
                  ⚠ `Task` 도구가 목록에 없으면 정의해도 부를 방법이 없다 — 그 경고를 함께 띄운다. */}
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center text-[12px] font-medium text-gray-500">
                  {t('panel.agentConfig.agentDefinitions.label')}{diffDot('agentDefinitions')}
                  <InfoTip text={t('panel.agentConfig.agentDefinitions.tip')} />
                </label>
                {agentDefinitions.length > 0 && !tools.includes('Task') && (
                  <span className="text-[12px] text-amber-500/80">{t('panel.agentConfig.agentDefinitions.needsTaskTool')}</span>
                )}
                {agentDefinitions.map((def, i) => (
                  <div key={i} className="flex flex-col gap-1 rounded border border-gray-700/70 bg-gray-800/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={def.name}
                        onChange={(e) => setAgentDefinitions(agentDefinitions.map((d, j) => (j === i ? { ...d, name: e.target.value } : d)))}
                        placeholder={t('panel.agentConfig.agentDefinitions.namePlaceholder')}
                        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setAgentDefinitions(agentDefinitions.filter((_, j) => j !== i))}
                        title={t('panel.agentConfig.agentDefinitions.remove')}
                        aria-label={t('panel.agentConfig.agentDefinitions.remove')}
                        className="flex-shrink-0 rounded p-1 text-gray-500 hover:bg-gray-700/60 hover:text-red-400"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={def.description}
                      onChange={(e) => setAgentDefinitions(agentDefinitions.map((d, j) => (j === i ? { ...d, description: e.target.value } : d)))}
                      placeholder={t('panel.agentConfig.agentDefinitions.descPlaceholder')}
                      className="min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-blue-500"
                    />
                    <textarea
                      value={def.prompt}
                      onChange={(e) => setAgentDefinitions(agentDefinitions.map((d, j) => (j === i ? { ...d, prompt: e.target.value } : d)))}
                      placeholder={t('panel.agentConfig.agentDefinitions.promptPlaceholder')}
                      rows={2}
                      className="min-w-0 resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAgentDefinitions([...agentDefinitions, { name: '', description: '', prompt: '' }])}
                  className="self-start rounded border border-dashed border-gray-600 px-2.5 py-1 text-xs text-gray-500 hover:border-emerald-500 hover:text-emerald-400"
                >
                  {t('panel.agentConfig.agentDefinitions.add')}
                </button>
              </div>

              {/* §4 (CLI 사양 추종) — 세션 한정 플러그인 폴더(`--plugin-dir`). **줄 단위**로 받는다 —
                  경로에 쉼표가 들어갈 수 있어 쉼표 구분이면 그 경로가 두 조각으로 잘린다. */}
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-[12px] font-medium text-gray-500">
                  {t('panel.agentConfig.pluginDirs.label')}{diffDot('pluginDirs')}
                  <InfoTip text={t('panel.agentConfig.pluginDirs.tip')} />
                </label>
                <textarea
                  value={pluginDirs}
                  onChange={(e) => setPluginDirs(e.target.value)}
                  placeholder={t('panel.agentConfig.pluginDirs.placeholder')}
                  rows={2}
                  className="min-w-0 resize-y rounded border border-gray-700 bg-gray-800 px-2 py-1.5 font-mono text-[12px] text-gray-200 outline-none focus:border-blue-500"
                />
              </div>
              {/* §4 (CLI 사양 추종) — Bash 타임아웃(초). 0 = 미설정(CLI 기본 유지).
                  상한을 올려야 10분(600초)에서 잘리던 긴 빌드·테스트가 끝까지 간다. */}
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center text-[12px] font-medium text-gray-500">
                  {t('panel.agentConfig.bashTimeout.label')}
                  <InfoTip text={t('panel.agentConfig.bashTimeout.tip')} />
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.defaultLabel')}{diffDot('bashDefaultTimeoutMs')}</label>
                    <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                      <input
                        type="number"
                        min={0}
                        max={BASH_TIMEOUT_MS_MAX / 1000}
                        value={bashDefaultTimeoutSec}
                        onChange={(e) => setBashDefaultTimeoutSec(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full min-w-0 flex-1 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="flex w-7 items-center justify-center border-l border-gray-700 text-xs text-gray-500">s</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.maxLabel')}{diffDot('bashMaxTimeoutMs')}</label>
                    <div className="flex items-stretch rounded border border-gray-700 bg-gray-800 focus-within:border-blue-500">
                      <input
                        type="number"
                        min={0}
                        max={BASH_TIMEOUT_MS_MAX / 1000}
                        value={bashMaxTimeoutSec}
                        onChange={(e) => setBashMaxTimeoutSec(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full min-w-0 flex-1 bg-transparent px-2 py-1.5 text-center text-sm text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="flex w-7 items-center justify-center border-l border-gray-700 text-xs text-gray-500">s</span>
                    </div>
                  </div>
                </div>
                <span className="text-[12px] text-gray-600">
                  {t('panel.agentConfig.bashTimeout.hint', {
                    defaultSec: BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT / 1000,
                    maxSec: BASH_MAX_TIMEOUT_MS_CLI_DEFAULT / 1000,
                  })}
                </span>
              </div>
            </div>
            )}

            {/* Skills
                §5.19 (G) — 스킬은 클로드 CLI 가 해석하는 것이라 로컬 모델에게는 그저 텍스트로 흘러간다.
                IDE 입력창의 스킬 드롭다운을 로컬에서 감춘 것과 같은 이유로 여기서도 뜨지 않는다. */}
            {!isLocal && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.defaultSkills')}<InfoTip text={FIELD_TIPS.skills} />{diffDot('skills')}</label>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const info = availableSkills.find((a) => a.name === s);
                  const chipTone = info?.source === 'project'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : info?.source === 'global'
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-purple-500/15 text-purple-400';
                  const xTone = info?.source === 'project'
                    ? 'text-emerald-400/60'
                    : info?.source === 'global'
                      ? 'text-sky-400/60'
                      : 'text-purple-400/60';
                  const chip = (
                    <span key={s} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${chipTone}`}>
                      {s}
                      <button type="button" onClick={() => removeSkill(s)} className={`ml-0.5 ${xTone} hover:text-red-400`}>×</button>
                    </span>
                  );
                  return info?.description ? <HoverTip key={s} text={info.description} className="inline-flex">{chip}</HoverTip> : chip;
                })}
              </div>
              <div className="relative">
                <button ref={skillPicker.btnRef} type="button" onClick={skillPicker.toggle} disabled={availableSkills.filter((s) => !skills.includes(s.name)).length === 0} className="rounded border border-dashed border-gray-600 px-2.5 py-1 text-xs text-gray-500 hover:border-emerald-500 hover:text-emerald-400 disabled:opacity-30">{t('panel.agentConfig.addSkill')}</button>
                {skillPicker.open && createPortal(
                  <div ref={skillPicker.panelRef} className="fixed z-[9999] max-h-80 overflow-y-auto rounded border border-gray-700 bg-gray-800 py-1 shadow-xl scrollbar-thin" style={{ ...skillPicker.pos, minWidth: 280, maxWidth: 360 }}>
                    {/* Project Skills */}
                    {availableSkills.some((s) => s.source === 'project' && !skills.includes(s.name)) && (
                      <>
                        <div className="px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-emerald-500/70">{t('panel.agentConfig.skillSourceProject')}</div>
                        {availableSkills.filter((s) => s.source === 'project' && !skills.includes(s.name)).map((s) => (
                          <button key={s.name} type="button" onClick={() => { addSkill(s.name); skillPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-emerald-500/10">
                            <span className="text-xs font-medium text-emerald-400">{s.name}</span>
                            {s.description && <span className="line-clamp-2 text-[12px] leading-tight text-gray-500">{s.description}</span>}
                          </button>
                        ))}
                      </>
                    )}
                    {/* Global Skills — 홈 ~/.claude (전 프로젝트 공통) */}
                    {availableSkills.some((s) => s.source === 'global' && !skills.includes(s.name)) && (
                      <>
                        <div className="px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-sky-500/70">{t('panel.agentConfig.skillSourceGlobal')}</div>
                        {availableSkills.filter((s) => s.source === 'global' && !skills.includes(s.name)).map((s) => (
                          <button key={s.name} type="button" onClick={() => { addSkill(s.name); skillPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-sky-500/10">
                            <span className="text-xs font-medium text-sky-400">{s.name}</span>
                            {s.description && <span className="line-clamp-2 text-[12px] leading-tight text-gray-500">{s.description}</span>}
                          </button>
                        ))}
                      </>
                    )}
                    {/* Plugin Skills */}
                    {availableSkills.some((s) => s.source === 'plugin' && !skills.includes(s.name)) && (
                      <>
                        <div className="px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-purple-500/70">{t('panel.agentConfig.skillSourcePlugin')}</div>
                        {availableSkills.filter((s) => s.source === 'plugin' && !skills.includes(s.name)).map((s) => (
                          <button key={s.name} type="button" onClick={() => { addSkill(s.name); skillPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-purple-500/10">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-purple-400">{s.name}</span>
                              {s.pluginName && <span className="text-[12px] text-gray-600">{s.pluginName}</span>}
                            </div>
                            {s.description && <span className="line-clamp-2 text-[12px] leading-tight text-gray-500">{s.description}</span>}
                          </button>
                        ))}
                      </>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
            )}

            {/* Color */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.color')}<InfoTip text={FIELD_TIPS.color} /></label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowColorPicker(!showColorPicker)} className="flex items-center gap-2 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 hover:border-gray-600">
                  <div className="h-4 w-4 rounded-full border border-gray-600" style={{ backgroundColor: color }} />
                  <span className="font-mono text-xs text-gray-300">{color}</span>
                </button>
              </div>
              {showColorPicker && (
                <div className="mt-1"><HexColorPicker color={color} onChange={setColor} /></div>
              )}
            </div>

          </div>
        </ScrollFade>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-700 px-4 py-3">
          {/* §5.5 #17-6 — 오버레이 위젯 토글. packaged + customCreated 한정. */}
          {hasOverlayApi && isCustomAgent ? (
            <button
              type="button"
              onClick={handleToggleOverlay}
              title={isInOverlay
                ? t('overlay.removeFromOverlay', { defaultValue: 'Remove this bubble from the desktop overlay' })
                : t('overlay.sendToOverlay', { defaultValue: 'Pop this bubble out as an always-on-top desktop widget' })}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isInOverlay
                  ? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="13" height="13" rx="2" />
                <path d="M21 8v10a2 2 0 0 1-2 2H9" />
              </svg>
              {isInOverlay
                ? t('overlay.removeFromOverlayLabel', { defaultValue: 'In overlay' })
                : t('overlay.sendToOverlayLabel', { defaultValue: 'Overlay' })}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200">{t('panel.agentConfig.cancel')}</button>
            <button type="button" onClick={handleSave} disabled={saving} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{saving ? t('panel.agentConfig.saving') : t('panel.agentConfig.save')}</button>
          </div>
        </div>
      </div>

      {/* Rules Editor Overlay — §5.3 #28 (K) v1.48: 좌 본문 + 우 히스토리 패널 2-column */}
      {showRulesEditor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" {...rulesBackdrop}>
          <div className="flex h-[82vh] max-h-[92dvh] w-[960px] max-w-[94vw] flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <h3 className="text-sm font-bold text-gray-100">{t('panel.agentConfig.agentRules')}</h3>
              <button type="button" onClick={() => setShowRulesEditor(false)} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Left — 본문 편집 */}
              <div className="flex flex-1 flex-col overflow-hidden">
                <p className="px-4 pt-2 text-[12px] text-gray-600">{t('panel.agentConfig.rulesEditor.help', { defaultValue: 'Custom rules injected into the agent prompt on every run (Markdown)' })}</p>
                <textarea
                  value={rules}
                  onChange={(e) => { setRules(e.target.value); setHistoryPreviewTs(null); }}
                  autoFocus
                  placeholder={"# Rules\n- Follow the implementation plan exactly\n- Run tests after each change\n- Report immediately if any existing tests break"}
                  className="scrollbar-thin mx-4 mt-2 flex-1 resize-none rounded border border-gray-700 bg-gray-800 p-3 font-mono text-sm leading-relaxed text-gray-200 outline-none placeholder:text-gray-600 focus:border-blue-500"
                />
                {/* v1.33 — 자동 주입되는 outbound 엣지 섹션 전체 미리보기 */}
                <div className="mx-4 mt-2">
                  <AutoEdgeSection agentId={agentId} />
                </div>
              </div>
              {/* Right — Rules History 패널 (폰에선 숨김 — 좁은 화면에서 본문 편집 우선) */}
              <div className="flex w-[320px] flex-col border-l border-gray-700 bg-gray-950/40 max-md:hidden">
                <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">
                    {t('panel.agentConfig.rulesHistory.title', { defaultValue: 'History' })}
                  </span>
                  <span className="text-[12px] text-gray-600">{rulesHistory.length}/20</span>
                </div>
                {rulesHistory.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] leading-snug text-gray-600">
                    {t('panel.agentConfig.rulesHistory.empty', { defaultValue: '히스토리 없음 — 룰을 변경하고 저장하면 직전 값이 여기에 쌓입니다.' })}
                  </div>
                ) : (
                  <ul className="scrollbar-thin flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
                    {[...rulesHistory].reverse().map((entry) => {
                      const isPreview = historyPreviewTs === entry.ts;
                      const labelCls =
                        entry.label === 'auto:conti-on'
                          ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
                          : entry.label === 'auto:conti-off'
                            ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
                            : 'bg-gray-700/40 text-gray-300 border-gray-600/50';
                      const firstLine = entry.rules.split('\n').find((l) => l.trim()) ?? '(empty)';
                      return (
                        <li key={entry.ts}>
                          <button
                            type="button"
                            onClick={() => setHistoryPreviewTs(isPreview ? null : entry.ts)}
                            className={`flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left transition-colors ${
                              isPreview ? 'border-blue-500/60 bg-blue-900/20' : 'border-gray-700/60 bg-gray-800/40 hover:border-gray-500'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`rounded border px-1.5 py-0.5 font-mono text-[12px] ${labelCls}`}>{entry.label}</span>
                              <span className="ml-auto font-mono text-[12px] text-gray-500">
                                {new Date(entry.ts).toLocaleString()}
                              </span>
                            </div>
                            <span className="truncate text-[12px] text-gray-400">{firstLine}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {historyPreviewTs !== null && (() => {
                  const entry = rulesHistory.find((e) => e.ts === historyPreviewTs);
                  if (!entry) return null;
                  return (
                    <div className="flex flex-col gap-2 border-t border-gray-800 bg-gray-900/60 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                          {t('panel.agentConfig.rulesHistory.preview', { defaultValue: 'Preview' })}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setRules(entry.rules); setHistoryPreviewTs(null); }}
                          className="rounded border border-blue-700/60 bg-blue-900/30 px-2 py-0.5 text-[12px] font-medium text-blue-300 hover:bg-blue-900/50"
                          title={t('panel.agentConfig.rulesHistory.restoreTitle', { defaultValue: '텍스트영역에 로드 (저장 전까지 dirty)' })}
                        >
                          {t('panel.agentConfig.rulesHistory.restore', { defaultValue: '되돌리기' })}
                        </button>
                      </div>
                      <pre className="scrollbar-thin max-h-32 overflow-auto rounded border border-gray-700 bg-gray-950 p-2 font-mono text-[12px] leading-snug text-gray-300">
                        {entry.rules}
                      </pre>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
              <button type="button" onClick={() => setShowRulesEditor(false)} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200">{t('panel.agentConfig.cancel')}</button>
              <button
                type="button"
                onClick={() => {
                  // §5.3 #28 (K) v1.48 — 인라인 Save 도 본 메인 handleSave 와 동일 페이로드.
                  // §4 v1.53 — buildPayload 로 통합해 새 필드(contextWindow/presetId)도 자동 포함.
                  fetch(`${API_BASE}/api/agent-config/${agentId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()),
                  }).catch(() => {});
                  setShowRulesEditor(false);
                }}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >{t('panel.agentConfig.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
