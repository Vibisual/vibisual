import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  TaskEdgeForwardMode,
  TaskEdgeTemplate,
  TaskEdgeKind,
  TaskEdgeMessageFormat,
  TaskEdgeReturnFormat,
  TaskEdgePriority,
  TaskEdgeCritiqueTiming,
  TaskEdgeCritiqueAuthority,
  TaskEdgeCommandMode,
} from '@vibisual/shared';
import { TASK_EDGE_TEMPLATES, TASK_EDGE_KIND_STYLES, TASK_EDGE_DEFAULTS, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface TaskEdgePopupProps {
  sourceAgentId: string;
  targetAgentId: string;
  /** Screen coordinates of the triggering click (popup anchors relative to this). */
  screenX: number;
  screenY: number;
  onClose: () => void;
  /** Edit mode — when provided, edits an existing edge. null/undefined = create new. */
  editingEdgeId?: string | null;
}

const POPUP_WIDTH = 384; // w-96
const VIEWPORT_MARGIN = 12;

// v1.55 — 사용자가 마지막으로 고른 Critique 옵션 값을 기억해 다음 신규 엣지의 기본값으로 재사용.
//          편집 모드(existingEdge)나 템플릿 명시 선택(handleTemplateSelect)에는 영향 ❌.
const CRITIQUE_DEFAULTS_STORAGE_KEY = 'vibisual.taskEdge.critiqueDefaults';
interface PersistedCritiqueDefaults {
  timing?: TaskEdgeCritiqueTiming;
  authority?: TaskEdgeCritiqueAuthority;
  maxRework?: number;
}
function loadCritiqueDefaults(): PersistedCritiqueDefaults {
  try {
    const raw = localStorage.getItem(CRITIQUE_DEFAULTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedCritiqueDefaults;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function saveCritiqueDefaults(d: PersistedCritiqueDefaults): void {
  try { localStorage.setItem(CRITIQUE_DEFAULTS_STORAGE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

/** Sort templates by how well they match the source/target agent roles. */
function matchTemplates(
  sourceAgentId: string,
  targetAgentId: string,
  agents: { id: string; agentRole?: string }[],
): TaskEdgeTemplate[] {
  const source = agents.find((a) => a.id === sourceAgentId);
  const target = agents.find((a) => a.id === targetAgentId);
  const srcRole = source?.agentRole ?? null;
  const tgtRole = target?.agentRole ?? null;

  return [...TASK_EDGE_TEMPLATES].sort((a, b) => {
    const scoreA = (a.sourceRole === srcRole ? 2 : 0) + (a.targetRole === tgtRole ? 2 : 0) + (a.sourceRole === null ? 0 : -1);
    const scoreB = (b.sourceRole === srcRole ? 2 : 0) + (b.targetRole === tgtRole ? 2 : 0) + (b.sourceRole === null ? 0 : -1);
    return scoreB - scoreA;
  });
}

/** Inline help icon with a custom hover tooltip. Rendered via fixed positioning
 * so it escapes the popup's `overflow-y-auto` and never gets clipped. */
function InfoIcon({ title }: { title: string }): React.JSX.Element {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const handleEnter = useCallback(() => {
    if (iconRef.current) setRect(iconRef.current.getBoundingClientRect());
  }, []);
  const handleLeave = useCallback(() => setRect(null), []);

  return (
    <>
      <span
        ref={iconRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-gray-600 text-[9px] leading-none text-gray-500 hover:border-gray-400 hover:text-gray-300"
      >
        ?
      </span>
      {rect && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] w-64 rounded border border-gray-600 bg-gray-950 px-2 py-1.5 text-[11px] leading-snug text-gray-200 shadow-xl"
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 264, rect.left + rect.width / 2 - 128)),
            top: rect.top - 6,
            transform: 'translateY(-100%)',
          }}
        >
          {title}
        </div>
      )}
    </>
  );
}

export function TaskEdgePopup({ sourceAgentId, targetAgentId, screenX, screenY, onClose, editingEdgeId }: TaskEdgePopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  const createTaskEdge = useGraphStore((s) => s.createTaskEdge);
  const updateTaskEdge = useGraphStore((s) => s.updateTaskEdge);
  const deleteTaskEdge = useGraphStore((s) => s.deleteTaskEdge);
  const existingEdge = useGraphStore((s) => (editingEdgeId ? s.taskEdges[editingEdgeId] : null));
  const setTaskEdgePreview = useGraphStore((s) => s.setTaskEdgePreview);
  const clearTaskEdgePreview = useGraphStore((s) => s.clearTaskEdgePreview);

  // Shared hover tooltip for every button/control. Only one element can be
  // hovered at a time, so a single shared slot is enough.
  const [hoverTip, setHoverTip] = useState<{ rect: DOMRect; text: string } | null>(null);
  const tipProps = useCallback(
    (text: string) => ({
      onMouseEnter: (e: React.MouseEvent) => {
        setHoverTip({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), text });
      },
      onMouseLeave: () => setHoverTip(null),
    }),
    [],
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // v1.48 — backdrop 닫기 판정용. mousedown 이 backdrop 위에서 시작했고 mouseup 도 backdrop 위에서
  // 끝났을 때만 닫는다. textarea/input 안에서 드래그-선택을 시작했다가 마우스가 카드 밖으로
  // 빠져나간 뒤 mouseup 되는 경우(자연스러운 텍스트 선택)에 팝업이 닫히는 것을 방지.
  const mainBackdropDownRef = useRef(false);
  const schemaBackdropDownRef = useRef(false);

  const isEditing = Boolean(editingEdgeId);

  const templates = useMemo(
    () => matchTemplates(sourceAgentId, targetAgentId, agents),
    [sourceAgentId, targetAgentId, agents],
  );

  const initialTemplate = useMemo<TaskEdgeTemplate>(() => {
    if (existingEdge?.templateId) {
      const found = templates.find((tmpl) => tmpl.id === existingEdge.templateId);
      if (found) return found;
    }
    return templates[0]!;
  }, [existingEdge, templates]);

  const [selectedTemplate, setSelectedTemplate] = useState<TaskEdgeTemplate>(initialTemplate);
  const [command, setCommand] = useState(existingEdge?.command ?? initialTemplate.defaultCommand);
  const [forwardMode, setForwardMode] = useState<TaskEdgeForwardMode>(
    existingEdge?.forwardMode ?? initialTemplate.defaultForwardMode,
  );
  const [kind, setKind] = useState<TaskEdgeKind>(
    existingEdge?.kind ?? initialTemplate.defaultKind ?? TASK_EDGE_DEFAULTS.kind,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [messageFormat, setMessageFormat] = useState<TaskEdgeMessageFormat>(
    existingEdge?.messageFormat ?? initialTemplate.defaultMessageFormat ?? TASK_EDGE_DEFAULTS.messageFormat,
  );
  // v1.48 — 자유 형식 schema 본문. messageFormat='schema' 일 때만 적용. 빈 값이면 형식 강제 없음.
  const [messageSchema, setMessageSchema] = useState<string>(existingEdge?.messageSchema ?? '');
  const [schemaEditOpen, setSchemaEditOpen] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState<string>('');
  const [returnFormat, setReturnFormat] = useState<TaskEdgeReturnFormat>(
    existingEdge?.returnFormat ?? initialTemplate.defaultReturnFormat ?? TASK_EDGE_DEFAULTS.returnFormat,
  );
  const [timeoutMs, setTimeoutMs] = useState<number | ''>(
    existingEdge?.timeoutMs ?? '',
  );
  const [retryCount, setRetryCount] = useState<number>(
    existingEdge?.retryCount ?? TASK_EDGE_DEFAULTS.retryCount,
  );
  const [cacheEnabled, setCacheEnabled] = useState<boolean>(
    existingEdge?.cacheEnabled ?? TASK_EDGE_DEFAULTS.cacheEnabled,
  );
  const [priority, setPriority] = useState<TaskEdgePriority>(
    existingEdge?.priority ?? initialTemplate.defaultPriority ?? TASK_EDGE_DEFAULTS.priority,
  );
  // Per-edge delegation policy. strict = mandatory, auto = source agent decides.
  // v1.83 — 신규 엣지는 템플릿의 defaultDelegationPolicy 를 우선 적용(Custom='auto').
  //          편집 모드는 기존 엣지 값 보존.
  const [delegationPolicy, setDelegationPolicy] = useState<'strict' | 'auto'>(
    (existingEdge?.delegationPolicy ?? initialTemplate.defaultDelegationPolicy ?? TASK_EDGE_DEFAULTS.delegationPolicy) as 'strict' | 'auto',
  );
  // v1.41 — Critique 엣지 전용. kind='critique' 일 때만 UI에 노출.
  // v1.55 — 신규 엣지(existingEdge 없음)일 때 사용자의 마지막 Critique 선택값을 기본으로 재현.
  //          편집 모드는 기존 값을 그대로 보존. 템플릿 명시 선택은 handleTemplateSelect 에서 별도로 덮어씀.
  const persistedCritique = useMemo<PersistedCritiqueDefaults>(
    () => (existingEdge ? {} : loadCritiqueDefaults()),
    [existingEdge],
  );
  const [critiqueTiming, setCritiqueTiming] = useState<TaskEdgeCritiqueTiming>(
    existingEdge?.critiqueTiming ?? persistedCritique.timing ?? TASK_EDGE_DEFAULTS.critiqueTiming,
  );
  const [critiqueAuthority, setCritiqueAuthority] = useState<TaskEdgeCritiqueAuthority>(
    existingEdge?.critiqueAuthority ?? persistedCritique.authority ?? TASK_EDGE_DEFAULTS.critiqueAuthority,
  );
  const [maxReworkCount, setMaxReworkCount] = useState<number>(
    existingEdge?.maxReworkCount ?? persistedCritique.maxRework ?? TASK_EDGE_DEFAULTS.maxReworkCount,
  );
  // v1.44 — Command 엣지 위임 형태. kind='command' 일 때만 UI에 노출.
  // 기존 엣지에 commandMode 가 없으면 후방호환 추정값을 초기값으로 — 사용자가 즉시 보는 상태가
  // 서버 strip 로직과 일치하도록(undefined+strict → 'tool-delegation', 그 외 → 'shared').
  const inferLegacyCommandMode = (): TaskEdgeCommandMode => {
    // v1.83 — 신규 엣지는 템플릿의 defaultCommandMode 를 우선(Custom='tool-delegation').
    if (!existingEdge) return initialTemplate.defaultCommandMode ?? TASK_EDGE_DEFAULTS.commandMode;
    if (existingEdge.commandMode) return existingEdge.commandMode;
    return (existingEdge.delegationPolicy ?? 'strict') === 'strict' ? 'tool-delegation' : 'shared';
  };
  const [commandMode, setCommandMode] = useState<TaskEdgeCommandMode>(inferLegacyCommandMode());

  // tool-delegation 박탈 대상 도구 = 자식.tools ∩ 부모.tools (실시간 계산).
  const stripPreview = useMemo(() => {
    const src = agentConfigs[sourceAgentId];
    const tgt = agentConfigs[targetAgentId];
    if (!src || !tgt) return [] as string[];
    const tgtSet = new Set(tgt.tools);
    return src.tools.filter((tool) => tgtSet.has(tool));
  }, [agentConfigs, sourceAgentId, targetAgentId]);

  // ─── Viewport-aware positioning + user drag ─────────────────────────────
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [userMoved, setUserMoved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const clampToViewport = useCallback((left: number, top: number, w: number, h: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cLeft = Math.max(VIEWPORT_MARGIN, Math.min(vw - w - VIEWPORT_MARGIN, left));
    const cTop = h + VIEWPORT_MARGIN * 2 > vh
      ? VIEWPORT_MARGIN
      : Math.max(VIEWPORT_MARGIN, Math.min(vh - h - VIEWPORT_MARGIN, top));
    return { left: cLeft, top: cTop };
  }, []);

  const recomputePosition = useCallback(() => {
    const el = popupRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = rect.width || POPUP_WIDTH;
    const h = rect.height;

    if (userMoved) {
      setPosition((prev) => {
        if (!prev) return prev;
        return clampToViewport(prev.left, prev.top, w, h);
      });
      return;
    }

    setPosition(clampToViewport(screenX - w / 2, screenY - h / 2, w, h));
  }, [screenX, screenY, userMoved, clampToViewport]);

  useLayoutEffect(() => {
    recomputePosition();
    if (!mounted) {
      requestAnimationFrame(() => setMounted(true));
    }
  }, [recomputePosition, advancedOpen, mounted]);

  useEffect(() => {
    const el = popupRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputePosition());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputePosition]);

  useEffect(() => {
    const onResize = (): void => recomputePosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputePosition]);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (!position) return;
    e.preventDefault();
    e.stopPropagation();
    dragOffsetRef.current = { x: e.clientX - position.left, y: e.clientY - position.top };
    setDragging(true);
    setUserMoved(true);
  }, [position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: MouseEvent): void => {
      const el = popupRef.current;
      if (!el) return;
      const w = el.offsetWidth || POPUP_WIDTH;
      const h = el.offsetHeight;
      const next = clampToViewport(
        ev.clientX - dragOffsetRef.current.x,
        ev.clientY - dragOffsetRef.current.y,
        w, h,
      );
      setPosition(next);
    };
    const onUp = (): void => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clampToViewport]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!isEditing || !editingEdgeId) return;
    setTaskEdgePreview(editingEdgeId, {
      kind,
      command,
      forwardMode,
      messageFormat,
      messageSchema,
      returnFormat,
      timeoutMs: timeoutMs === '' ? undefined : Number(timeoutMs),
      retryCount,
      cacheEnabled,
      priority,
      critiqueTiming,
      critiqueAuthority,
      maxReworkCount,
      commandMode,
    });
  }, [isEditing, editingEdgeId, kind, command, forwardMode, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode, setTaskEdgePreview]);

  useEffect(() => {
    return () => { clearTaskEdgePreview(); };
  }, [clearTaskEdgePreview]);

  const handleTemplateSelect = useCallback((tmplId: string) => {
    const tmpl = templates.find((x) => x.id === tmplId) ?? templates[0]!;
    setSelectedTemplate(tmpl);
    setCommand(tmpl.defaultCommand);
    setForwardMode(tmpl.defaultForwardMode);
    setKind(tmpl.defaultKind ?? TASK_EDGE_DEFAULTS.kind);
    setMessageFormat(tmpl.defaultMessageFormat ?? TASK_EDGE_DEFAULTS.messageFormat);
    setReturnFormat(tmpl.defaultReturnFormat ?? TASK_EDGE_DEFAULTS.returnFormat);
    setPriority(tmpl.defaultPriority ?? TASK_EDGE_DEFAULTS.priority);
    setRetryCount(TASK_EDGE_DEFAULTS.retryCount);
    setCacheEnabled(TASK_EDGE_DEFAULTS.cacheEnabled);
    setTimeoutMs('');
    setCritiqueTiming(tmpl.defaultCritiqueTiming ?? TASK_EDGE_DEFAULTS.critiqueTiming);
    setCritiqueAuthority(tmpl.defaultCritiqueAuthority ?? TASK_EDGE_DEFAULTS.critiqueAuthority);
    setMaxReworkCount(tmpl.defaultMaxReworkCount ?? TASK_EDGE_DEFAULTS.maxReworkCount);
    setCommandMode(tmpl.defaultCommandMode ?? TASK_EDGE_DEFAULTS.commandMode);
    setDelegationPolicy(tmpl.defaultDelegationPolicy ?? TASK_EDGE_DEFAULTS.delegationPolicy);
  }, [templates]);

  const handleSubmit = useCallback(() => {
    if (!command.trim()) return;
    const options = {
      kind,
      messageFormat,
      // v1.48 — schema 모드 외엔 빈 문자열로 정규화해 prompt 주입에서 자연 스킵.
      messageSchema: messageFormat === 'schema' ? messageSchema : '',
      returnFormat,
      timeoutMs: timeoutMs === '' ? undefined : Number(timeoutMs),
      retryCount,
      cacheEnabled,
      priority,
      delegationPolicy,
      // v1.41 — Critique 옵션은 kind='critique' 일 때만 의미. 다른 kind 에도 저장은 되지만
      // 서버/런타임은 kind='critique' 에서만 해석하도록 설계.
      critiqueTiming,
      critiqueAuthority,
      maxReworkCount,
      // v1.44 — Command 옵션도 kind='command' 일 때만 의미. 항상 저장.
      commandMode,
    };
    if (isEditing && editingEdgeId) {
      updateTaskEdge(editingEdgeId, { command: command.trim(), forwardMode, ...options });
    } else {
      createTaskEdge(sourceAgentId, targetAgentId, command.trim(), forwardMode, selectedTemplate.id, options);
    }
    // v1.55 — kind='critique' 로 저장 시 현재 옵션을 다음 신규 엣지의 기본값으로 기억.
    if (kind === 'critique') {
      saveCritiqueDefaults({
        timing: critiqueTiming,
        authority: critiqueAuthority,
        maxRework: maxReworkCount,
      });
    }
    onClose();
  }, [sourceAgentId, targetAgentId, command, forwardMode, selectedTemplate, kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode, createTaskEdge, updateTaskEdge, onClose, isEditing, editingEdgeId]);

  const handleDelete = useCallback(() => {
    if (editingEdgeId) {
      deleteTaskEdge(editingEdgeId);
      onClose();
    }
  }, [editingEdgeId, deleteTaskEdge, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') onClose();
  }, [handleSubmit, onClose]);

  const sourceLabel = agents.find((a) => a.id === sourceAgentId)?.label ?? 'Agent';
  const targetLabel = agents.find((a) => a.id === targetAgentId)?.label ?? 'Agent';

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        // backdrop 자체에서 시작한 mousedown 만 닫기 후보. 안쪽 카드/textarea 에서 시작한 드래그는 무시.
        mainBackdropDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (e.target === e.currentTarget && mainBackdropDownRef.current) onClose();
        mainBackdropDownRef.current = false;
      }}
    >
      <div
        ref={popupRef}
        className={`scrollbar-thin absolute z-50 max-h-[90vh] w-96 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl ${
          dragging ? 'select-none' : ''
        }`}
        style={{
          left: position?.left ?? screenX,
          top: position?.top ?? screenY,
          visibility: position ? 'visible' : 'hidden',
          transition: mounted && !dragging ? 'left 180ms ease, top 180ms ease' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — drag handle */}
        <div
          className={`mb-2 -mx-3 -mt-3 flex items-center gap-2 rounded-t-lg border-b border-gray-800 bg-gray-900/80 px-3 py-1.5 text-xs text-gray-400 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onMouseDown={handleHeaderMouseDown}
          title={t('bubbleMap.taskEdgePopup.dragToMove')}
        >
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-300">{sourceLabel}</span>
          <span>→</span>
          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-green-300">{targetLabel}</span>
          {isEditing && <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-400">{t('bubbleMap.taskEdgePopup.editBadge')}</span>}
        </div>

        {/* Template dropdown */}
        <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
          {t('bubbleMap.taskEdgePopup.template')}
          <InfoIcon title={t('bubbleMap.taskEdgePopup.templateTooltip')} />
        </div>
        <select
          className="mb-3 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
          value={selectedTemplate.id}
          onChange={(e) => handleTemplateSelect(e.target.value)}
          {...tipProps(t('bubbleMap.taskEdgePopup.templateSelect'))}
        >
          {templates.map((tmpl) => (
            <option key={tmpl.id} value={tmpl.id}>
              {tmpl.label}
            </option>
          ))}
        </select>

        {/* Message */}
        <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
          {t('bubbleMap.taskEdgePopup.message')}
          <InfoIcon title={t('bubbleMap.taskEdgePopup.messageTooltip')} />
        </div>
        <textarea
          ref={inputRef}
          className="scrollbar-thin mb-3 w-full resize-none rounded border border-gray-700 bg-gray-800 p-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          rows={3}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('bubbleMap.taskEdgePopup.messagePlaceholder')}
        />

        {/* Main: Type + Gate */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
              {t('bubbleMap.taskEdgePopup.type')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.typeTooltip')} />
            </div>
            <select
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskEdgeKind)}
              {...tipProps(`${TASK_EDGE_KIND_STYLES[kind].label}: ${TASK_EDGE_KIND_STYLES[kind].description}`)}
            >
              {(Object.keys(TASK_EDGE_KIND_STYLES) as TaskEdgeKind[]).map((k) => (
                <option key={k} value={k} title={TASK_EDGE_KIND_STYLES[k].description}>
                  {TASK_EDGE_KIND_STYLES[k].icon} {TASK_EDGE_KIND_STYLES[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
              {t('bubbleMap.taskEdgePopup.gate')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.gateTooltip')} />
            </div>
            <div className="flex rounded border border-gray-700 bg-gray-800 text-xs">
              <button
                type="button"
                className={`flex-1 rounded-l px-2 py-1 ${
                  forwardMode === 'auto' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
                onClick={() => setForwardMode('auto')}
                {...tipProps(t('bubbleMap.taskEdgePopup.autoTooltip'))}
              >
                {t('bubbleMap.taskEdgePopup.autoBtn')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-r px-2 py-1 ${
                  forwardMode === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
                onClick={() => setForwardMode('manual')}
                {...tipProps(t('bubbleMap.taskEdgePopup.manualTooltip'))}
              >
                {t('bubbleMap.taskEdgePopup.manualBtn')}
              </button>
            </div>
          </div>
        </div>

        {/* v1.44 — Command 전용 옵션. kind='command' 일 때만 보임. cyan(sky-400) 액센트.
         * delegationPolicy(강제 정도)와 직교하는 commandMode 축 — 도구 공유 vs 박탈 vs 모드 위임.
         * shared = 부모 도구 유지 / tool-delegation = 박탈 / mode-delegation = 도구 공유 + 시스템 프롬프트 강제. */}
        {kind === 'command' && (
          <div className="mb-3 space-y-2.5 rounded border border-sky-400/40 bg-sky-400/5 p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M9 17l-5-5 5-5" />
                <path d="M15 17l5-5-5-5" />
              </svg>
              {t('bubbleMap.taskEdgePopup.commandOptions')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.commandOptionsTooltip')} />
            </div>

            {/* Mode 선택 — shared / tool-delegation / mode-delegation */}
            <div>
              <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                {t('bubbleMap.taskEdgePopup.commandModeLabel')}
                <InfoIcon title={t('bubbleMap.taskEdgePopup.commandModeTooltip')} />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setCommandMode('shared')}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${commandMode === 'shared' ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'}`}
                  {...tipProps(t('bubbleMap.taskEdgePopup.commandModeSharedTooltip'))}
                >
                  {t('bubbleMap.taskEdgePopup.commandModeShared')}
                </button>
                <button
                  type="button"
                  onClick={() => setCommandMode('tool-delegation')}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${commandMode === 'tool-delegation' ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'}`}
                  {...tipProps(t('bubbleMap.taskEdgePopup.commandModeToolTooltip'))}
                >
                  {t('bubbleMap.taskEdgePopup.commandModeTool')}
                </button>
                <button
                  type="button"
                  onClick={() => setCommandMode('mode-delegation')}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${commandMode === 'mode-delegation' ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'}`}
                  {...tipProps(t('bubbleMap.taskEdgePopup.commandModeModeTooltip'))}
                >
                  {t('bubbleMap.taskEdgePopup.commandModeMode')}
                </button>
              </div>
            </div>

            {/* tool-delegation 박탈 대상 도구 프리뷰 */}
            {commandMode === 'tool-delegation' && (
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.commandStripPreview')}
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.commandStripPreviewTooltip')} />
                </div>
                {stripPreview.length > 0 ? (
                  <div className="flex flex-wrap gap-1 rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5">
                    {stripPreview.map((tool) => (
                      <span key={tool} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                        {tool}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-gray-700 bg-gray-800/40 px-2 py-1.5 text-[10px] text-gray-500">
                    {t('bubbleMap.taskEdgePopup.commandStripPreviewEmpty')}
                  </div>
                )}
              </div>
            )}

            {/* mode-delegation 안내 (도구 회수 안 함, 시스템 프롬프트로 강제) */}
            {commandMode === 'mode-delegation' && (
              <div className="rounded border border-sky-400/30 bg-sky-400/5 px-2 py-1.5 text-[10px] leading-relaxed text-sky-200/80">
                {t('bubbleMap.taskEdgePopup.commandModeModeNote')}
              </div>
            )}
          </div>
        )}

        {/* v1.41 — Critique 전용 옵션. kind='critique' 일 때만 보임. 보라(violet) 액센트로 감시자 톤 통일. */}
        {kind === 'critique' && (
          <div className="mb-3 space-y-2.5 rounded border border-violet-500/40 bg-violet-500/5 p-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-300">
              <span>{TASK_EDGE_KIND_STYLES.critique.icon}</span>
              Critique Options
              <InfoIcon title={t('bubbleMap.taskEdgePopup.critiqueOptionsTip')} />
            </div>

            {/* Timing */}
            <div>
              <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                Timing
                <InfoIcon title={t('bubbleMap.taskEdgePopup.critiqueTimingTip')} />
              </div>
              <div className="flex rounded border border-gray-700 bg-gray-800 text-xs">
                <button
                  type="button"
                  className={`flex-1 rounded-l px-2 py-1 ${
                    critiqueTiming === 'intermediate' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                  onClick={() => setCritiqueTiming('intermediate')}
                  {...tipProps(t('bubbleMap.taskEdgePopup.critiqueTimingIntermediateTip'))}
                >
                  Intermediate
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-r px-2 py-1 ${
                    critiqueTiming === 'final' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                  onClick={() => setCritiqueTiming('final')}
                  {...tipProps(t('bubbleMap.taskEdgePopup.critiqueTimingFinalTip'))}
                >
                  Final only
                </button>
              </div>
            </div>

            {/* Authority + MaxRework */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  Authority
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.critiqueAuthorityTip')} />
                </div>
                <div className="flex rounded border border-gray-700 bg-gray-800 text-xs">
                  <button
                    type="button"
                    className={`flex-1 rounded-l px-2 py-1 ${
                      critiqueAuthority === 'force-rework' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                    }`}
                    onClick={() => setCritiqueAuthority('force-rework')}
                    {...tipProps(t('bubbleMap.taskEdgePopup.critiqueAuthorityForceTip'))}
                  >
                    Force rework
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-r px-2 py-1 ${
                      critiqueAuthority === 'comment-only' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                    }`}
                    onClick={() => setCritiqueAuthority('comment-only')}
                    {...tipProps(t('bubbleMap.taskEdgePopup.critiqueAuthorityCommentTip'))}
                  >
                    Comment only
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  Max Rework
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.critiqueMaxReworkTip')} />
                </div>
                <input
                  type="number"
                  min={1}
                  max={TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT}
                  step={1}
                  disabled={critiqueAuthority !== 'force-rework'}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  value={maxReworkCount}
                  onChange={(e) => {
                    const n = Number(e.target.value) || 1;
                    setMaxReworkCount(Math.max(1, Math.min(TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT, n)));
                  }}
                  {...tipProps(critiqueAuthority === 'force-rework'
                    ? t('bubbleMap.taskEdgePopup.critiqueMaxReworkActive', { max: TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT })
                    : t('bubbleMap.taskEdgePopup.critiqueMaxReworkInactive'))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Advanced toggle */}
        <button
          type="button"
          className="mb-2 flex w-full items-center justify-between rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800/60"
          onClick={() => setAdvancedOpen((v) => !v)}
          {...tipProps(advancedOpen ? t('bubbleMap.taskEdgePopup.advancedHide') : t('bubbleMap.taskEdgePopup.advancedShow'))}
        >
          <span className="flex items-center">
            <span className="mr-1">{advancedOpen ? '▾' : '▸'}</span>
            {t('bubbleMap.taskEdgePopup.advancedOptions')}
            <InfoIcon title={t('bubbleMap.taskEdgePopup.advancedTooltip')} />
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            {advancedOpen ? t('bubbleMap.taskEdgePopup.hide') : t('bubbleMap.taskEdgePopup.show')}
          </span>
        </button>

        {advancedOpen && (
          <div className="mb-3 space-y-3 rounded border border-gray-800 bg-gray-950/40 p-2">
            {/* Message Format */}
            <div>
              <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                {t('bubbleMap.taskEdgePopup.messageFormat')}
                <InfoIcon title={t('bubbleMap.taskEdgePopup.messageFormatTooltip')} />
              </div>
              <div className="flex rounded border border-gray-700 bg-gray-800 text-xs">
                <button
                  type="button"
                  className={`flex-1 rounded-l px-2 py-1 ${
                    messageFormat === 'free' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                  onClick={() => setMessageFormat('free')}
                  {...tipProps(t('bubbleMap.taskEdgePopup.freeTextTooltip'))}
                >
                  {t('bubbleMap.taskEdgePopup.freeText')}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-r px-2 py-1 ${
                    messageFormat === 'schema' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                  onClick={() => setMessageFormat('schema')}
                  {...tipProps(t('bubbleMap.taskEdgePopup.schemaTooltip'))}
                >
                  {t('bubbleMap.taskEdgePopup.schema')}
                </button>
              </div>
              {messageFormat === 'schema' && (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <svg className={`h-3.5 w-3.5 ${messageSchema.trim() ? 'text-blue-400' : 'text-gray-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
                      <path d="M9 13h6" />
                      <path d="M9 17h4" />
                    </svg>
                    <span className={messageSchema.trim() ? 'text-gray-200' : 'text-gray-500'}>
                      {messageSchema.trim()
                        ? t('bubbleMap.taskEdgePopup.schemaSet')
                        : t('bubbleMap.taskEdgePopup.schemaEmpty')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] text-gray-200 hover:border-blue-500 hover:text-white"
                    onClick={() => {
                      setSchemaDraft(messageSchema);
                      setSchemaEditOpen(true);
                    }}
                    {...tipProps(t('bubbleMap.taskEdgePopup.schemaEditTooltip'))}
                  >
                    {t('bubbleMap.taskEdgePopup.schemaEdit')}
                  </button>
                </div>
              )}
            </div>

            {/* Return Format */}
            <div>
              <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                {t('bubbleMap.taskEdgePopup.returnFormat')}
                <InfoIcon title={t('bubbleMap.taskEdgePopup.returnFormatTooltip')} />
              </div>
              <div className="flex rounded border border-gray-700 bg-gray-800 text-xs">
                {(['artifact', 'summary', 'both'] as TaskEdgeReturnFormat[]).map((rf, i) => {
                  const tip =
                    rf === 'artifact'
                      ? t('bubbleMap.taskEdgePopup.artifactTooltip')
                      : rf === 'summary'
                      ? t('bubbleMap.taskEdgePopup.summaryTooltip')
                      : t('bubbleMap.taskEdgePopup.bothTooltip');
                  const label =
                    rf === 'artifact'
                      ? t('bubbleMap.taskEdgePopup.artifact')
                      : rf === 'summary'
                      ? t('bubbleMap.taskEdgePopup.summary')
                      : t('bubbleMap.taskEdgePopup.both');
                  return (
                    <button
                      key={rf}
                      type="button"
                      className={`flex-1 px-2 py-1 ${i === 0 ? 'rounded-l' : ''} ${i === 2 ? 'rounded-r' : ''} ${
                        returnFormat === rf ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                      }`}
                      onClick={() => setReturnFormat(rf)}
                      {...tipProps(tip)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Timeout / Retry */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.timeout')}
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.timeoutTooltip')} />
                </div>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  placeholder={t('bubbleMap.taskEdgePopup.timeoutPlaceholder')}
                />
              </div>
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.retry')}
                  <span className="ml-1 text-[9px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.retryDisabledNote')} />
                </div>
                {/* TODO(2026-05-13): retry runtime is not implemented yet. Input disabled.
                 *  Re-enable once dispatch loop honors edge.retryCount (see 해보자/2026-05-13/todo.md). */}
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  disabled
                  className="w-full cursor-not-allowed rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-500 opacity-50"
                  value={retryCount}
                  onChange={(e) => setRetryCount(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                  {...tipProps(t('bubbleMap.taskEdgePopup.retryDisabledNote'))}
                />
              </div>
            </div>

            {/* Priority + Cache */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.priority')}
                  <span className="ml-1 text-[9px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.priorityDisabledNote')} />
                </div>
                {/* TODO(2026-05-13): priority scheduling is not implemented yet. Select disabled.
                 *  Re-enable once dispatch scheduler honors edge.priority (see 해보자/2026-05-13/todo.md). */}
                <select
                  disabled
                  className="w-full cursor-not-allowed rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-500 opacity-50"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskEdgePriority)}
                  {...tipProps(t('bubbleMap.taskEdgePopup.priorityDisabledNote'))}
                >
                  <option value="low" title={t('bubbleMap.taskEdgePopup.priorityLowTooltip')}>{t('bubbleMap.taskEdgePopup.priorityLow')}</option>
                  <option value="normal" title={t('bubbleMap.taskEdgePopup.priorityNormalTooltip')}>{t('bubbleMap.taskEdgePopup.priorityNormal')}</option>
                  <option value="high" title={t('bubbleMap.taskEdgePopup.priorityHighTooltip')}>{t('bubbleMap.taskEdgePopup.priorityHigh')}</option>
                </select>
              </div>
              <div>
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.cache')}
                  <span className="ml-1 text-[9px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.cacheDisabledNote')} />
                </div>
                {/* TODO(2026-05-13): result cache is not implemented yet. Checkbox disabled.
                 *  Re-enable once dispatch path honors edge.cacheEnabled (see 해보자/2026-05-13/todo.md). */}
                <label
                  className="flex cursor-not-allowed items-center gap-1.5 rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-500 opacity-50"
                  {...tipProps(t('bubbleMap.taskEdgePopup.cacheDisabledNote'))}
                >
                  <input
                    type="checkbox"
                    disabled
                    checked={cacheEnabled}
                    onChange={(e) => setCacheEnabled(e.target.checked)}
                    className="h-3 w-3 cursor-not-allowed rounded border-gray-700 bg-gray-900 accent-gray-600"
                  />
                  {t('bubbleMap.taskEdgePopup.cacheLabel')}
                </label>
              </div>
              {/* Per-edge delegation policy — full width below the grid. */}
              <div className="col-span-2">
                <div className="mb-1 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.delegationPolicy')}
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.delegationTooltip')} />
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDelegationPolicy('strict')}
                    className={`flex-1 rounded border px-2.5 py-1.5 text-xs transition-colors ${delegationPolicy === 'strict' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'}`}
                    {...tipProps(t('bubbleMap.taskEdgePopup.delegationStrictTooltip'))}
                  >
                    {t('bubbleMap.taskEdgePopup.delegationStrict')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDelegationPolicy('auto')}
                    className={`flex-1 rounded border px-2.5 py-1.5 text-xs transition-colors ${delegationPolicy === 'auto' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'}`}
                    {...tipProps(t('bubbleMap.taskEdgePopup.delegationAutoTooltip'))}
                  >
                    {t('bubbleMap.taskEdgePopup.delegationAuto')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5">
          {isEditing && (
            <button
              className="mr-auto rounded px-3 py-1 text-xs text-red-400 hover:bg-red-500/10"
              onClick={handleDelete}
              {...tipProps(t('bubbleMap.taskEdgePopup.deleteTooltip'))}
            >
              {t('bubbleMap.taskEdgePopup.delete')}
            </button>
          )}
          <button
            className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-800"
            onClick={onClose}
            {...tipProps(t('bubbleMap.taskEdgePopup.cancelTooltip'))}
          >
            {t('bubbleMap.taskEdgePopup.cancel')}
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
            onClick={handleSubmit}
            disabled={!command.trim()}
            {...tipProps(
              isEditing
                ? t('bubbleMap.taskEdgePopup.saveTooltip')
                : t('bubbleMap.taskEdgePopup.connectTooltip'),
            )}
          >
            {isEditing ? t('bubbleMap.taskEdgePopup.save') : t('bubbleMap.taskEdgePopup.connect')}
          </button>
        </div>
      </div>

      {/* v1.48 — Schema 편집 sub-popup. messageFormat='schema' 일 때 "편집" 버튼으로 오픈.
       *  메인 TaskEdgePopup 의 backdrop 으로 버블링 차단(stopPropagation) + 자체 backdrop 닫기는
       *  mousedown↔mouseup 이 둘 다 backdrop 위에서 발생한 경우에만 — textarea 텍스트 선택
       *  드래그가 우연히 backdrop 위에서 끝나도 닫히지 않도록. */}
      {schemaEditOpen && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            schemaBackdropDownRef.current = e.target === e.currentTarget;
          }}
          onMouseUp={(e) => {
            if (e.target === e.currentTarget && schemaBackdropDownRef.current) setSchemaEditOpen(false);
            schemaBackdropDownRef.current = false;
          }}
        >
          <div className="w-[520px] max-w-[92vw] rounded-md border border-gray-700 bg-gray-900 p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-100">
                {t('bubbleMap.taskEdgePopup.schemaEditTitle')}
              </div>
              <button
                type="button"
                className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                onClick={() => setSchemaEditOpen(false)}
                aria-label={t('bubbleMap.taskEdgePopup.cancel')}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mb-2 text-[11px] leading-snug text-gray-400">
              {t('bubbleMap.taskEdgePopup.schemaEditHint')}
            </div>
            <textarea
              value={schemaDraft}
              onChange={(e) => setSchemaDraft(e.target.value)}
              className="h-56 w-full resize-none rounded border border-gray-700 bg-gray-950 p-2 font-mono text-[12px] leading-relaxed text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder={t('bubbleMap.taskEdgePopup.schemaPlaceholder')}
              spellCheck={false}
              autoFocus
            />
            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-800"
                onClick={() => {
                  setSchemaDraft('');
                  setMessageSchema('');
                  setSchemaEditOpen(false);
                }}
              >
                {t('bubbleMap.taskEdgePopup.schemaClear')}
              </button>
              <button
                type="button"
                className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-800"
                onClick={() => setSchemaEditOpen(false)}
              >
                {t('bubbleMap.taskEdgePopup.cancel')}
              </button>
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                onClick={() => {
                  setMessageSchema(schemaDraft);
                  setSchemaEditOpen(false);
                }}
              >
                {t('bubbleMap.taskEdgePopup.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared tooltip layer — rendered above the popup via fixed positioning. */}
      {hoverTip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] w-64 rounded border border-gray-600 bg-gray-950 px-2 py-1.5 text-[11px] leading-snug text-gray-200 shadow-xl"
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 264, hoverTip.rect.left + hoverTip.rect.width / 2 - 128)),
            top: hoverTip.rect.top - 6,
            transform: 'translateY(-100%)',
          }}
        >
          {hoverTip.text}
        </div>
      )}
    </div>
  );
}
