import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AgentConfig } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  CONTI_AGENT_RULES,
  isOpusModel,
  resolveAliasToLatest,
} from '@vibisual/shared';
import type { ModelFamily } from '@vibisual/shared';
import { HexColorPicker } from 'react-colorful';
import { ScrollFade } from '../ScrollFade.js';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

interface SelectOption { value: string; description: string; disabled?: boolean }

const MODEL_VALUES = ['opus', 'sonnet', 'haiku'] as const;
const PERMISSION_VALUES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
const ISOLATION_VALUES = ['none', 'worktree'] as const;
// §4 v1.49 — Opus 4.7 신규 등급 'xhigh' (이전 'max' 대체)
const EFFORT_VALUES = ['default', 'low', 'medium', 'high', 'xhigh'] as const;

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
          className="pointer-events-none fixed z-[9999] max-w-56 -translate-x-1/2 -translate-y-full rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-[10px] leading-snug text-gray-300 shadow-lg"
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

// ─── Portal Dropdown Hook ───

function usePortalDropdown(placement: 'below' | 'left' = 'below') {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        if (placement === 'left') {
          setPos({ bottom: window.innerHeight - r.bottom, right: window.innerWidth - r.left + 6 });
        } else {
          setPos({ top: r.bottom + 4, left: r.left, minWidth: r.width });
        }
      }
      return !prev;
    });
  }, [placement]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleScroll = (e: Event): void => {
      // 드롭다운 내부 스크롤은 무시
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

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
        <span>{value}</span>
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
              <span className={`text-xs font-medium ${opt.value === value ? 'text-blue-400' : 'text-gray-200'}`}>{opt.value}</span>
              <span className="text-[10px] leading-tight text-gray-500">{opt.description}</span>
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
      <div className="rounded border border-gray-800 bg-gray-950/40 px-2.5 py-2 text-[11px] text-gray-600">
        {t('panel.agentConfig.autoEdge.empty')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-indigo-800/50 bg-indigo-950/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-indigo-300">
          <svg viewBox="0 0 24 24" className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          {t('panel.agentConfig.autoEdge.title')}
        </span>
        <span className="text-[10px] text-indigo-500/70">{edges.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {edges.map((e) => {
          const rowCls = e.inactive
            ? 'rounded bg-gray-800/50 px-2 py-1 text-[11px] text-gray-500 opacity-70'
            : 'rounded bg-indigo-950/30 px-2 py-1 text-[11px] text-indigo-100';
          const labelCls = e.inactive
            ? 'font-semibold text-gray-400 line-through decoration-gray-500/60'
            : 'font-semibold text-indigo-200';
          const metaCls = e.inactive ? 'text-[10px] text-gray-500' : 'text-[10px] text-indigo-400/80';
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
                    <div className="mt-0.5 flex items-start gap-1 text-[10px] text-amber-400/80">
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
        <div className="mt-1 text-[10px] text-indigo-500/70">
          {t('panel.agentConfig.autoEdge.footnote')}
        </div>
      )}
    </div>
  );
}

export function AgentConfigPopup({ agentId, config, currentColor, onClose }: AgentConfigPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const base = config ?? { ...DEFAULT_AGENT_CONFIG, color: currentColor };
  // v1.37 — STRICT outbound 엣지 타겟 툴은 소스에서 박탈(회색 표시). 서버 dispatch strip 과 동일.
  const strictStripSet = useStrictStripSet(agentId);

  const MODEL_OPTIONS: SelectOption[] = useMemo(
    () => MODEL_VALUES.map((v) => ({ value: v, description: t(`panel.agentConfig.model.${v}`) })),
    [t],
  );
  const PERMISSION_OPTIONS: SelectOption[] = useMemo(() => PERMISSION_VALUES.map((v) => ({ value: v, description: t(`panel.agentConfig.permissionMode.${v}`) })), [t]);
  const ISOLATION_OPTIONS: SelectOption[] = useMemo(() => ISOLATION_VALUES.map((v) => ({ value: v, description: t(`panel.agentConfig.isolation.${v}`) })), [t]);
  const EFFORT_OPTIONS: SelectOption[] = useMemo(() => EFFORT_VALUES.map((v) => ({ value: v, description: t(`panel.agentConfig.effort.${v}`) })), [t]);
  const TOOL_DESCRIPTIONS: Record<string, string> = useMemo(() => Object.fromEntries(
    ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'WebFetch', 'NotebookEdit'].map((tool) => [tool, t(`panel.agentConfig.tools.${tool}`)]),
  ), [t]);
  const FIELD_TIPS = useMemo(() => ({
    model: t('panel.agentConfig.fieldTips.model'),
    permissionMode: t('panel.agentConfig.fieldTips.permissionMode'),
    rules: t('panel.agentConfig.fieldTips.rules'),
    tools: t('panel.agentConfig.fieldTips.tools'),
    maxTurns: t('panel.agentConfig.fieldTips.maxTurns'),
    isolation: t('panel.agentConfig.fieldTips.isolation'),
    effort: t('panel.agentConfig.fieldTips.effort'),
    skills: t('panel.agentConfig.fieldTips.skills'),
    color: t('panel.agentConfig.fieldTips.color'),
  }), [t]);

  const [model, setModel] = useState(base.model);
  // §4 v2.38 — 특정 풀ID 핀. undefined = alias=latest 모드.
  const [modelVersion, setModelVersion] = useState<string | undefined>(base.modelVersion);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
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
  const [isolation, setIsolation] = useState(base.isolation ?? 'none');
  const [effort, setEffort] = useState(base.effort ?? 'default');
  // §4 v1.53 — disallowedTools UI 노출 (Tools 아래 빨간 칩 라인)
  const [disallowedTools, setDisallowedTools] = useState<string[]>([...(base.disallowedTools ?? [])]);
  // §4 v1.53 — Opus 1M 컨텍스트 토글. **기본 ON** — undefined/'1m' 둘 다 체크, '200k' 만 언체크.
  const [contextWindow, setContextWindow] = useState<'1m' | '200k' | undefined>(base.contextWindow);
  const oneMillionEnabled = contextWindow !== '200k';
  // §4 v1.53 — 프리셋 트레이스 (UI 제거됨, 기존 값은 save 시 그대로 보존)
  const [presetId] = useState<string | undefined>(base.presetId);
  const [rules, setRules] = useState(base.rules ?? '');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  // §5.3 #28 (K) v1.48 — Rules 히스토리 미리보기 선택 (null=텍스트영역, ts=해당 항목 본문)
  const [historyPreviewTs, setHistoryPreviewTs] = useState<number | null>(null);
  const rulesHistory = base.rulesHistory ?? [];
  const [saving, setSaving] = useState(false);
  const [contextItems, setContextItems] = useState<{ name: string; type: string; summary?: string; lines?: number; path?: string }[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string; source: 'project' | 'plugin'; pluginName?: string }[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

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

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
    const family = (model === 'opus' || model === 'sonnet' || model === 'haiku') ? model as ModelFamily : null;
    if (!family) return [];
    const fams = (modelRegistry?.entries ?? []).filter((e) => e.family === family);
    fams.sort((a, b) => {
      const pa = /^claude-(?:opus|sonnet|haiku)-(\d+)-(\d{1,2})$/.exec(a.id);
      const pb = /^claude-(?:opus|sonnet|haiku)-(\d+)-(\d{1,2})$/.exec(b.id);
      const aMaj = pa ? Number(pa[1]) : 0;
      const aMin = pa ? Number(pa[2]) : 0;
      const bMaj = pb ? Number(pb[1]) : 0;
      const bMin = pb ? Number(pb[2]) : 0;
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

  // §4 v2.41 — Model 셀렉트 바로 아래 작은 글씨 라벨: CLI 에 실제로 전달될 모델 인자.
  // alias 모드면 "opus[1m]" 식, 풀ID 핀이면 "claude-opus-4-7[1m]" 식.
  const effectiveCliArg = useMemo(() => {
    const base = modelVersion?.trim() || model;
    const suffix = (model === 'opus' && contextWindow !== '200k') ? '[1m]' : '';
    return base + suffix;
  }, [model, modelVersion, contextWindow]);

  const removeTool = useCallback((t: string) => setTools((p) => p.filter((x) => x !== t)), []);
  const removeSkill = useCallback((s: string) => setSkills((p) => p.filter((x) => x !== s)), []);

  const addSkill = useCallback((name: string) => {
    setSkills((p) => p.includes(name) ? p : [...p, name]);
  }, []);

  const buildPayload = useCallback((): AgentConfig => ({
    model, tools, permissionMode, skills, color,
    maxTurns: maxTurns > 0 ? maxTurns : undefined,
    isolation: isolation !== 'none' ? isolation : undefined,
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
  }), [
    model, tools, permissionMode, permissionTimeoutPolicy, skills, color, maxTurns, isolation, effort,
    isOpus, disallowedTools, rules, customMode,
    contextWindow, presetId, modelVersion,
  ]);

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

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleOverlayClick}>
      <div className="flex max-h-[80vh] w-[420px] flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-100">
            {t('panel.agentConfig.title')}
            <HoverTip text={t('panel.agentConfig.fieldTips.agentSettingsNote')} className="inline-flex cursor-help">
              <svg className="h-3.5 w-3.5 text-yellow-500/70 hover:text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4Zm.75 7a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
              </svg>
            </HoverTip>
          </h3>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <ScrollFade fill className="flex-1">
          <div className="flex flex-col gap-4 p-4">

            {/* Model */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.model.label')}<InfoTip text={FIELD_TIPS.model} /></label>
              <CustomSelect value={model} onChange={handleModelChange} options={MODEL_OPTIONS} />

              {/* §4 v2.41 — 작은 인라인 버전 라인. `version: claude-opus-4-8 ▾` 식.
                  native <select> 로 컴팩트 + 옵션 4개 이내 (Latest / 최신 / 직전 / Custom…) */}
              <div className="mt-0.5 flex items-center gap-1 px-0.5 text-[10px] text-gray-500">
                <span className="uppercase tracking-wider">{t('panel.agentConfig.modelVersion.label', { defaultValue: 'Version' })}:</span>
                <select
                  value={effectiveVersionValue}
                  onChange={(e) => handleVersionChange(e.target.value)}
                  className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 font-mono text-[10px] text-gray-300 outline-none hover:border-gray-600 focus:border-blue-500"
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
                    className="flex-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-0 font-mono text-[10px] text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
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
                    {t('panel.agentConfig.contextWindow.oneMillion', { defaultValue: '1M context window' })}
                  </span>
                </label>
              )}
            </div>

            {/* Permission Mode */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.permissionMode.label')}<InfoTip text={FIELD_TIPS.permissionMode} /></label>
              <CustomSelect value={permissionMode} onChange={setPermissionMode} options={PERMISSION_OPTIONS} />
            </div>

            {/* §5.3 #12-1 v1.90 — On no response (60s) fallback. bypass/plan 은 팝업 자체가 안 떠 무의미 → 숨김 */}
            {permissionMode !== 'bypassPermissions' && permissionMode !== 'plan' && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center text-xs font-medium text-gray-400">
                  {t('panel.agentConfig.permissionTimeoutPolicy.label', { defaultValue: 'On no response (60s)' })}
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
                        className={`relative flex flex-1 items-center justify-center gap-1.5 rounded text-[11px] font-semibold uppercase tracking-wide transition-colors ${
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

            {/* §5.3 #28 v1.47 — Custom Mode (Vibisual 콘티/리뷰/디버그 모드 축, claude CLI 와 직교) */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center text-xs font-medium text-gray-400">
                {t('panel.agentConfig.customMode.label', { defaultValue: 'Custom Mode' })}
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
                <p className="flex items-start gap-1.5 text-[10px] leading-tight text-amber-400/85">
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
                <p className="flex items-start gap-1.5 text-[10px] leading-tight text-gray-400">
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
                <p className="text-[10px] leading-tight text-amber-400/70">
                  {t('panel.agentConfig.customMode.placeholderHint', {
                    defaultValue: '이 모드는 아직 구현되지 않았습니다 — 저장은 되지만 동작은 비활성.',
                  })}
                </p>
              ) : null}
              {customMode === 'conti' && (
                <p className="text-[10px] leading-tight text-emerald-400/80">
                  {t('panel.agentConfig.customMode.contiHint', {
                    defaultValue: '저장 시 에이전트 옆에 콘티 버블이 자동 생성됩니다 (단일 클릭=히스토리, 더블 클릭=보드).',
                  })}
                </p>
              )}
            </div>

            {/* Agent Rules */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.agentRules')}<InfoTip text={FIELD_TIPS.rules} /></label>
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
                <span className="ml-auto text-[10px] text-gray-600">{t('panel.agentConfig.contextItems', { count: contextItems.length })}</span>
              </button>
              {contextOpen && (
                <div className="mt-1 flex flex-col gap-0.5 rounded border border-gray-700/50 bg-gray-800/50 p-2">
                  {contextItems.filter((i) => i.type === 'readable').map((item) => (
                    <div key={item.name} className="group/ctx flex flex-col gap-0.5 rounded px-2 py-1 hover:bg-gray-700/30">
                      <div className="flex items-center gap-1.5">
                        <svg className="h-3 w-3 flex-shrink-0 text-emerald-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.3 5.7-4 4a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06L6.75 9.1l3.47-3.47a.75.75 0 1 1 1.06 1.06Z" /></svg>
                        <span className="text-[11px] font-medium text-gray-300">{item.name}</span>
                        {/* File open + Folder open buttons */}
                        {item.path && (
                          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/ctx:opacity-100">
                            {item.lines != null && <span className="mr-1 text-[10px] text-gray-600">{item.lines}L</span>}
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
                        {!item.path && item.lines != null && <span className="ml-auto text-[10px] text-gray-600">{item.lines}L</span>}
                      </div>
                      {item.summary && <span className="pl-[18px] text-[10px] leading-tight text-gray-500">{item.summary}</span>}
                    </div>
                  ))}
                  {contextItems.some((i) => i.type === 'not_accessible') && (
                    <div className="mt-1 border-t border-gray-700/30 pt-1">
                      <span className="px-2 text-[10px] font-medium text-gray-600">Not accessible (Claude Code internal)</span>
                      {contextItems.filter((i) => i.type === 'not_accessible').map((item) => (
                        <div key={item.name} className="flex flex-col gap-0.5 rounded px-2 py-1">
                          <div className="flex items-center gap-1.5">
                            <svg className="h-3 w-3 flex-shrink-0 text-gray-600" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4a4 4 0 0 1 8 0v2h.25A1.75 1.75 0 0 1 14 7.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5A1.75 1.75 0 0 1 3.75 6H4V4Zm6 0v2H6V4a2 2 0 1 1 4 0ZM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" /></svg>
                            <span className="text-[11px] text-gray-500">{item.name}</span>
                          </div>
                          {item.summary && <span className="pl-[18px] text-[10px] leading-tight text-gray-600">{item.summary}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tools */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.tools.label')}<InfoTip text={FIELD_TIPS.tools} /></label>
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
                        {TOOL_DESCRIPTIONS[t] && <span className="text-[10px] leading-tight text-gray-500">{TOOL_DESCRIPTIONS[t]}</span>}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
            </div>

            {/* §4 v1.53 — Disallowed Tools (deny-list). Tools allow-list 와 직교 — Tools 에 있어도 이 칩에 있으면 CLI --disallowedTools 로 차단 */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">
                {t('panel.agentConfig.disallowedTools.label', { defaultValue: 'Disallowed Tools' })}
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
                        {TOOL_DESCRIPTIONS[tool] && <span className="text-[10px] leading-tight text-gray-500">{TOOL_DESCRIPTIONS[tool]}</span>}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
            </div>

            {/* Compact row: Max Turns / Isolation / Effort / Memory */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.maxTurns')}<InfoTip text={FIELD_TIPS.maxTurns} /></label>
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
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.isolation.label')}<InfoTip text={FIELD_TIPS.isolation} /></label>
                <CustomSelect value={isolation} onChange={setIsolation} options={ISOLATION_OPTIONS} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.effort.label')}<InfoTip text={FIELD_TIPS.effort} /></label>
                <CustomSelect value={isOpus ? effort : 'default'} onChange={setEffort} options={EFFORT_OPTIONS} disabled={!isOpus} />
              </div>
            </div>

            {/* Skills */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center text-xs font-medium text-gray-400">{t('panel.agentConfig.defaultSkills')}<InfoTip text={FIELD_TIPS.skills} /></label>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const info = availableSkills.find((a) => a.name === s);
                  const chip = (
                    <span key={s} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${info?.source === 'project' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-purple-500/15 text-purple-400'}`}>
                      {s}
                      <button type="button" onClick={() => removeSkill(s)} className={`ml-0.5 ${info?.source === 'project' ? 'text-emerald-400/60' : 'text-purple-400/60'} hover:text-red-400`}>×</button>
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
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-500/70">Project</div>
                        {availableSkills.filter((s) => s.source === 'project' && !skills.includes(s.name)).map((s) => (
                          <button key={s.name} type="button" onClick={() => { addSkill(s.name); skillPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-emerald-500/10">
                            <span className="text-xs font-medium text-emerald-400">{s.name}</span>
                            {s.description && <span className="line-clamp-2 text-[10px] leading-tight text-gray-500">{s.description}</span>}
                          </button>
                        ))}
                      </>
                    )}
                    {/* Plugin Skills */}
                    {availableSkills.some((s) => s.source === 'plugin' && !skills.includes(s.name)) && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-purple-500/70">Installed Plugins</div>
                        {availableSkills.filter((s) => s.source === 'plugin' && !skills.includes(s.name)).map((s) => (
                          <button key={s.name} type="button" onClick={() => { addSkill(s.name); skillPicker.close(); }} className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-purple-500/10">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-purple-400">{s.name}</span>
                              {s.pluginName && <span className="text-[9px] text-gray-600">{s.pluginName}</span>}
                            </div>
                            {s.description && <span className="line-clamp-2 text-[10px] leading-tight text-gray-500">{s.description}</span>}
                          </button>
                        ))}
                      </>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
            </div>

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
        <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200">{t('panel.agentConfig.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{saving ? t('panel.agentConfig.saving') : t('panel.agentConfig.save')}</button>
        </div>
      </div>

      {/* Rules Editor Overlay — §5.3 #28 (K) v1.48: 좌 본문 + 우 히스토리 패널 2-column */}
      {showRulesEditor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget) setShowRulesEditor(false); }}>
          <div className="flex h-[82vh] w-[960px] flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <h3 className="text-sm font-bold text-gray-100">{t('panel.agentConfig.agentRules')}</h3>
              <button type="button" onClick={() => setShowRulesEditor(false)} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Left — 본문 편집 */}
              <div className="flex flex-1 flex-col overflow-hidden">
                <p className="px-4 pt-2 text-[10px] text-gray-600">{t('panel.agentConfig.rulesEditor.help', { defaultValue: 'Custom rules injected into the agent prompt on every run (Markdown)' })}</p>
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
              {/* Right — Rules History 패널 */}
              <div className="flex w-[320px] flex-col border-l border-gray-700 bg-gray-950/40">
                <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    {t('panel.agentConfig.rulesHistory.title', { defaultValue: 'History' })}
                  </span>
                  <span className="text-[10px] text-gray-600">{rulesHistory.length}/20</span>
                </div>
                {rulesHistory.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] leading-snug text-gray-600">
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
                              <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${labelCls}`}>{entry.label}</span>
                              <span className="ml-auto font-mono text-[10px] text-gray-500">
                                {new Date(entry.ts).toLocaleString()}
                              </span>
                            </div>
                            <span className="truncate text-[10px] text-gray-400">{firstLine}</span>
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
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          {t('panel.agentConfig.rulesHistory.preview', { defaultValue: 'Preview' })}
                        </span>
                        <button
                          type="button"
                          onClick={() => { setRules(entry.rules); setHistoryPreviewTs(null); }}
                          className="rounded border border-blue-700/60 bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-300 hover:bg-blue-900/50"
                          title={t('panel.agentConfig.rulesHistory.restoreTitle', { defaultValue: '텍스트영역에 로드 (저장 전까지 dirty)' })}
                        >
                          {t('panel.agentConfig.rulesHistory.restore', { defaultValue: '되돌리기' })}
                        </button>
                      </div>
                      <pre className="scrollbar-thin max-h-32 overflow-auto rounded border border-gray-700 bg-gray-950 p-2 font-mono text-[10px] leading-snug text-gray-300">
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
    </div>
  );
}
