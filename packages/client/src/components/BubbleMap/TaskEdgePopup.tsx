import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { runEnterKey } from '../../hooks/useEnterSubmit.js';
import { IME_ENTER_OWNER } from '../../utils/inputComposition.js';
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
import { useBackdropDismiss, useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

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

/** `w-96` 폭 — 자리는 실제로 잰 폭으로 잡고 이 값은 재기 전 폴백이다(폰에선 `max-w-[calc(100vw-24px)]` 가 줄인다). */
const POPUP_WIDTH = 384; // w-96
const VIEWPORT_MARGIN = 12;

/** 기본 도구가 45종이라 다 펼치면 프리뷰가 팝업을 먹고 버튼이 스크롤 밖으로 밀린다 — w-96 에서 두 줄쯤인 10개만, 나머지는 `+N`. */
const STRIP_PREVIEW_CHIPS = 10;

// 마지막 Critique 옵션을 기억해 신규 엣지 기본값으로 쓴다. 편집 모드·템플릿 명시 선택엔 영향 ❌.
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

/** 터치로 띄운 설명은 바깥을 누르면 접힌다(`useOutsidePressDismiss`). 누름은 캡처 단계라 다른 단추를 누르면 접힌 뒤 그 단추 설명이 뜬다. */
const TOUCH_TIP_PRESS_EVENTS = ['pointerdown'] as const;

/**
 * Fixed-positioned so the popup's `overflow-y-auto` never clips it. 터치는 눌러 펴고 다시 눌러 접는다 —
 * 굵은 포인터에서만 누르는 자리를 34×26px 로 넓힌다(보이는 크기 그대로, 아래 선택 상자를 덮지 않게).
 */
function InfoIcon({ title }: { title: string }): React.JSX.Element {
  const iconRef = useRef<HTMLSpanElement>(null);
  // `touch` — 손가락으로 편 것인가(그건 마우스가 떠나도 접히지 않고, 다른 곳을 눌러야 접힌다).
  const [tip, setTip] = useState<{ rect: DOMRect; touch: boolean } | null>(null);
  const rect = tip?.rect ?? null;

  const handleEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !iconRef.current) return;
    setTip({ rect: iconRef.current.getBoundingClientRect(), touch: false });
  }, []);
  const handleLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    setTip((prev) => (prev?.touch ? prev : null));
  }, []);
  const handlePress = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const icon = iconRef.current;
    setTip((prev) => (prev || !icon ? null : { rect: icon.getBoundingClientRect(), touch: true }));
  }, []);
  const closeTouch = useCallback(() => setTip(null), []);
  useOutsidePressDismiss({ enabled: tip?.touch === true, onDismiss: closeTouch, refs: [iconRef], events: TOUCH_TIP_PRESS_EVENTS });

  return (
    <>
      <span
        ref={iconRef}
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onPointerDown={handlePress}
        className="ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-gray-600 text-[12px] leading-none text-gray-500 hover:border-gray-400 hover:text-gray-300 pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:-inset-x-2.5 pointer-coarse:before:-inset-y-1.5 pointer-coarse:before:content-['']"
      >
        ?
      </span>
      {rect && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] w-64 rounded border border-gray-600 bg-gray-950 px-2 py-1.5 text-[12px] leading-snug text-gray-200 shadow-xl"
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

  // One shared tooltip slot (one hover at a time). 마우스만 올림·떠남을 따른다 — 탭 뒤 흉내 마우스 이벤트로 뜨면 아래 칸을 가린 채 남는다.
  // 터치는 누를 때 띄우고 바깥 누름에 접는다.
  const [hoverTip, setHoverTip] = useState<{ rect: DOMRect; text: string; touch?: boolean } | null>(null);
  const tipProps = useCallback(
    (text: string) => ({
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        setHoverTip({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), text });
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        setHoverTip(null);
      },
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        setHoverTip({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), text, touch: true });
      },
    }),
    [],
  );
  const closeTouchTip = useCallback(() => setHoverTip(null), []);
  useOutsidePressDismiss({ enabled: hoverTip?.touch === true, onDismiss: closeTouchTip, events: TOUCH_TIP_PRESS_EVENTS });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // backdrop 닫기는 `useBackdropDismiss` — 입력칸에서 시작한 드래그 선택이 밖에서 끝나도 닫히지 않는다.
  const backdrop = useBackdropDismiss(onClose);

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
  // messageFormat='schema' 일 때만 쓰는 자유 형식 본문. 빈 값 = 형식 강제 없음.
  const [messageSchema, setMessageSchema] = useState<string>(existingEdge?.messageSchema ?? '');
  const [schemaEditOpen, setSchemaEditOpen] = useState(false);
  const schemaBackdrop = useBackdropDismiss(() => setSchemaEditOpen(false));
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
  // strict = mandatory, auto = source agent decides. 신규는 템플릿 defaultDelegationPolicy 우선, 편집은 기존 값.
  const [delegationPolicy, setDelegationPolicy] = useState<'strict' | 'auto'>(
    (existingEdge?.delegationPolicy ?? initialTemplate.defaultDelegationPolicy ?? TASK_EDGE_DEFAULTS.delegationPolicy) as 'strict' | 'auto',
  );
  // kind='critique' 전용. 신규는 마지막 선택값, 편집은 기존 값, 템플릿 명시 선택은 handleTemplateSelect 가 덮는다.
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
  // kind='command' 전용. commandMode 없는 기존 엣지는 서버 strip 과 같은 추정값(undefined+strict → 'tool-delegation', 그 외 'shared').
  const inferLegacyCommandMode = (): TaskEdgeCommandMode => {
    // 신규 엣지 = 템플릿 기본(Custom 은 'tool-delegation').
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
  /** 프리뷰 칩을 다 펼쳐 두었는가. 기본은 접힘(STRIP_PREVIEW_CHIPS 개까지). */
  const [stripExpanded, setStripExpanded] = useState(false);

  // ─── Viewport-aware positioning + user drag ─────────────────────────────
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [userMoved, setUserMoved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** 끌고 있는 포인터 — 두 번째 손가락이 닿아도 그 움직임은 창을 옮기지 않는다. */
  const dragPointerRef = useRef<number | null>(null);

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

  // 머리줄 끌기 — 포인터 이벤트라 마우스·손가락·펜이 같은 길이다(종전 mousedown 전용이라 폰에서는 안 옮겨졌다).
  //   포인터를 붙잡아(`setPointerCapture`) 손이 머리줄 밖으로 나가도 끝까지 따라오고, 머리줄은 `touch-none` 이라
  //   브라우저가 그 손짓을 스크롤로 가져가지 않는다.
  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragPointerRef.current = e.pointerId;
    dragOffsetRef.current = { x: e.clientX - position.left, y: e.clientY - position.top };
    setDragging(true);
    setUserMoved(true);
  }, [position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== dragPointerRef.current) return;
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
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== dragPointerRef.current) return;
      dragPointerRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
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
      // schema 가 아니면 비워 프롬프트 주입에서 빠지게 한다.
      messageSchema: messageFormat === 'schema' ? messageSchema : '',
      returnFormat,
      timeoutMs: timeoutMs === '' ? undefined : Number(timeoutMs),
      retryCount,
      cacheEnabled,
      priority,
      delegationPolicy,
      // 다른 kind 에도 저장되지만 서버/런타임은 critique 에서만 해석한다.
      critiqueTiming,
      critiqueAuthority,
      maxReworkCount,
      commandMode,
    };
    if (isEditing && editingEdgeId) {
      updateTaskEdge(editingEdgeId, { command: command.trim(), forwardMode, ...options });
    } else {
      createTaskEdge(sourceAgentId, targetAgentId, command.trim(), forwardMode, selectedTemplate.id, options);
    }
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
    if (runEnterKey(e, () => handleSubmit(), 'chord')) return;
    if (e.key === 'Escape') onClose();
  }, [handleSubmit, onClose]);

  const sourceLabel = agents.find((a) => a.id === sourceAgentId)?.label ?? 'Agent';
  const targetLabel = agents.find((a) => a.id === targetAgentId)?.label ?? 'Agent';

  return (
    <div className="fixed inset-0 z-50" {...backdrop}>
      {/* 폰 폭(360px)에서는 `w-96` 이 화면보다 넓어 오른쪽 36px 와 주 버튼이 잘렸다 — 폭은 화면에서 양옆 여백을 뺀
          만큼까지만, 높이는 주소창이 오가도 맞는 `dvh` 로 잡는다(자리 잡기는 실제로 잰 폭을 쓴다). */}
      <div
        ref={popupRef}
        className={`scrollbar-thin absolute z-50 max-h-[90dvh] w-96 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-2xl ${
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
        {/* Header — drag handle. 이름이 길어도 줄이 넘치지 않게 두 이름은 각자 40% 까지만 쓰고 잘린다. */}
        <div
          className={`mb-2 -mx-3 -mt-3 flex touch-none select-none items-center gap-2 rounded-t-lg border-b border-gray-800 bg-gray-900/80 px-3 py-1.5 text-xs text-gray-400 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onPointerDown={handleHeaderPointerDown}
          title={t('bubbleMap.taskEdgePopup.dragToMove')}
        >
          <span className="min-w-0 max-w-[40%] truncate rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-300">{sourceLabel}</span>
          <span className="shrink-0">→</span>
          <span className="min-w-0 max-w-[40%] truncate rounded bg-green-500/20 px-1.5 py-0.5 text-green-300">{targetLabel}</span>
          {isEditing && <span className="ml-auto shrink-0 text-[12px] uppercase tracking-wider text-amber-400">{t('bubbleMap.taskEdgePopup.editBadge')}</span>}
        </div>

        {/* Template dropdown */}
        <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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
        <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
          {t('bubbleMap.taskEdgePopup.message')}
          <InfoIcon title={t('bubbleMap.taskEdgePopup.messageTooltip')} />
        </div>
        <textarea
          ref={inputRef}
          className="scrollbar-thin mb-3 w-full resize-none rounded border border-gray-700 bg-gray-800 p-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          rows={3}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          {...IME_ENTER_OWNER}
          onKeyDown={handleKeyDown}
          placeholder={t('bubbleMap.taskEdgePopup.messagePlaceholder')}
        />

        {/* Main: Type + Gate */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
              {t('bubbleMap.taskEdgePopup.type')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.typeTooltip')} />
            </div>
            <select
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskEdgeKind)}
              {...tipProps(`${t(`bubbleMap.taskEdgeKind.${kind}.label`)}: ${t(`bubbleMap.taskEdgeKind.${kind}.description`)}`)}
            >
              {(Object.keys(TASK_EDGE_KIND_STYLES) as TaskEdgeKind[]).map((k) => (
                <option key={k} value={k} title={t(`bubbleMap.taskEdgeKind.${k}.description`)}>
                  {TASK_EDGE_KIND_STYLES[k].icon} {t(`bubbleMap.taskEdgeKind.${k}.label`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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

        {/* delegationPolicy(강제 정도)와 직교하는 commandMode: shared = 부모 도구 유지 / tool-delegation = 박탈 / mode-delegation = 도구 공유 + 시스템 프롬프트 강제. */}
        {kind === 'command' && (
          <div className="mb-3 space-y-2.5 rounded border border-sky-400/40 bg-sky-400/5 p-2">
            <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-sky-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M9 17l-5-5 5-5" />
                <path d="M15 17l5-5-5-5" />
              </svg>
              {t('bubbleMap.taskEdgePopup.commandOptions')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.commandOptionsTooltip')} />
            </div>

            {/* Mode 선택 — shared / tool-delegation / mode-delegation */}
            <div>
              <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.commandStripPreview')}
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.commandStripPreviewTooltip')} />
                </div>
                {stripPreview.length > 0 ? (
                  <div className="flex flex-wrap gap-1 rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5">
                    {(stripExpanded ? stripPreview : stripPreview.slice(0, STRIP_PREVIEW_CHIPS)).map((tool) => (
                      <span key={tool} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] text-amber-300">
                        {tool}
                      </span>
                    ))}
                    {stripPreview.length > STRIP_PREVIEW_CHIPS && (
                      <button
                        type="button"
                        onClick={() => setStripExpanded((v) => !v)}
                        title={stripPreview.slice(STRIP_PREVIEW_CHIPS).join(', ')}
                        className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:bg-gray-600/60 hover:text-amber-200"
                      >
                        {stripExpanded ? '…' : `+${stripPreview.length - STRIP_PREVIEW_CHIPS}`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-gray-700 bg-gray-800/40 px-2 py-1.5 text-[12px] text-gray-500">
                    {t('bubbleMap.taskEdgePopup.commandStripPreviewEmpty')}
                  </div>
                )}
              </div>
            )}

            {/* mode-delegation 안내 (도구 회수 안 함, 시스템 프롬프트로 강제) */}
            {commandMode === 'tool-delegation' && agentConfigs[sourceAgentId]?.provider?.kind === 'codex-cli' && (
              <p className="rounded border border-amber-400/30 bg-amber-400/5 px-2 py-2 text-xs leading-relaxed text-amber-200/80">
                {t('panel.agentConfig.codex.edgeDelegationNote')}
              </p>
            )}
            {commandMode === 'mode-delegation' && (
              <div className="rounded border border-sky-400/30 bg-sky-400/5 px-2 py-1.5 text-[12px] leading-relaxed text-sky-200/80">
                {t('bubbleMap.taskEdgePopup.commandModeModeNote')}
              </div>
            )}
          </div>
        )}

        {/* Critique 전용 옵션 */}
        {kind === 'critique' && (
          <div className="mb-3 space-y-2.5 rounded border border-violet-500/40 bg-violet-500/5 p-2">
            <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-violet-300">
              <span>{TASK_EDGE_KIND_STYLES.critique.icon}</span>
              {t('bubbleMap.taskEdgePopup.critiqueOptions')}
              <InfoIcon title={t('bubbleMap.taskEdgePopup.critiqueOptionsTip')} />
            </div>

            {/* Timing */}
            <div>
              <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                {t('bubbleMap.taskEdgePopup.critiqueTiming')}
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
                  {t('bubbleMap.taskEdgePopup.critiqueTimingIntermediate')}
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-r px-2 py-1 ${
                    critiqueTiming === 'final' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                  onClick={() => setCritiqueTiming('final')}
                  {...tipProps(t('bubbleMap.taskEdgePopup.critiqueTimingFinalTip'))}
                >
                  {t('bubbleMap.taskEdgePopup.critiqueTimingFinal')}
                </button>
              </div>
            </div>

            {/* Authority + MaxRework */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.critiqueAuthority')}
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
                    {t('bubbleMap.taskEdgePopup.critiqueAuthorityForce')}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-r px-2 py-1 ${
                      critiqueAuthority === 'comment-only' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                    }`}
                    onClick={() => setCritiqueAuthority('comment-only')}
                    {...tipProps(t('bubbleMap.taskEdgePopup.critiqueAuthorityCommentTip'))}
                  >
                    {t('bubbleMap.taskEdgePopup.critiqueAuthorityComment')}
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.critiqueMaxRework')}
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
          <span className="text-[12px] uppercase tracking-wider text-gray-600">
            {advancedOpen ? t('bubbleMap.taskEdgePopup.hide') : t('bubbleMap.taskEdgePopup.show')}
          </span>
        </button>

        {advancedOpen && (
          <div className="mb-3 space-y-3 rounded border border-gray-800 bg-gray-950/40 p-2">
            {/* Message Format */}
            <div>
              <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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
                  <div className="flex items-center gap-1.5 text-[12px]">
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
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[12px] text-gray-200 hover:border-blue-500 hover:text-white"
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
              <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.retry')}
                  <span className="ml-1 text-[12px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.retryDisabledNote')} />
                </div>
                {/* TODO: retry runtime not implemented — disabled until the dispatch loop honors edge.retryCount. */}
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.priority')}
                  <span className="ml-1 text-[12px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.priorityDisabledNote')} />
                </div>
                {/* TODO: priority scheduling not implemented — disabled until the dispatch scheduler honors edge.priority. */}
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
                  {t('bubbleMap.taskEdgePopup.cache')}
                  <span className="ml-1 text-[12px] normal-case tracking-normal text-amber-400/70">
                    {t('bubbleMap.taskEdgePopup.comingSoonSuffix')}
                  </span>
                  <InfoIcon title={t('bubbleMap.taskEdgePopup.cacheDisabledNote')} />
                </div>
                {/* TODO: result cache not implemented — disabled until the dispatch path honors edge.cacheEnabled. */}
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
                <div className="mb-1 flex items-center text-[12px] uppercase tracking-wider text-gray-500">
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

        {/* Actions — 손가락에는 24px 단추가 작다. 굵은 포인터에서만 32px 로 키운다(데스크톱 모습은 그대로). */}
        <div className="flex items-center justify-end gap-1.5">
          {isEditing && (
            <button
              className="mr-auto rounded px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 pointer-coarse:py-2"
              onClick={handleDelete}
              {...tipProps(t('bubbleMap.taskEdgePopup.deleteTooltip'))}
            >
              {t('bubbleMap.taskEdgePopup.delete')}
            </button>
          )}
          <button
            className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 pointer-coarse:py-2"
            onClick={onClose}
            {...tipProps(t('bubbleMap.taskEdgePopup.cancelTooltip'))}
          >
            {t('bubbleMap.taskEdgePopup.cancel')}
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40 pointer-coarse:py-2"
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

      {/* Schema 편집 서브 팝업 — 메인 backdrop 으로 버블링을 끊고, 자체 닫기는 누른 곳·뗀 곳 둘 다 backdrop 일 때만(선택 드래그가 거기서 끝나도 안 닫히게). */}
      {schemaEditOpen && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40"
          onMouseDown={(e) => { e.stopPropagation(); schemaBackdrop.onMouseDown(e); }}
          onClick={(e) => { e.stopPropagation(); schemaBackdrop.onClick(e); }}
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
            <div className="mb-2 text-[12px] leading-snug text-gray-400">
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
          className="pointer-events-none fixed z-[60] w-64 rounded border border-gray-600 bg-gray-950 px-2 py-1.5 text-[12px] leading-snug text-gray-200 shadow-xl"
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
