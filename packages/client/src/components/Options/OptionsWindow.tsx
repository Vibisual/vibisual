/**
 * §4 v2.42 — 사용자 옵션창.
 *
 * File 메뉴 → Options 로 열림. 좌측 카테고리 사이드바 + 우측 폼 패널.
 * 5 카테고리: Agent Defaults / Appearance / Notifications / Permissions / Advanced.
 * 1차는 Agent Defaults 완전 구현, 나머지 4개는 placeholder.
 *
 * Apply/Cancel 패턴 — dirty 추적 후 Apply 시에만 서버 PUT.
 * 서버 응답 + WS `user_defaults_updated` 로 graphStore.userDefaults 갱신 → 다른 창들도 즉시 반영.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, UserDefaults, ClaudeInstallsInfo, ClaudeInstall } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  isOpusModel,
  resolveAliasToLatest,
  listModelFamilies,
  parseModelSemver,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

type CategoryKey = 'agent' | 'appearance' | 'notifications' | 'permissions' | 'advanced' | 'version';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code';
const REPO_URL = 'https://github.com/Vibisual/vibisual';

// §4 v2.77 — Model 목록은 레지스트리 기반 동적(`listModelFamilies`). 폴백 alias 만 상수.
const PERMISSION_VALUES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
const ISOLATION_VALUES = ['none', 'worktree'] as const;
// SSOT = shared `AVAILABLE_EFFORT_LEVELS` (§4 v2.48). 'max' = Opus 4.8 최대 추론. 드리프트 주의.
const EFFORT_VALUES = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

interface OptionsWindowProps {
  open: boolean;
  onClose: () => void;
}

export function OptionsWindow({ open, onClose }: OptionsWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [category, setCategory] = useState<CategoryKey>('agent');

  // Agent Defaults 폼 state — 초기값은 userDefaults.agentConfig 위에 DEFAULT_AGENT_CONFIG 깔기
  const baseAgent: AgentConfig = useMemo(() => ({
    ...DEFAULT_AGENT_CONFIG,
    ...(userDefaults?.agentConfig ?? {}),
    tools: userDefaults?.agentConfig?.tools ?? [...DEFAULT_AGENT_CONFIG.tools],
    skills: userDefaults?.agentConfig?.skills ?? [...DEFAULT_AGENT_CONFIG.skills],
  }), [userDefaults]);

  const [model, setModel] = useState(baseAgent.model);
  const [modelVersion, setModelVersion] = useState<string | undefined>(baseAgent.modelVersion);
  const [permissionMode, setPermissionMode] = useState(baseAgent.permissionMode);
  const [permissionTimeoutPolicy, setPermissionTimeoutPolicy] = useState<'allow' | 'deny'>(baseAgent.permissionTimeoutPolicy ?? 'allow');
  const [effort, setEffort] = useState(baseAgent.effort ?? 'default');
  const [maxTurns, setMaxTurns] = useState(baseAgent.maxTurns ?? 0);
  const [isolation, setIsolation] = useState(baseAgent.isolation ?? 'none');
  const [contextWindow, setContextWindow] = useState<'1m' | '200k' | undefined>(baseAgent.contextWindow);
  const [tools, setTools] = useState<string[]>([...baseAgent.tools]);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([...(baseAgent.disallowedTools ?? [])]);
  const [rules, setRules] = useState(baseAgent.rules ?? '');
  const [color, setColor] = useState(baseAgent.color ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // §4 v2.43 — Version 탭 상태 (Apply/Cancel dirty 흐름과 독립 — 선택은 즉시 저장)
  const [installs, setInstalls] = useState<ClaudeInstallsInfo | null>(null);
  const [installsLoading, setInstallsLoading] = useState(false);
  const [installsError, setInstallsError] = useState<string | null>(null);
  const [savingBin, setSavingBin] = useState(false);
  const [binChanged, setBinChanged] = useState(false);

  const loadInstalls = useCallback(async (refresh = false) => {
    setInstallsLoading(true);
    setInstallsError(null);
    try {
      const r = await fetch(`${API_BASE}/api/claude-installs${refresh ? '?refresh=1' : ''}`);
      const data = await r.json() as { ok: boolean; info?: ClaudeInstallsInfo; error?: string };
      if (data.ok && data.info) setInstalls(data.info);
      else setInstallsError(data.error ?? 'failed');
    } catch (err) {
      setInstallsError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallsLoading(false);
    }
  }, []);

  // Version 탭 진입 시 lazy 1회 fetch
  useEffect(() => {
    if (category === 'version' && !installs && !installsLoading) void loadInstalls(false);
  }, [category, installs, installsLoading, loadInstalls]);

  // 바이너리 선택 저장 — `claudeBinPath` 를 글로벌 user-defaults 에 PUT. ''=Auto(override 해제).
  const selectBin = useCallback(async (binPath: string | null) => {
    setSavingBin(true);
    try {
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeBinPath: binPath ?? '' } satisfies Partial<UserDefaults>),
      });
      setBinChanged(true);
      await loadInstalls(false);
    } catch { /* ignore */ }
    finally { setSavingBin(false); }
  }, [loadInstalls]);

  // userDefaults 가 외부에서 갱신되면 폼 재시드 (단, dirty 일 땐 사용자 작업 보호)
  useEffect(() => {
    if (dirty) return;
    setModel(baseAgent.model);
    setModelVersion(baseAgent.modelVersion);
    setPermissionMode(baseAgent.permissionMode);
    setPermissionTimeoutPolicy(baseAgent.permissionTimeoutPolicy ?? 'allow');
    setEffort(baseAgent.effort ?? 'default');
    setMaxTurns(baseAgent.maxTurns ?? 0);
    setIsolation(baseAgent.isolation ?? 'none');
    setContextWindow(baseAgent.contextWindow);
    setTools([...baseAgent.tools]);
    setDisallowedTools([...(baseAgent.disallowedTools ?? [])]);
    setRules(baseAgent.rules ?? '');
    setColor(baseAgent.color ?? '');
  }, [baseAgent, dirty]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const isOpus = isOpusModel(model);
  const oneMillionEnabled = contextWindow !== '200k';

  // 버전 sub-드롭다운 옵션 — CLI scan 결과에서 패밀리 필터, semver 내림차순 top 2 + Latest + Custom
  const VERSION_OPTIONS = useMemo(() => {
    // §4 v2.77 — opus/sonnet/haiku 화이트리스트 제거. 선택된 패밀리(alias)의 레지스트리 entry 로 버전 목록 구성.
    const family = model || null;
    if (!family) return [] as { value: string; label: string }[];
    const fams = (modelRegistry?.entries ?? []).filter((e) => e.family === family);
    fams.sort((a, b) => {
      const [aMaj, aMin] = parseModelSemver(a.id);
      const [bMaj, bMin] = parseModelSemver(b.id);
      if (aMaj !== bMaj) return bMaj - aMaj;
      if (aMin !== bMin) return bMin - aMin;
      return b.id.localeCompare(a.id);
    });
    const topTwo = fams.slice(0, 2).map((e) => e.id);
    const visible = new Set(topTwo);
    if (modelVersion && !visible.has(modelVersion)) visible.add(modelVersion);
    const latestId = resolveAliasToLatest(family, modelRegistry);
    const opts: { value: string; label: string }[] = [
      { value: '__latest__', label: latestId ? `Latest (${latestId})` : 'Latest' },
    ];
    for (const e of fams) {
      if (!visible.has(e.id)) continue;
      opts.push({ value: e.id, label: e.id });
    }
    opts.push({ value: '__custom__', label: 'Custom…' });
    return opts;
  }, [model, modelRegistry, modelVersion]);

  const isCustomVersion = useMemo(() => {
    if (!modelVersion) return false;
    return !(modelRegistry?.entries ?? []).some((e) => e.id === modelVersion);
  }, [modelVersion, modelRegistry]);
  const effectiveVersionValue = modelVersion ? (isCustomVersion ? '__custom__' : modelVersion) : '__latest__';
  const handleVersionChange = useCallback((v: string) => {
    setDirty(true);
    if (v === '__latest__') setModelVersion(undefined);
    else if (v === '__custom__') setModelVersion((prev) => prev ?? `claude-${model}-`);
    else setModelVersion(v);
  }, [model]);
  const handleModelChange = useCallback((v: string) => {
    setDirty(true);
    setModel(v);
    if (v !== 'opus') setEffort('default');
    setModelVersion(undefined);
  }, []);

  const toggleTool = useCallback((tool: string) => {
    setDirty(true);
    setTools((p) => p.includes(tool) ? p.filter((x) => x !== tool) : [...p, tool]);
  }, []);
  const toggleDisallowed = useCallback((tool: string) => {
    setDirty(true);
    setDisallowedTools((p) => p.includes(tool) ? p.filter((x) => x !== tool) : [...p, tool]);
  }, []);

  // Apply — 서버에 PUT
  const handleApply = useCallback(async () => {
    setSaving(true);
    try {
      const patch: Partial<UserDefaults> = {
        agentConfig: {
          model,
          modelVersion,
          permissionMode,
          permissionTimeoutPolicy: permissionTimeoutPolicy === 'deny' ? 'deny' : undefined,
          effort: (isOpus && effort !== 'default') ? effort : undefined,
          maxTurns: maxTurns > 0 ? maxTurns : undefined,
          isolation: isolation !== 'none' ? isolation : undefined,
          contextWindow: isOpus && contextWindow === '200k' ? '200k' : undefined,
          tools,
          disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
          rules: rules.trim() || undefined,
          color: color || undefined,
          skills: [...(userDefaults?.agentConfig?.skills ?? DEFAULT_AGENT_CONFIG.skills)],
        },
      };
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setDirty(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [model, modelVersion, permissionMode, permissionTimeoutPolicy, isOpus, effort, maxTurns, isolation, contextWindow, tools, disallowedTools, rules, color, userDefaults]);

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm(t('panel.options.discardConfirm', { defaultValue: 'Discard unsaved changes?' }))) return;
    onClose();
  }, [dirty, onClose, t]);

  if (!open) return null;

  const categories: { key: CategoryKey; label: string; icon: React.JSX.Element }[] = [
    { key: 'agent', label: t('panel.options.categories.agent', { defaultValue: 'Agent Defaults' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    ) },
    { key: 'appearance', label: t('panel.options.categories.appearance', { defaultValue: 'Appearance' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
    ) },
    { key: 'notifications', label: t('panel.options.categories.notifications', { defaultValue: 'Notifications' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
    ) },
    { key: 'permissions', label: t('panel.options.categories.permissions', { defaultValue: 'Permissions' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    ) },
    { key: 'advanced', label: t('panel.options.categories.advanced', { defaultValue: 'Advanced' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    ) },
    { key: 'version', label: t('panel.options.categories.version', { defaultValue: 'Version' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    ) },
  ];

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
    >
      <div className="flex h-[640px] w-[860px] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
            {t('panel.options.title', { defaultValue: 'Options' })}
            {dirty && <span className="text-xs font-normal text-amber-400">• {t('panel.options.unsaved', { defaultValue: 'unsaved' })}</span>}
          </h3>
          <button type="button" onClick={handleCancel} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body — 좌측 사이드바 + 우측 패널 */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-44 shrink-0 border-r border-gray-700/50 bg-gray-900/40 py-2">
            {categories.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  category === c.key
                    ? 'border-l-2 border-blue-500 bg-blue-500/10 text-white'
                    : 'border-l-2 border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                }`}
              >
                <span className="text-gray-500">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          {/* Right pane */}
          <div className="flex-1 overflow-y-auto p-5">
            {category === 'agent' && (
              <div className="flex flex-col gap-4">
                <div className="border-b border-gray-700/50 pb-2">
                  <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.categories.agent', { defaultValue: 'Agent Defaults' })}</h4>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {t('panel.options.agent.intro', { defaultValue: 'These defaults apply to newly created custom agents. Existing agents are not affected.' })}
                  </p>
                </div>

                {/* Model */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.model', { defaultValue: 'Model' })}</label>
                  <select
                    value={model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                  >
                    {listModelFamilies(modelRegistry).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {/* Version sub */}
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                    <span className="uppercase tracking-wider">Version:</span>
                    <select
                      value={effectiveVersionValue}
                      onChange={(e) => handleVersionChange(e.target.value)}
                      className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 font-mono text-[10px] text-gray-300 outline-none hover:border-gray-600 focus:border-blue-500"
                    >
                      {VERSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {isCustomVersion && (
                      <input
                        type="text"
                        value={modelVersion ?? ''}
                        onChange={(e) => { setDirty(true); setModelVersion(e.target.value); }}
                        placeholder={`claude-${model}-X-Y`}
                        className="flex-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-0 font-mono text-[10px] text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
                      />
                    )}
                  </div>
                  {isOpus && (
                    <label className="mt-1 flex cursor-pointer items-center gap-2 rounded border border-gray-700/60 bg-gray-900/40 px-2.5 py-1.5 hover:border-gray-600">
                      <input
                        type="checkbox"
                        checked={oneMillionEnabled}
                        onChange={(e) => { setDirty(true); setContextWindow(e.target.checked ? undefined : '200k'); }}
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
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.permissionMode', { defaultValue: 'Permission Mode' })}</label>
                  <select
                    value={permissionMode}
                    onChange={(e) => { setDirty(true); setPermissionMode(e.target.value); }}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                  >
                    {PERMISSION_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {permissionMode !== 'bypassPermissions' && permissionMode !== 'plan' && (
                    <div className="mt-1 flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/40 px-2.5 py-1.5">
                      <span className="text-[11px] text-gray-400">{t('panel.agentConfig.permissionTimeoutPolicy.label', { defaultValue: 'On no response (60s)' })}:</span>
                      <select
                        value={permissionTimeoutPolicy}
                        onChange={(e) => { setDirty(true); setPermissionTimeoutPolicy(e.target.value as 'allow' | 'deny'); }}
                        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[11px] text-gray-200 outline-none focus:border-blue-500"
                      >
                        <option value="allow">allow</option>
                        <option value="deny">deny</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Effort (Opus only) */}
                {isOpus && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.effort', { defaultValue: 'Effort' })}</label>
                    <select
                      value={effort}
                      onChange={(e) => { setDirty(true); setEffort(e.target.value); }}
                      className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                    >
                      {EFFORT_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}

                {/* Max Turns + Isolation */}
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.maxTurns', { defaultValue: 'Max Turns (0 = unlimited)' })}</label>
                    <input
                      type="number"
                      min={0}
                      value={maxTurns}
                      onChange={(e) => { setDirty(true); setMaxTurns(Math.max(0, Number(e.target.value) || 0)); }}
                      className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.isolation', { defaultValue: 'Isolation' })}</label>
                    <select
                      value={isolation}
                      onChange={(e) => { setDirty(true); setIsolation(e.target.value); }}
                      className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                    >
                      {ISOLATION_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>

                {/* Tools allow-list */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.tools', { defaultValue: 'Tools (allow-list)' })}</label>
                  <div className="flex flex-wrap gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 p-2">
                    {AVAILABLE_AGENT_TOOLS.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        className={`rounded px-2 py-0.5 text-[11px] ${
                          tools.includes(tool)
                            ? 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Disallowed tools (deny-list) */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.disallowedTools', { defaultValue: 'Disallowed Tools (deny-list)' })}</label>
                  <div className="flex flex-wrap gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 p-2">
                    {AVAILABLE_AGENT_TOOLS.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleDisallowed(tool)}
                        className={`rounded px-2 py-0.5 text-[11px] ${
                          disallowedTools.includes(tool)
                            ? 'bg-red-500/20 text-red-200 ring-1 ring-red-500/40'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rules */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.rules', { defaultValue: 'Default Rules (markdown)' })}</label>
                  <textarea
                    value={rules}
                    onChange={(e) => { setDirty(true); setRules(e.target.value); }}
                    rows={4}
                    placeholder={t('panel.options.agent.rulesPlaceholder', { defaultValue: '# Optional default rules injected into every new agent\n- ...' })}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500"
                  />
                </div>

                {/* Color */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.color', { defaultValue: 'Default Bubble Color (hex, optional)' })}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => { setDirty(true); setColor(e.target.value); }}
                      placeholder="#3B82F6"
                      className="flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500"
                    />
                    {color && (
                      <span className="h-6 w-6 rounded border border-gray-700" style={{ backgroundColor: color }} />
                    )}
                  </div>
                </div>
              </div>
            )}

            {category === 'version' && (
              <VersionTab
                info={installs}
                loading={installsLoading}
                error={installsError}
                savingBin={savingBin}
                binChanged={binChanged}
                onSelect={selectBin}
                onRefresh={() => void loadInstalls(true)}
              />
            )}

            {category !== 'agent' && category !== 'version' && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <svg className="h-10 w-10 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <p className="text-sm text-gray-400">{t('panel.options.comingSoon', { defaultValue: 'Coming soon' })}</p>
                <p className="text-[11px] text-gray-600">
                  {t('panel.options.comingSoonDesc', { defaultValue: 'This category is reserved for future settings.' })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — Apply / Cancel */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            {t('panel.options.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!dirty || saving}
            className={`rounded px-3 py-1.5 text-xs font-medium ${
              dirty && !saving
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-gray-800 text-gray-500'
            }`}
          >
            {saving ? t('panel.options.saving', { defaultValue: 'Saving…' }) : t('panel.options.apply', { defaultValue: 'Apply' })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── §4 v2.43 — Version / About 탭 ───

/** semver a < b ? (한쪽이라도 형식 불일치면 false) — outdated 표시용 경량 비교. */
function semverLt(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const parse = (v: string): number[] => (v.split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

function SourceBadge({ source }: { source: ClaudeInstall['source'] }): React.JSX.Element {
  const cls = source === 'vscode-extension'
    ? 'bg-blue-500/20 text-blue-300'
    : source === 'unknown'
      ? 'bg-red-500/20 text-red-300'
      : 'bg-gray-700 text-gray-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {source}
    </span>
  );
}

interface VersionTabProps {
  info: ClaudeInstallsInfo | null;
  loading: boolean;
  error: string | null;
  savingBin: boolean;
  binChanged: boolean;
  onSelect: (binPath: string | null) => void;
  onRefresh: () => void;
}

function VersionTab({ info, loading, error, savingBin, binChanged, onSelect, onRefresh }: VersionTabProps): React.JSX.Element {
  const { t } = useTranslation();
  const active = info?.installs.find((i) => i.active) ?? null;
  const outdated = semverLt(active?.version ?? null, info?.latest ?? null);
  const isAuto = info != null && (info.overridePath == null || info.overridePath.length === 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700/50 pb-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.version.title', { defaultValue: 'Version & About' })}</h4>
          <p className="mt-1 text-[11px] text-gray-500">
            {t('panel.options.version.intro', { defaultValue: 'The Claude Code binary Vibisual uses to spawn agents, and where it comes from.' })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700 disabled:opacity-40"
        >
          <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
          {t('panel.options.version.refresh', { defaultValue: 'Rescan' })}
        </button>
      </div>

      {loading && !info && (
        <div className="py-8 text-center text-xs text-gray-500">{t('panel.options.version.scanning', { defaultValue: 'Scanning installations…' })}</div>
      )}
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">{error}</div>
      )}

      {info && (
        <>
          {/* Section 1 — Claude Code (active) */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.claudeCode', { defaultValue: 'Claude Code (in use)' })}</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded border border-gray-800 bg-gray-950/70 px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">{t('panel.options.version.current', { defaultValue: 'Current' })}</span>
                <span className="font-mono text-base text-gray-200">{active?.version ?? '?'}</span>
              </div>
              <div className={`flex flex-col gap-1 rounded border px-3 py-2 ${outdated ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
                <span className={`text-[10px] uppercase tracking-wider ${outdated ? 'text-amber-400' : 'text-emerald-400'}`}>{t('panel.options.version.latest', { defaultValue: 'Latest (npm)' })}</span>
                <span className={`font-mono text-base ${outdated ? 'text-amber-300' : 'text-emerald-300'}`}>{info.latest ?? '?'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
              {active && <SourceBadge source={active.source} />}
              {outdated
                ? <span className="text-amber-300">{t('panel.options.version.updateAvailable', { defaultValue: 'Update available' })}</span>
                : active?.version && info.latest
                  ? <span className="text-emerald-300">{t('panel.options.version.upToDate', { defaultValue: 'Up to date' })}</span>
                  : null}
              {info.registryError && !info.latest && (
                <span className="text-gray-600">{t('panel.options.version.registryError', { defaultValue: 'npm check failed' })}: {info.registryError}</span>
              )}
            </div>
            {active && <div className="break-all font-mono text-[10px] text-gray-600">{active.binPath}</div>}
          </div>

          {/* Section 2 — Installations selector */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {t('panel.options.version.installations', { defaultValue: 'Installations' })} ({info.installs.length})
            </span>
            <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 p-2">
              {/* Auto row */}
              <button
                type="button"
                onClick={() => onSelect(null)}
                disabled={savingBin || isAuto}
                className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-left text-xs ${
                  isAuto ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/60 hover:bg-white/[0.04]'
                } disabled:cursor-default`}
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${isAuto ? 'border-blue-400' : 'border-gray-600'}`}>
                  {isAuto && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                </span>
                <span className="flex-1">
                  <span className="font-medium text-gray-200">{t('panel.options.version.auto', { defaultValue: 'Auto (recommended)' })}</span>
                  <span className="ml-1.5 text-[10px] text-gray-500">{t('panel.options.version.autoDesc', { defaultValue: 'Let Vibisual pick automatically' })}</span>
                </span>
              </button>

              {info.installs.map((inst) => {
                const sel = inst.selected;
                return (
                  <button
                    key={inst.binPath}
                    type="button"
                    onClick={() => onSelect(inst.binPath)}
                    disabled={savingBin || sel}
                    className={`flex items-start gap-2 rounded border px-2.5 py-1.5 text-left text-xs ${
                      sel ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/60 hover:bg-white/[0.04]'
                    } disabled:cursor-default`}
                  >
                    <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${sel ? 'border-blue-400' : 'border-gray-600'}`}>
                      {sel && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-medium text-gray-200">{inst.version ?? t('panel.options.version.unknownVer', { defaultValue: 'unknown' })}</span>
                        <SourceBadge source={inst.source} />
                        {inst.active && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                            {t('panel.options.version.activeBadge', { defaultValue: 'active' })}
                          </span>
                        )}
                      </span>
                      <span className="break-all font-mono text-[10px] text-gray-500">{inst.binPath}</span>
                      {inst.detectError && <span className="text-[10px] text-red-400/80">{inst.detectError}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {binChanged && (
              <div className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {t('panel.options.version.restartHint', { defaultValue: 'Selection saved. Restart Vibisual to apply it to newly spawned agents.' })}
              </div>
            )}
          </div>

          {/* Section 3 — About */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.about', { defaultValue: 'About' })}</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-[11px]">
              <span className="text-gray-500">Vibisual</span>
              <span className="font-mono text-gray-300">{info.appVersion}</span>
              <span className="text-gray-500">Node</span>
              <span className="font-mono text-gray-300">{info.runtime.node}</span>
              {info.runtime.electron && (<><span className="text-gray-500">Electron</span><span className="font-mono text-gray-300">{info.runtime.electron}</span></>)}
              <span className="text-gray-500">Platform</span>
              <span className="font-mono text-gray-300">{info.runtime.platform} · {info.runtime.arch}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px]">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
                {t('panel.options.version.repo', { defaultValue: 'GitHub repository' })}
              </a>
              <a href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
                {t('panel.options.version.marketplace', { defaultValue: 'Claude Code on VS Code Marketplace' })}
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
