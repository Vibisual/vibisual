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
import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TERMINAL_SCROLLBACK_LINES, TERMINAL_SCROLLBACK_MIN, TERMINAL_SCROLLBACK_MAX, clampTerminalScrollback } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import type { AgentConfig, UserDefaults, ClaudeInstallsInfo, ClaudeInstall, UiLocale } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  AVAILABLE_PERMISSION_MODES,
  AVAILABLE_SETTING_SOURCES,
  AVAILABLE_AUTOCOMPACT_VALUES,
  DEFAULT_AUTOCOMPACT_TOKENS,
  isOpusModel,
  supportsFastMode,
  resolveAliasToLatest,
  listModelFamilies,
  listEffortLevels,
  parseModelSemver,
  SUPPORTED_UI_LOCALES,
  LOCALE_META,
  normalizeBashTimeoutMs,
  BASH_TIMEOUT_MS_MAX,
  BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT,
  BASH_MAX_TIMEOUT_MS_CLI_DEFAULT,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { AccountTab } from './AccountTab.js';
import { StorageTab } from './StorageTab.js';
import { BrainSettingsTab } from '../Panel/BrainActivationPanel.js';
import { NumberStepper } from './NumberStepper.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';

const API_BASE = '';

// §4 — 스테퍼 한 칸의 크기. 축마다 자릿수가 달라(턴 수는 수천, 비용은 한 자리) 같이 둘 수 없다.
const MAX_TURNS_STEP = 10;
const BUDGET_USD_STEP = 1;
const BASH_TIMEOUT_STEP_SEC = 10;

type CategoryKey = 'account' | 'agent' | 'appearance' | 'brain' | 'storage' | 'notifications' | 'permissions' | 'advanced' | 'version';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code';
const REPO_URL = 'https://github.com/Vibisual/vibisual';

// §4 v2.77 — Model 목록은 레지스트리 기반 동적(`listModelFamilies`). 폴백 alias 만 상수.
// §4 (CLI 사양 추종) — 저장된 폴백 모델이 드롭다운 목록 밖의 값인가(= '직접 입력'으로 열 값인가).
//   콤마 목록·정확한 버전 id·구버전 저장분이 여기 걸린다. 초기값과 재적용이 같은 판정을 쓰게 한 곳에 둔다.
function isOffListFallback(value: string | undefined, registry: Parameters<typeof listModelFamilies>[0]): boolean {
  const v = (value ?? '').trim();
  return v !== '' && !listModelFamilies(registry).includes(v);
}
// §4 (CLI 사양 추종) — 권한 모드 6종은 shared 한 곳(설치된 CLI 내부 enum 과 동일 집합).
const PERMISSION_VALUES = AVAILABLE_PERMISSION_MODES;
const ISOLATION_VALUES = ['none', 'worktree'] as const;
// §4 (CLI 사양 추종) — Bash 타임아웃은 초로 입력받고 ms 로 저장(스폰 env 가 ms). 0 = 미설정.
//   AgentConfigPopup 과 같은 규칙 — 여기서 정한 값이 새 커스텀 에이전트의 초기값이 된다.
const bashSecToMs = (sec: number): number | undefined => normalizeBashTimeoutMs(Math.round(sec) * 1000);
const bashMsToSec = (ms: number | undefined): number => (typeof ms === 'number' && ms > 0 ? Math.round(ms / 1000) : 0);
// §4 — Effort 등급은 하드코딩 폐기. `listEffortLevels(modelRegistry)` 로 설치된 `claude --help` 파싱값 사용
//   (CLI 미발견/파싱 실패 시 shared `AVAILABLE_EFFORT_LEVELS` 폴백). Model 드롭다운 동적화와 대칭.

interface OptionsWindowProps {
  open: boolean;
  onClose: () => void;
}

export function OptionsWindow({ open, onClose }: OptionsWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  // §4 v3.24 — Appearance › Language. 폰(max-md)에선 헤더 LanguageSwitcher 가 숨겨져 여기가 유일한 변경 경로.
  //   Apply/Cancel dirty 흐름과 독립 — 선택 즉시 적용(헤더 스위처와 동일 setUiLocale 경로).
  const uiLocale = useGraphStore((s) => s.uiLocale);
  const setUiLocale = useGraphStore((s) => s.setUiLocale);

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
  // §4 v2.88 — 전역 기본 API 비용 상한($). 0 = 무제한.
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(baseAgent.maxBudgetUsd ?? 0);
  const [isolation, setIsolation] = useState(baseAgent.isolation ?? 'none');
  const [contextWindow, setContextWindow] = useState<'1m' | '200k' | undefined>(baseAgent.contextWindow);
  const [tools, setTools] = useState<string[]>([...baseAgent.tools]);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([...(baseAgent.disallowedTools ?? [])]);
  const [rules, setRules] = useState(baseAgent.rules ?? '');
  const [color, setColor] = useState(baseAgent.color ?? '');
  // §4 (CLI 사양 추종) — 설치된 CLI 신규 옵션의 전역 기본값. 미설정이면 플래그를 붙이지 않는다.
  const [fallbackModel, setFallbackModel] = useState(baseAgent.fallbackModel ?? '');
  // §4 (CLI 사양 추종) — 폴백 모델은 드롭다운이 기본. 저장값이 목록에 없을 때만(정확한 버전
  //   id·콤마 목록·구버전 저장분) '직접 입력'으로 연다 — 목록에 없다고 값을 버리지 않는다.
  const [fallbackCustom, setFallbackCustom] = useState(() => isOffListFallback(baseAgent.fallbackModel, modelRegistry));
  const [autoCompact, setAutoCompact] = useState(baseAgent.autoCompact ?? '');
  // §4 (CLI 사양 추종) — 압축 '언제' 축 둘의 전역 기본값. 위 드롭다운('얼마나')과 직교한다.
  const [compactAfterTurn, setCompactAfterTurn] = useState(baseAgent.compactAfterTurn === true);
  const [agentCanCompact, setAgentCanCompact] = useState(baseAgent.agentCanCompact === true);
  const [excludeDynamicSections, setExcludeDynamicSections] = useState(baseAgent.excludeDynamicSystemPromptSections === true);
  const [settingSources, setSettingSources] = useState<string[]>([...(baseAgent.settingSources ?? [])]);
  const [safeMode, setSafeMode] = useState(baseAgent.safeMode === true);
  // §4 (Fast 모드) — 신규 에이전트 기본값. Opus 계열에서만 실제로 켜진다.
  const [fastMode, setFastMode] = useState(baseAgent.fastMode === true);
  const [betas, setBetas] = useState((baseAgent.betas ?? []).join(', '));
  // §4 (CLI 사양 추종) — Bash 타임아웃 기본값(초). 0 = 미설정 = CLI 기본(기본 2분 / 상한 10분).
  const [bashDefaultTimeoutSec, setBashDefaultTimeoutSec] = useState(bashMsToSec(baseAgent.bashDefaultTimeoutMs));
  const [bashMaxTimeoutSec, setBashMaxTimeoutSec] = useState(bashMsToSec(baseAgent.bashMaxTimeoutMs));
  const [dirty, setDirty] = useState(false);
  // §4 (CMD ③) — 임베디드 터미널 scrollback 줄 수. 이 한 값이 xterm 과 PTY 링버퍼를 **동시에** 정한다.
  const [terminalScrollback, setTerminalScrollback] = useState<number>(TERMINAL_SCROLLBACK_LINES);
  // §4 (CMD ④) — CMD 세션이 백그라운드에서 막혔을 때 OS 알림을 띄울지. 기본 켬.
  const [cmdBlockedNotify, setCmdBlockedNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  // §4 — Storage 탭은 자기 state 로 편집한다. 창의 나가기 가드가 그 미저장분까지 지키려면
  //   탭이 dirty 를 위로 올려 줘야 한다(탭을 떠나거나 창이 닫히면 언마운트 시 false 로 풀린다).
  const [storageDirty, setStorageDirty] = useState(false);
  // §4 — 저장 없이 나가려 할 때 뜨는 우리 디자인 확인 팝업(종전 `window.confirm` 대체).
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

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
    setMaxBudgetUsd(baseAgent.maxBudgetUsd ?? 0);
    setIsolation(baseAgent.isolation ?? 'none');
    setContextWindow(baseAgent.contextWindow);
    setTools([...baseAgent.tools]);
    setDisallowedTools([...(baseAgent.disallowedTools ?? [])]);
    setRules(baseAgent.rules ?? '');
    setColor(baseAgent.color ?? '');
    setFallbackModel(baseAgent.fallbackModel ?? '');
    setFallbackCustom(isOffListFallback(baseAgent.fallbackModel, modelRegistry));
    setAutoCompact(baseAgent.autoCompact ?? '');
    setCompactAfterTurn(baseAgent.compactAfterTurn === true);
    setAgentCanCompact(baseAgent.agentCanCompact === true);
    setExcludeDynamicSections(baseAgent.excludeDynamicSystemPromptSections === true);
    setSettingSources([...(baseAgent.settingSources ?? [])]);
    setSafeMode(baseAgent.safeMode === true);
    setFastMode(baseAgent.fastMode === true);
    setBetas((baseAgent.betas ?? []).join(', '));
    setBashDefaultTimeoutSec(bashMsToSec(baseAgent.bashDefaultTimeoutMs));
    setBashMaxTimeoutSec(bashMsToSec(baseAgent.bashMaxTimeoutMs));
    setTerminalScrollback(clampTerminalScrollback(userDefaults?.advanced?.terminalScrollbackLines));
    setCmdBlockedNotify(userDefaults?.notifications?.cmdBlocked !== false);
  }, [baseAgent, dirty, userDefaults, modelRegistry]);

  // §4 v3.71 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('options-window', open);
    return () => setCanvasCover('options-window', false);
  }, [open]);

  /**
   * §4 — 창을 닫으려는 **모든 경로의 단일 출입구**(헤더 X · 푸터 Cancel · Esc · 배경 클릭).
   * 한 경로라도 `onClose` 를 직접 부르면 그 길로만 미저장분이 조용히 사라진다(종전 Esc·배경 클릭이
   * 그랬다 — `window.confirm` 은 Cancel 버튼에만 걸려 있었다).
   */
  const requestClose = useCallback(() => {
    if (dirty || storageDirty) { setConfirmDiscardOpen(true); return; }
    onClose();
  }, [dirty, storageDirty, onClose]);

  const handleKeepEditing = useCallback(() => setConfirmDiscardOpen(false), []);

  /** 확인 팝업의 "버리고 닫기" — 폼을 저장값으로 되돌린 뒤 닫는다. */
  const handleDiscardAndClose = useCallback(() => {
    setConfirmDiscardOpen(false);
    // dirty 를 내리면 재시드 effect 가 폼을 `userDefaults` 기준으로 되돌린다(버린 편집이 남지 않게).
    // Storage 탭은 언마운트되며 서버 값으로 다시 로드하므로 별도 되돌리기가 필요 없다.
    setDirty(false);
    onClose();
  }, [onClose]);

  // 창이 닫히면 확인 팝업도 함께 접는다(다음에 열 때 뜬 채로 시작하지 않게).
  useEffect(() => { if (!open) setConfirmDiscardOpen(false); }, [open]);

  // ESC 닫기 — 확인 팝업이 떠 있으면 그 팝업만 닫는다(Esc 주인은 여기 한 곳).
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (confirmDiscardOpen) { setConfirmDiscardOpen(false); return; }
      requestClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, confirmDiscardOpen, requestClose]);

  const backdrop = useBackdropDismiss(requestClose);

  const isOpus = isOpusModel(model);
  // §4 (Fast 모드) — `--model` 로 나가는 값과 같은 규칙으로 판정(서버 `wantsFastMode` 와 동일).
  const fastModeSupported = supportsFastMode(modelVersion?.trim() || model);
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
          maxBudgetUsd: maxBudgetUsd > 0 ? maxBudgetUsd : undefined,
          isolation: isolation !== 'none' ? isolation : undefined,
          contextWindow: isOpus && contextWindow === '200k' ? '200k' : undefined,
          tools,
          disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
          rules: rules.trim() || undefined,
          color: color || undefined,
          skills: [...(userDefaults?.agentConfig?.skills ?? DEFAULT_AGENT_CONFIG.skills)],
          // §4 (CLI 사양 추종) — 미설정은 undefined 로 보내 플래그가 붙지 않게 한다.
          fallbackModel: fallbackModel.trim() || undefined,
          autoCompact: autoCompact.trim() || undefined,
          compactAfterTurn: compactAfterTurn ? true : undefined,
          agentCanCompact: agentCanCompact ? true : undefined,
          excludeDynamicSystemPromptSections: excludeDynamicSections ? true : undefined,
          settingSources: settingSources.length > 0 ? settingSources : undefined,
          safeMode: safeMode ? true : undefined,
          // §4 (Fast 모드) — 지원 모델일 때만 저장(모델을 바꿔 두고 나중에 되돌렸을 때의 부활 방지).
          fastMode: fastMode && fastModeSupported ? true : undefined,
          betas: betas.split(',').map((b) => b.trim()).filter(Boolean).length > 0 ? betas.split(',').map((b) => b.trim()).filter(Boolean) : undefined,
          // §4 (CLI 사양 추종) — 초 → ms. 0/범위 밖은 undefined = 미설정(스폰 env 키 자체가 안 붙는다).
          bashDefaultTimeoutMs: bashSecToMs(bashDefaultTimeoutSec),
          bashMaxTimeoutMs: bashSecToMs(bashMaxTimeoutSec),
        },
        // §4 (CMD ③④) — 이 창이 **모르는 키는 스프레드로 그대로 통과**시킨다(부분 페이로드가
        //   남의 설정을 지우는 사고를 막는 규약 — agent-config PUT 과 같은 이유).
        advanced: { ...(userDefaults?.advanced ?? {}), terminalScrollbackLines: clampTerminalScrollback(terminalScrollback) },
        notifications: { ...(userDefaults?.notifications ?? {}), cmdBlocked: cmdBlockedNotify },
      };
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setDirty(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [model, modelVersion, permissionMode, permissionTimeoutPolicy, isOpus, effort, maxTurns, maxBudgetUsd, isolation, contextWindow, tools, disallowedTools, rules, color, userDefaults, fallbackModel, autoCompact, compactAfterTurn, agentCanCompact, excludeDynamicSections, settingSources, safeMode, fastMode, fastModeSupported, betas, bashDefaultTimeoutSec, bashMaxTimeoutSec, terminalScrollback, cmdBlockedNotify]);

  if (!open) return null;

  const categories: { key: CategoryKey; label: string; icon: React.JSX.Element }[] = [
    // §4 v4.82 — Account. 로그인 계정 확인 + 로그아웃이 여기 있다(File > Options > Account).
    { key: 'account', label: t('panel.options.categories.account', { defaultValue: 'Account' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    ) },
    { key: 'agent', label: t('panel.options.categories.agent', { defaultValue: 'Agent Defaults' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    ) },
    { key: 'appearance', label: t('panel.options.categories.appearance', { defaultValue: 'Appearance' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
    ) },
    // §5.10 (H) — 프로젝트 두뇌 켜고 끄기. **꺼져 있을 때도 보이는 자리**여야 한다
    //   (게이트 ③ 이 Brain 버블을 지우므로 두뇌 안에 두면 켤 방법이 사라진다).
    { key: 'brain', label: t('panel.options.categories.brain', { defaultValue: 'Project Brain' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 2.2A3 3 0 0 0 9 19h6a3 3 0 0 0 2-5.8A3 3 0 0 0 18 11a3 3 0 0 0-3-3 3 3 0 0 0-3-3Z"/><path d="M12 5v14"/></svg>
    ) },
    // §3.2.3 — 보존 설정 + 저장소 사용량. "몰래 지우지 않는다"를 성립시키는 자리.
    { key: 'storage', label: t('panel.options.categories.storage', { defaultValue: 'Storage' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      <div className="flex h-[640px] max-h-[92dvh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
            {t('panel.options.title', { defaultValue: 'Options' })}
            {dirty && <span className="text-xs font-normal text-amber-400">• {t('panel.options.unsaved', { defaultValue: 'unsaved' })}</span>}
          </h3>
          <button type="button" onClick={requestClose} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body — 좌측 사이드바 + 우측 패널 */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — 폰에선 좁혀 본문 공간 확보 */}
          <div className="w-44 shrink-0 overflow-y-auto border-r border-gray-700/50 bg-gray-900/40 py-2 max-md:w-28">
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
                  <p className="mt-1 text-[12px] text-gray-500">
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
                  <div className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500">
                    <span className="uppercase tracking-wider">Version:</span>
                    <select
                      value={effectiveVersionValue}
                      onChange={(e) => handleVersionChange(e.target.value)}
                      className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 font-mono text-[12px] text-gray-300 outline-none hover:border-gray-600 focus:border-blue-500"
                    >
                      {VERSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {isCustomVersion && (
                      <input
                        type="text"
                        value={modelVersion ?? ''}
                        onChange={(e) => { setDirty(true); setModelVersion(e.target.value); }}
                        placeholder={`claude-${model}-X-Y`}
                        className="flex-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-0 font-mono text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
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
                    {/* §4 (CLI 사양 추종) — 저장값 'default' 의 CLI 표시명은 manual. 이름만 바꿔 보여준다. */}
                    {PERMISSION_VALUES.map((v) => <option key={v} value={v}>{v === 'default' ? 'manual' : v}</option>)}
                  </select>
                  {permissionMode !== 'bypassPermissions' && permissionMode !== 'plan' && (
                    <div className="mt-1 flex items-center gap-2 rounded border border-gray-700/60 bg-gray-900/40 px-2.5 py-1.5">
                      <span className="text-[12px] text-gray-400">{t('panel.agentConfig.permissionTimeoutPolicy.label', { defaultValue: 'On no response (60s)' })}:</span>
                      <select
                        value={permissionTimeoutPolicy}
                        onChange={(e) => { setDirty(true); setPermissionTimeoutPolicy(e.target.value as 'allow' | 'deny'); }}
                        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] text-gray-200 outline-none focus:border-blue-500"
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
                      {listEffortLevels(modelRegistry).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}

                {/* Max Turns + Budget + Isolation */}
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.maxTurns', { defaultValue: 'Max Turns (0 = unlimited)' })}</label>
                    <NumberStepper
                      min={0}
                      step={MAX_TURNS_STEP}
                      value={maxTurns}
                      widthClassName="w-full"
                      ariaLabel={t('panel.options.agent.maxTurns', { defaultValue: 'Max Turns (0 = unlimited)' })}
                      onChange={(next) => { setDirty(true); setMaxTurns(next); }}
                    />
                  </div>
                  {/* §4 v2.88 — 전역 기본 API 비용 상한($). 0 = 무제한. */}
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.maxBudgetUsd', { defaultValue: 'Budget ($, 0 = unlimited)' })}</label>
                    <NumberStepper
                      min={0}
                      step={BUDGET_USD_STEP}
                      value={maxBudgetUsd}
                      widthClassName="w-full"
                      ariaLabel={t('panel.options.agent.maxBudgetUsd', { defaultValue: 'Budget ($, 0 = unlimited)' })}
                      onChange={(next) => { setDirty(true); setMaxBudgetUsd(next); }}
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

                {/* §4 (CLI 사양 추종) — 설치된 claude 신규 옵션의 전역 기본값. 전부 미설정이 기본. */}
                <div className="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900/40 p-2.5">
                  <span className="text-xs font-medium text-gray-400">{t('panel.agentConfig.cliOptions.label')}</span>
                  <div className="flex gap-3">
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.fallbackModel.label')}</label>
                      {/* §4 (CLI 사양 추종) — 목록은 위 Model 과 **같은 레지스트리**(`listModelFamilies`)라
                          새 패밀리가 나오면 여기에도 저절로 들어온다(모델 이름 하드코딩 ❌).
                          맨 끝 '직접 입력'은 콤마 목록·정확한 버전 id 를 쓰던 길을 남겨 둔 자리다. */}
                      <select
                        value={fallbackCustom ? '__custom__' : fallbackModel.trim()}
                        onChange={(e) => {
                          setDirty(true);
                          if (e.target.value === '__custom__') { setFallbackCustom(true); return; }
                          setFallbackCustom(false);
                          setFallbackModel(e.target.value);
                        }}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                      >
                        <option value="">{t('panel.agentConfig.fallbackModel.unsetLabel')}</option>
                        {listModelFamilies(modelRegistry).map((v) => <option key={v} value={v}>{v}</option>)}
                        <option value="__custom__">{t('panel.agentConfig.fallbackModel.customLabel')}</option>
                      </select>
                      {fallbackCustom && (
                        <input
                          type="text"
                          value={fallbackModel}
                          onChange={(e) => { setDirty(true); setFallbackModel(e.target.value); }}
                          placeholder={t('panel.agentConfig.fallbackModel.placeholder')}
                          className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-[12px] text-gray-200 outline-none focus:border-blue-500"
                        />
                      )}
                    </div>
                    {/* §4 (CLI 사양 추종) — 자동 압축의 **전역 기본값**. 에이전트 설정이 미설정인
                        모든 버블이 이 값을 따르므로, 이미 만들어져 돌던 에이전트도 함께 바뀐다.
                        여기서도 미설정이면 내장 기본(200k)으로 떨어진다 — 그 사실을 라벨이 직접 말한다
                        (CLI 기본에 맡기면 창 전체라 압축이 사실상 사라지기 때문). */}
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.autoCompact.label')}</label>
                      <select
                        value={autoCompact}
                        onChange={(e) => { setDirty(true); setAutoCompact(e.target.value); }}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                      >
                        {AVAILABLE_AUTOCOMPACT_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v === ''
                              ? t('panel.agentConfig.autoCompact.unsetDefaultLabel', { tokens: `${Number(DEFAULT_AUTOCOMPACT_TOKENS) / 1000}k` })
                              : v === 'auto' ? 'auto' : `${Number(v) / 1000}k`}
                          </option>
                        ))}
                      </select>
                      {/* §9 — 설명문도 가독 하한 12px. 위계는 크기가 아니라 색으로 낮춘다. */}
                      <span className="text-[12px] leading-snug text-gray-600">{t('panel.agentConfig.autoCompact.globalTip')}</span>
                      {/* §4 (CLI 사양 추종) — '얼마나 차면'(위 드롭다운) 과 '언제'(아래 둘)는 직교한다. */}
                      <label className="mt-1 flex items-start gap-2 text-[12px] text-gray-400">
                        <input
                          type="checkbox"
                          checked={compactAfterTurn}
                          onChange={(e) => { setDirty(true); setCompactAfterTurn(e.target.checked); }}
                          className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                        />
                        <span>
                          {t('panel.agentConfig.compactAfterTurn.label')}
                          <span className="ml-1 text-gray-600">{t('panel.agentConfig.compactAfterTurn.hint')}</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-[12px] text-gray-400">
                        <input
                          type="checkbox"
                          checked={agentCanCompact}
                          onChange={(e) => { setDirty(true); setAgentCanCompact(e.target.checked); }}
                          className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                        />
                        <span>
                          {t('panel.agentConfig.agentCanCompact.label')}
                          <span className="ml-1 text-gray-600">{t('panel.agentConfig.agentCanCompact.hint')}</span>
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.settingSources.label')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {AVAILABLE_SETTING_SOURCES.map((src) => {
                        const on = settingSources.includes(src);
                        return (
                          <button
                            key={src}
                            type="button"
                            onClick={() => { setDirty(true); setSettingSources((p) => (p.includes(src) ? p.filter((x) => x !== src) : [...p, src])); }}
                            className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
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
                      onChange={(e) => { setDirty(true); setExcludeDynamicSections(e.target.checked); }}
                      className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                    />
                    <span>{t('panel.agentConfig.excludeDynamicSections.label')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-[12px] text-gray-400">
                    <input
                      type="checkbox"
                      checked={safeMode}
                      onChange={(e) => { setDirty(true); setSafeMode(e.target.checked); }}
                      className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                    />
                    <span>
                      {t('panel.agentConfig.safeMode.label')}
                      <span className="ml-1 text-amber-500/80">{t('panel.agentConfig.safeMode.warn')}</span>
                    </span>
                  </label>
                  {/* §4 (Fast 모드) — 지원하지 않는 모델에서는 CLI 가 조용히 무시하므로 비활성 + 이유. */}
                  <label className={`flex items-start gap-2 text-[12px] ${fastModeSupported ? 'text-gray-400' : 'text-gray-600'}`}>
                    <input
                      type="checkbox"
                      checked={fastMode && fastModeSupported}
                      disabled={!fastModeSupported}
                      onChange={(e) => { setDirty(true); setFastMode(e.target.checked); }}
                      className="mt-0.5 h-3.5 w-3.5 accent-blue-500 disabled:cursor-not-allowed"
                    />
                    <span>
                      {t('panel.agentConfig.fastMode.label')}
                      <span className="ml-1 text-gray-600">
                        {fastModeSupported ? t('panel.agentConfig.fastMode.hint') : t('panel.agentConfig.fastMode.unsupported')}
                      </span>
                    </span>
                  </label>
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.betas.label')}</label>
                    <input
                      type="text"
                      value={betas}
                      onChange={(e) => { setDirty(true); setBetas(e.target.value); }}
                      placeholder={t('panel.agentConfig.betas.placeholder')}
                      className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500"
                    />
                  </div>
                  {/* §4 (CLI 사양 추종) — Bash 타임아웃 기본값(초). 0 = 미설정(CLI 기본 유지). */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.bashTimeout.label')}</span>
                    <div className="flex gap-3">
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.defaultLabel')}</label>
                        <NumberStepper
                          min={0}
                          max={BASH_TIMEOUT_MS_MAX / 1000}
                          step={BASH_TIMEOUT_STEP_SEC}
                          value={bashDefaultTimeoutSec}
                          widthClassName="w-full"
                          ariaLabel={t('panel.agentConfig.bashTimeout.defaultLabel')}
                          onChange={(next) => { setDirty(true); setBashDefaultTimeoutSec(next); }}
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.maxLabel')}</label>
                        <NumberStepper
                          min={0}
                          max={BASH_TIMEOUT_MS_MAX / 1000}
                          step={BASH_TIMEOUT_STEP_SEC}
                          value={bashMaxTimeoutSec}
                          widthClassName="w-full"
                          ariaLabel={t('panel.agentConfig.bashTimeout.maxLabel')}
                          onChange={(next) => { setDirty(true); setBashMaxTimeoutSec(next); }}
                        />
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

                {/* Tools allow-list */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.tools', { defaultValue: 'Tools (allow-list)' })}</label>
                  <div className="flex flex-wrap gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 p-2">
                    {AVAILABLE_AGENT_TOOLS.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        className={`rounded px-2 py-0.5 text-[12px] ${
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
                        className={`rounded px-2 py-0.5 text-[12px] ${
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
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-[12px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500"
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
                      className="flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-[12px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500"
                    />
                    {color && (
                      <span className="h-6 w-6 rounded border border-gray-700" style={{ backgroundColor: color }} />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* §4 v3.24 — Appearance: 언어 선택(즉시 적용). v2.42 에서 1차 예정이던 uiLocale 실구현. */}
            {category === 'appearance' && (
              <div className="flex flex-col gap-4">
                <div className="border-b border-gray-700/50 pb-2">
                  <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.categories.appearance', { defaultValue: 'Appearance' })}</h4>
                  <p className="mt-1 text-[12px] text-gray-500">
                    {t('panel.options.appearance.intro', { defaultValue: 'Personalize how Vibisual looks.' })}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">
                    {t('panel.options.appearance.language', { defaultValue: 'Language' })}
                  </label>
                  <select
                    value={uiLocale}
                    onChange={(e) => { void setUiLocale(e.target.value as UiLocale); }}
                    className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                  >
                    {SUPPORTED_UI_LOCALES.map((loc: UiLocale) => (
                      <option key={loc} value={loc}>{LOCALE_META[loc].nativeName}</option>
                    ))}
                  </select>
                  <p className="text-[12px] text-gray-600">
                    {t('panel.options.appearance.languageDesc', { defaultValue: 'UI display language. Applies immediately.' })}
                  </p>
                </div>
              </div>
            )}

            {category === 'account' && <AccountTab />}

            {category === 'storage' && <StorageTab onDirtyChange={setStorageDirty} />}

            {/* §5.10 (H) — 즉시 반영이라 Apply/dirty 대상이 아니다(§5.11 플러그인 창과 같은 문법). */}
            {category === 'brain' && <BrainSettingsTab />}

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

            {/* §4 (CMD ③) — Advanced: 임베디드 터미널 scrollback. */}
            {category === 'advanced' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-400">
                    {t('panel.options.advanced.terminalScrollback', { defaultValue: 'Terminal scrollback (lines)' })}
                  </label>
                  <input
                    type="number"
                    min={TERMINAL_SCROLLBACK_MIN}
                    max={TERMINAL_SCROLLBACK_MAX}
                    step={500}
                    value={terminalScrollback}
                    onChange={(e) => { setDirty(true); setTerminalScrollback(Number(e.target.value)); }}
                    className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <p className="text-[12px] text-gray-500">
                    {t('panel.options.advanced.terminalScrollbackDesc', { shortcut: shortcutLabel('Ctrl+F'), defaultValue: 'CMD 터미널이 보관하는 출력 줄 수입니다. 화면 스크롤과 {{shortcut}} 검색이 같은 범위를 씁니다. 새로 여는 터미널부터 적용됩니다.' })}
                  </p>
                </div>
              </div>
            )}

            {/* §4 (CMD ④) — Notifications: 백그라운드 blocked 알림. */}
            {category === 'notifications' && (
              <div className="flex flex-col gap-4">
                <label className="flex cursor-pointer items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 hover:border-gray-600">
                  <input
                    type="checkbox"
                    checked={cmdBlockedNotify}
                    onChange={(e) => { setDirty(true); setCmdBlockedNotify(e.target.checked); }}
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-200">
                      {t('panel.options.notifications.cmdBlocked', { defaultValue: 'CMD 세션이 입력을 기다리면 알림' })}
                    </span>
                    <span className="text-[12px] text-gray-500">
                      {t('panel.options.notifications.cmdBlockedDesc', { defaultValue: '다른 탭·다른 창을 보고 있을 때만 알립니다. 창이 포커스돼 있으면 화면에 이미 보이므로 띄우지 않습니다.' })}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {category !== 'agent' && category !== 'version' && category !== 'appearance' && category !== 'account' && category !== 'storage' && category !== 'brain' && category !== 'advanced' && category !== 'notifications' && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <svg className="h-10 w-10 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <p className="text-sm text-gray-400">{t('panel.options.comingSoon', { defaultValue: 'Coming soon' })}</p>
                <p className="text-[12px] text-gray-600">
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
            onClick={requestClose}
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

      {/* 저장 없이 나가려 할 때 — 우리 디자인 확인 팝업(스스로 portal 이라 이 자리 위에 뜬다) */}
      <UnsavedChangesDialog
        open={confirmDiscardOpen}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscardAndClose}
      />
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

/**
 * §4 (Claude Code CLI 자동 업데이트) — CLI 를 앱 켤 때마다 최신으로 유지할지 정하는 토글.
 *
 * SSOT 는 `UserDefaults.claudeAutoUpdate.enabled`(**미설정 = 켬**). 켜져 있으면 서버가 부팅 시
 * 1회 `isOutdated` 를 보고 `installLatestClaude()` 를 조용히 돌린다. 꺼 두면 그 자동 경로만
 * 멈추고 여기 [지금 업데이트] 로 직접 올린다.
 *
 * ⚠ **Vibisual 앱 업데이트(§4 v2.44 electron-updater)와는 다른 축**이다 — 앱 쪽은 종전대로
 *   항상 자동이고 헤더의 파란 업데이트 버튼이 담당한다. 이 토글은 CLI 에만 걸린다.
 */
function ClaudeAutoUpdateSection({ source, outdated, onRefresh }: {
  source: ClaudeInstall['source'] | undefined;
  outdated: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const progress = useGraphStore((s) => s.claudeInstallProgress);
  const install = useGraphStore((s) => s.installClaudeVersion);
  const [saving, setSaving] = useState(false);

  const enabled = userDefaults?.claudeAutoUpdate?.enabled !== false;
  // 확장 번들은 마켓플레이스 밖에서 갱신할 수 없다 — 자동도 수동도 불가라 그 사실을 밝힌다.
  const canUpdate = source !== 'vscode-extension' && source !== 'unknown';
  const running = progress != null && (progress.status === 'starting' || progress.status === 'running');

  const toggle = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claudeAutoUpdate: { enabled: !enabled } } satisfies Partial<UserDefaults>),
      });
    } catch { /* WS user_defaults_updated 로 따라온다 */ }
    finally { setSaving(false); }
  }, [enabled]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('panel.options.version.claudeAutoUpdate.title', { defaultValue: 'Claude Code updates' })}
      </span>
      <div className="flex flex-col gap-2 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={() => { void toggle(); }}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-500"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-xs text-gray-200">
              {t('panel.options.version.claudeAutoUpdate.label', { defaultValue: 'Keep Claude Code up to date automatically' })}
            </span>
            <span className="text-[12px] text-gray-500">
              {enabled
                ? t('panel.options.version.claudeAutoUpdate.onHint', { defaultValue: 'Vibisual updates the CLI to the latest version each time you launch the app.' })
                : t('panel.options.version.claudeAutoUpdate.offHint', { defaultValue: 'Automatic updates are off. Use "Update now" to update the CLI yourself.' })}
            </span>
          </span>
        </label>

        {source === 'vscode-extension' && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
            {t('panel.options.version.claudeAutoUpdate.vscodeNotice', {
              defaultValue: 'The active binary comes from the VS Code extension, which only the Marketplace can update. Pick a different installation above to let Vibisual manage updates.',
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2 text-[12px]">
          <button
            type="button"
            onClick={() => { void install().then(onRefresh); }}
            disabled={!canUpdate || running}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700 disabled:opacity-40"
          >
            {running
              ? t('panel.options.version.claudeAutoUpdate.updating', { defaultValue: 'Updating…' })
              : t('panel.options.version.claudeAutoUpdate.updateNow', { defaultValue: 'Update now' })}
          </button>
          <span className="text-gray-500">
            {progress?.status === 'error'
              ? (progress.error ?? t('panel.options.version.claudeAutoUpdate.updateFailed', { defaultValue: 'Update failed' }))
              : progress?.status === 'done'
                ? t('panel.options.version.claudeAutoUpdate.updated', { defaultValue: 'Updated to {{version}}', version: progress.newVersion ?? '?' })
                : outdated
                  ? t('panel.options.version.updateAvailable', { defaultValue: 'Update available' })
                  : t('panel.options.version.upToDate', { defaultValue: 'Up to date' })}
          </span>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ClaudeInstall['source'] }): React.JSX.Element {
  // §4 (첫 실행 설치 온보딩) — 'native' 는 우리가 깔고 우리가 갱신하는 출처라 자동 선택 1순위다.
  const cls = source === 'native'
    ? 'bg-emerald-500/20 text-emerald-300'
    : source === 'vscode-extension'
      ? 'bg-blue-500/20 text-blue-300'
      : source === 'unknown'
        ? 'bg-red-500/20 text-red-300'
        : 'bg-gray-700 text-gray-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider ${cls}`}>
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
          <p className="mt-1 text-[12px] text-gray-500">
            {t('panel.options.version.intro', { defaultValue: 'The Claude Code binary Vibisual uses to spawn agents, and where it comes from.' })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[12px] text-gray-300 hover:bg-gray-700 disabled:opacity-40"
        >
          <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
          {t('panel.options.version.refresh', { defaultValue: 'Rescan' })}
        </button>
      </div>

      {loading && !info && (
        <div className="py-8 text-center text-xs text-gray-500">{t('panel.options.version.scanning', { defaultValue: 'Scanning installations…' })}</div>
      )}
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">{error}</div>
      )}

      {info && (
        <>
          {/* Section 1 — Claude Code (active) */}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.claudeCode', { defaultValue: 'Claude Code (in use)' })}</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded border border-gray-800 bg-gray-950/70 px-3 py-2">
                <span className="text-[12px] uppercase tracking-wider text-gray-500">{t('panel.options.version.current', { defaultValue: 'Current' })}</span>
                <span className="font-mono text-base text-gray-200">{active?.version ?? '?'}</span>
              </div>
              <div className={`flex flex-col gap-1 rounded border px-3 py-2 ${outdated ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
                <span className={`text-[12px] uppercase tracking-wider ${outdated ? 'text-amber-400' : 'text-emerald-400'}`}>{t('panel.options.version.latest', { defaultValue: 'Latest (npm)' })}</span>
                <span className={`font-mono text-base ${outdated ? 'text-amber-300' : 'text-emerald-300'}`}>{info.latest ?? '?'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-400">
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
            {active && <div className="break-all font-mono text-[12px] text-gray-600">{active.binPath}</div>}
          </div>

          {/* Section 2 — Installations selector */}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
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
                  <span className="ml-1.5 text-[12px] text-gray-500">{t('panel.options.version.autoDesc', { defaultValue: 'Let Vibisual pick automatically' })}</span>
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
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
                            {t('panel.options.version.activeBadge', { defaultValue: 'active' })}
                          </span>
                        )}
                      </span>
                      <span className="break-all font-mono text-[12px] text-gray-500">{inst.binPath}</span>
                      {inst.detectError && <span className="text-[12px] text-red-400/80">{inst.detectError}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {binChanged && (
              <div className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[12px] text-emerald-200">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                {/* §4 (첫 실행 설치 온보딩) — 실행본 해석이 지연 캐시가 되면서 v2.43 의 "restart to apply" 제약이 풀렸다. */}
                {t('panel.options.version.selectionApplied', { defaultValue: 'Selection saved and applied — newly spawned agents use it right away.' })}
              </div>
            )}
          </div>

          {/* Section 2-1 — Claude Code CLI 자동 업데이트 (§4). 앱 업데이트(헤더 버튼)와는 별개 축. */}
          <ClaudeAutoUpdateSection source={active?.source} outdated={outdated} onRefresh={onRefresh} />

          {/* Section 3 — About */}
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.about', { defaultValue: 'About' })}</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-[12px]">
              <span className="text-gray-500">Vibisual</span>
              <span className="font-mono text-gray-300">{info.appVersion}</span>
              <span className="text-gray-500">Node</span>
              <span className="font-mono text-gray-300">{info.runtime.node}</span>
              {info.runtime.electron && (<><span className="text-gray-500">Electron</span><span className="font-mono text-gray-300">{info.runtime.electron}</span></>)}
              <span className="text-gray-500">Platform</span>
              <span className="font-mono text-gray-300">{info.runtime.platform} · {info.runtime.arch}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[12px]">
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
