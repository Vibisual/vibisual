/** §4 — 사용자 옵션창(File → Options). Apply/Cancel: dirty 일 때 Apply 만 서버 PUT, 응답 + WS `user_defaults_updated` 로 다른 창에도 반영된다. */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TERMINAL_SCROLLBACK_LINES, TERMINAL_SCROLLBACK_MIN, TERMINAL_SCROLLBACK_MAX, clampTerminalScrollback, isVerificationGateEnabled } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { ScrollFade } from '../ScrollFade.js';
import { WINDOW_NAV_BODY, WINDOW_NAV_LIST, WINDOW_NAV_PANE, windowNavItemClass } from '../Layout/windowNav.js';
import type { AgentConfig, AgentEngineKind, UserDefaults, UserDefaultsPatch, ClaudeInstallsInfo, ClaudeInstall, CodexInstallsInfo, CodexSetupState, ManagedEngineStatus, UiLocale } from '@vibisual/shared';
import {
  AVAILABLE_AGENT_TOOLS,
  DEFAULT_AGENT_CONFIG,
  AVAILABLE_PERMISSION_MODES,
  AVAILABLE_SETTING_SOURCES,
  AVAILABLE_AUTOCOMPACT_VALUES,
  AUTOCOMPACT_OFF,
  DEFAULT_AUTOCOMPACT_TOKENS,
  isAutoCompactOn,
  turnCompactTriggerTokens,
  TURN_COMPACT_TRIGGER_RATIO,
  resolveAutoCompact,
  isOpusModel,
  supportsEffortSelection,
  supportsFastMode,
  isThinkingEnabled,
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
import { useGraphStore, selectActivePluginProjectPath } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { ProviderTabs } from '../Engine/ProviderTabs.js';
import { ProviderDefaults, type ProviderDefaultsHandle } from './ProviderDefaults.js';
import { MainProviderSelect } from './MainProviderSelect.js';
import { AccountTab } from './AccountTab.js';
import { StorageTab } from './StorageTab.js';
// §6 — 단축키 설정(목록은 `COMMANDS` 표에서 자동 생성).
import { KeyboardTab } from './KeyboardTab.js';
// §4 앱 테마 — 기본 테마 고르기 + 사용자 테마 폴더.
import { ThemeTab } from './ThemeTab.js';
import { BgTaskProbeSection } from './BgTaskProbeSection.js';
import { DefaultChip, EngineBinPicker, ManagedPendingNotice, TemporaryChip } from './EngineBinPicker.js';
import { SessionProbeSection } from './SessionProbeSection.js';
import { ProcessGuardSection } from './ProcessGuardSection.js';
import { EngineBridgeSection } from './EngineBridgeSection.js';
import { VerificationGateSection } from './VerificationGateSection.js';
import { ExternalFolderSection } from './ExternalFolderSection.js';
import { WebFoldSection } from './WebFoldSection.js';
import { TokenSaverSection } from './TokenSaverSection.js';
import { NumberStepper } from './NumberStepper.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다
//   (핸들러는 이미 ctrlKey || metaKey 를 함께 보므로 **표시만** 어긋나 있었다).
import { shortcutLabel } from '../../utils/platform.js';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';
import { AutoCompactConfirm, type AutoCompactConfirmKind } from '../Panel/AutoCompactConfirm.js';
import { CreditPages } from '../Panel/CreditPages.js';

const API_BASE = '';

// §4 — 스테퍼 한 칸의 크기. 축마다 자릿수가 달라(턴 수는 수천, 비용은 한 자리) 같이 둘 수 없다.
const MAX_TURNS_STEP = 10;
const BUDGET_USD_STEP = 1;
const BASH_TIMEOUT_STEP_SEC = 10;

export type CategoryKey = 'account' | 'credits' | 'project' | 'agent' | 'appearance' | 'theme' | 'keyboard' | 'storage' | 'notifications' | 'permissions' | 'advanced' | 'version';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code';
const REPO_URL = 'https://github.com/Vibisual/vibisual';

// §4 · §5.25 (C) — 버전 칸 엔진 탭은 실행본이 있는 둘뿐(올모델 §5.19 는 CLI 가 아니다).
const VERSION_TAB_ENGINES: readonly AgentEngineKind[] = ['claude', 'codex'];
const versionTabOf = (engine: AgentEngineKind): AgentEngineKind => (VERSION_TAB_ENGINES.includes(engine) ? engine : 'claude');

// §4 — Model 목록은 레지스트리 동적(`listModelFamilies`), 폴백 alias 만 상수.
// 저장된 폴백이 목록 밖 값(콤마 목록·정확한 id·옛 저장분)인가 — 초기값과 재적용이 같은 판정을 쓴다.
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
  /** §5.10 (O) — 열릴 때 먼저 보일 카테고리. 다른 화면(기억 정리 칸)이 특정 탭으로 곧장 들어올 때 쓴다. */
  initialCategory?: CategoryKey;
}

export function OptionsWindow({ open, onClose, initialCategory }: OptionsWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  // §4 — Apply 응답을 그 자리에서 스토어에 앉힌다. WS 를 기다리면 그 사이에 배치 타이머가
  //   들고 있던 **저장 직전 스냅샷**이 먼저 풀려 폼이 옛 값으로 되돌아간다(= 저장 실패로 보인다).
  const applyUserDefaults = useGraphStore((s) => s.applyUserDefaults);
  const chooseEngine = useGraphStore((s) => s.chooseEngine);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  // §4 — Appearance › Language. dirty 흐름과 독립, 즉시 적용(헤더와 같은 setUiLocale). 폰에선 헤더 전환기가 숨어 여기가 변경 경로다.
  const uiLocale = useGraphStore((s) => s.uiLocale);
  const setUiLocale = useGraphStore((s) => s.setUiLocale);

  const [category, setCategory] = useState<CategoryKey>(initialCategory ?? 'agent');
  // 열릴 때마다 지정된 탭으로 — 닫혔다 다른 문으로 다시 열리면 그 문이 가리키는 탭이 먼저 보여야 한다.
  useEffect(() => {
    if (open && initialCategory) setCategory(initialCategory);
  }, [open, initialCategory]);

  const mainEngine = userDefaults?.engineChoice?.kind ?? 'claude';
  const [settingsEngine, setSettingsEngine] = useState(mainEngine);
  useEffect(() => { if (open) setSettingsEngine(mainEngine); }, [open, mainEngine]);
  // §4 — 버전 칸 엔진 탭(보기만). 열 때마다 메인 제공자부터 — 올모델이면 Claude Code.
  const [versionEngine, setVersionEngine] = useState<AgentEngineKind>(() => versionTabOf(mainEngine));
  useEffect(() => { if (open) setVersionEngine(versionTabOf(mainEngine)); }, [open, mainEngine]);
  const claudeDefaults = mainEngine === 'claude' ? userDefaults?.agentConfig : userDefaults?.engineConfigs?.claude;
  // Agent Defaults 폼 state — 초기값은 userDefaults.agentConfig 위에 DEFAULT_AGENT_CONFIG 깔기
  const baseAgent: AgentConfig = useMemo(() => ({
    ...DEFAULT_AGENT_CONFIG,
    ...(claudeDefaults ?? {}),
    tools: claudeDefaults?.tools ?? [...DEFAULT_AGENT_CONFIG.tools],
    skills: claudeDefaults?.skills ?? [...DEFAULT_AGENT_CONFIG.skills],
  }), [claudeDefaults]);

  const [model, setModel] = useState(baseAgent.model);
  const [modelVersion, setModelVersion] = useState<string | undefined>(baseAgent.modelVersion);
  const [permissionMode, setPermissionMode] = useState(baseAgent.permissionMode);
  const [permissionTimeoutPolicy, setPermissionTimeoutPolicy] = useState<'allow' | 'deny'>(baseAgent.permissionTimeoutPolicy ?? 'allow');
  const [effort, setEffort] = useState(baseAgent.effort ?? 'default');
  const [maxTurns, setMaxTurns] = useState(baseAgent.maxTurns ?? 0);
  // §4 — 전역 기본 API 비용 상한($). 0 = 무제한.
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
  // §4 (CLI 사양 추종) — 숫자로 못 잡는 자리를 에이전트가 부르는 축. 위 드롭다운과 직교한다.
  const [agentCanCompact, setAgentCanCompact] = useState(baseAgent.agentCanCompact === true);
  const [excludeDynamicSections, setExcludeDynamicSections] = useState(baseAgent.excludeDynamicSystemPromptSections === true);
  const [settingSources, setSettingSources] = useState<string[]>([...(baseAgent.settingSources ?? [])]);
  const [safeMode, setSafeMode] = useState(baseAgent.safeMode === true);
  // §4 (Fast 모드) — 신규 에이전트 기본값. Opus 계열에서만 실제로 켜진다.
  const [fastMode, setFastMode] = useState(baseAgent.fastMode === true);
  // §4 (Thinking on/off) — 확장 사고. 기본이 켬이라 판정 함수를 거친다(명시 false 만 끔).
  const [thinking, setThinking] = useState(isThinkingEnabled(baseAgent.thinking));
  const [betas, setBetas] = useState((baseAgent.betas ?? []).join(', '));
  // §4 (CLI 사양 추종) — Bash 타임아웃 기본값(초). 0 = 미설정 = CLI 기본(기본 2분 / 상한 10분).
  const [bashDefaultTimeoutSec, setBashDefaultTimeoutSec] = useState(bashMsToSec(baseAgent.bashDefaultTimeoutMs));
  const [bashMaxTimeoutSec, setBashMaxTimeoutSec] = useState(bashMsToSec(baseAgent.bashMaxTimeoutMs));
  const [dirty, setDirty] = useState(false);
  // §4 (CMD ③) — 임베디드 터미널 scrollback 줄 수. 이 한 값이 xterm 과 PTY 링버퍼를 **동시에** 정한다.
  const [terminalScrollback, setTerminalScrollback] = useState<number>(TERMINAL_SCROLLBACK_LINES);
  // §4 (CMD ④) — CMD 세션이 백그라운드에서 막혔을 때 OS 알림을 띄울지. 기본 켬.
  const [cmdBlockedNotify, setCmdBlockedNotify] = useState(true);
  // §4 엔진 다리 — 우리가 띄우는 세션에 모드를 실을지. 기본 켬(`false` 로만 끈다). terminal scrollback 과 같은
  //   `advanced` 칸이라 같은 [적용]으로 함께 보낸다(따로 보내면 서로를 덮는다).
  const [engineBridge, setEngineBridge] = useState(true);
  // §5.3 #12-4 (J) — 검증 실행 전 차단(권한 탭). 기본 끔. 같은 [적용]으로 `permissions` 칸에 함께 보낸다.
  const [verificationGate, setVerificationGate] = useState(false);
  const [saving, setSaving] = useState(false);
  // §4 — 마지막 Apply 가 서버에 못 닿았는가(실패를 성공과 구분해 보인다).
  const [saveError, setSaveError] = useState(false);
  // §5.25 (C) — 프로젝트 설정 탭에서 고른 메인 제공자. 칸 안에 저장 버튼이 없어 **창이 들고 있다가**
  //   아래 [적용]으로 남긴다(탭을 옮겨도 남는다). `null` = 안 건드림 — 그동안은 저장값이 바깥
  //   (첫 실행 관문 등)에서 바뀌어도 화면이 그대로 따라간다.
  const [mainPending, setMainPending] = useState<AgentEngineKind | null>(null);
  const mainDirty = mainPending !== null && mainPending !== mainEngine;
  // §4 — Storage 탭은 자기 state 로 편집한다. 창의 나가기 가드가 그 미저장분까지 지키려면
  //   탭이 dirty 를 위로 올려 줘야 한다(탭을 떠나거나 창이 닫히면 언마운트 시 false 로 풀린다).
  const [providerDirty, setProviderDirty] = useState(false);
  const providerForm = useRef<ProviderDefaultsHandle>(null);
  const currentSettingsPath = useGraphStore(selectActivePluginProjectPath);
  const [activeSettingsPath, setActiveSettingsPath] = useState(currentSettingsPath);
  useEffect(() => { if (!providerDirty) setActiveSettingsPath(currentSettingsPath); }, [currentSettingsPath, providerDirty]);
  const [providerScope, setProviderScope] = useState<'global' | 'project'>('project');
  const [storageDirty, setStorageDirty] = useState(false);
  // §5.5 #17-9 ⑭(g) — Advanced 탭의 판정 설정도 같은 이유로 자기 dirty 를 위로 올린다.
  const [bgProbeDirty, setBgProbeDirty] = useState(false);
  const [processGuardDirty, setProcessGuardDirty] = useState(false);
  const [sessionProbeDirty, setSessionProbeDirty] = useState(false);
  const [tokenSaverDirty, setTokenSaverDirty] = useState(false);
  // §2.1 (B) — 외부 폴더 예산도 같은 문법(머신 단위 설정 · 자기 REST · 미저장만 창에 올림).
  const [externalBudgetDirty, setExternalBudgetDirty] = useState(false);
  // §5.23 접어 보기 — 에이전트마다 웹 버블 하나로 접기도 같은 문법(머신 단위 설정 · 자기 REST).
  const [webFoldDirty, setWebFoldDirty] = useState(false);
  // §4 — 저장 없이 나가려 할 때 뜨는 우리 디자인 확인 팝업(종전 `window.confirm` 대체).
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  // §4 — Version 탭 상태(dirty 흐름과 독립 — 선택은 즉시 저장).
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

  // §4 (앱 전용 엔진) — [지금 업데이트] · 켤 때 자동이 끝나면 "앱 전용" 칸(지금 판 · 앞 판 · 실패 사유)을 다시 읽는다.
  //   판은 서버가 폴더를 훑어 정하므로, 화면은 끝났다는 신호에 맞춰 다시 받기만 한다.
  const claudeInstallStatus = useGraphStore((s) => s.claudeInstallProgress?.status);
  useEffect(() => {
    if (category !== 'version') return;
    if (claudeInstallStatus === 'done' || claudeInstallStatus === 'error') void loadInstalls(false);
  }, [category, claudeInstallStatus, loadInstalls]);

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
    setAgentCanCompact(baseAgent.agentCanCompact === true);
    setExcludeDynamicSections(baseAgent.excludeDynamicSystemPromptSections === true);
    setSettingSources([...(baseAgent.settingSources ?? [])]);
    setSafeMode(baseAgent.safeMode === true);
    setFastMode(baseAgent.fastMode === true);
    setThinking(isThinkingEnabled(baseAgent.thinking));
    setBetas((baseAgent.betas ?? []).join(', '));
    setBashDefaultTimeoutSec(bashMsToSec(baseAgent.bashDefaultTimeoutMs));
    setBashMaxTimeoutSec(bashMsToSec(baseAgent.bashMaxTimeoutMs));
    setTerminalScrollback(clampTerminalScrollback(userDefaults?.advanced?.terminalScrollbackLines));
    setCmdBlockedNotify(userDefaults?.notifications?.cmdBlocked !== false);
    setEngineBridge(userDefaults?.advanced?.engineBridge !== false);
    setVerificationGate(isVerificationGateEnabled(userDefaults));
  }, [baseAgent, dirty, userDefaults, modelRegistry]);

  // §4 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('options-window', open);
    return () => setCanvasCover('options-window', false);
  }, [open]);

  /** §4 — 닫는 모든 경로(X·Cancel·Esc·배경 클릭)의 단일 출입구 — 하나라도 `onClose` 를 직접 부르면 그 길로 미저장분이 사라진다. */
  const requestClose = useCallback(() => {
    if (dirty || mainDirty || providerDirty || storageDirty || bgProbeDirty || sessionProbeDirty || processGuardDirty || externalBudgetDirty || webFoldDirty || tokenSaverDirty) { setConfirmDiscardOpen(true); return; }
    onClose();
  }, [dirty, mainDirty, providerDirty, storageDirty, bgProbeDirty, sessionProbeDirty, processGuardDirty, externalBudgetDirty, webFoldDirty, tokenSaverDirty, onClose]);

  const handleKeepEditing = useCallback(() => setConfirmDiscardOpen(false), []);

  /** 확인 팝업의 "버리고 닫기" — 폼을 저장값으로 되돌린 뒤 닫는다. */
  const handleDiscardAndClose = useCallback(() => {
    setConfirmDiscardOpen(false);
    // dirty 를 내리면 재시드 effect 가 폼을 `userDefaults` 기준으로 되돌린다(버린 편집이 남지 않게).
    // Storage 탭은 언마운트되며 서버 값으로 다시 로드하므로 별도 되돌리기가 필요 없다.
    setDirty(false);
    setMainPending(null);
    onClose();
  }, [onClose]);

  // 창이 닫히면 확인 팝업도 함께 접는다(다음에 열 때 뜬 채로 시작하지 않게).
  //   고른 메인 제공자도 함께 버린다 — `open` 만 내려 닫는 자리에서는 컴포넌트가 남아 다음에 열 때 옛 선택이 보인다.
  useEffect(() => { if (!open) { setConfirmDiscardOpen(false); setMainPending(null); } }, [open]);

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
  // §4 (xhigh effort 등급) — Effort 칸은 클로드 네 패밀리에 열린다(설정창과 같은 판정 함수).
  const effortEnabled = supportsEffortSelection(model);
  // §4 (CLI 사양 추종) — 고른 값이 실제로 접히는 토큰 수(고른 숫자는 CLI 에게 창 크기라 더 낮은 자리에서 접힌다). 전역 기본값 창이라 위층 없음.
  // `'auto'` 는 모델 창을 런타임에야 알아 null. 비율은 shared 상수 한 곳(12개 로케일이 안 틀어지게).
  const compactFoldsAtPercent = Math.round(TURN_COMPACT_TRIGGER_RATIO * 100);
  const compactFoldsAtTokens = useMemo(
    () => turnCompactTriggerTokens(resolveAutoCompact(autoCompact, undefined)),
    [autoCompact],
  );
  // §4 — 지금 켜져 있는가. **꺼짐도 `turnCompactTriggerTokens` 는 null 을 주므로**(선이 없다)
  //   아래 표시에서 `'auto'`(창을 아직 모름)와 뒤섞이지 않도록 이 술어로 먼저 가른다.
  const autoCompactOn = isAutoCompactOn(resolveAutoCompact(autoCompact, undefined));
  /** 선택지 값 → 사람이 읽는 이름. 빈 선택지도 풀린 값을 이 이름으로 적는다. */
  const autoCompactValueLabel = (v: string): string => (
    v === AUTOCOMPACT_OFF ? t('panel.agentConfig.autoCompact.offLabel') : v === 'auto' ? 'auto' : `${Number(v) / 1000}k`
  );
  // §5.25 (G-2) — Bash 칸의 0 은 "환경변수를 안 싣는다"이고, 그때 도는 값은 CLI 의 것이다. 안내 줄은 그 실제 초를 적는다.
  const bashEffectiveDefaultSec = bashDefaultTimeoutSec > 0 ? bashDefaultTimeoutSec : BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT / 1000;
  const bashEffectiveMaxSec = bashMaxTimeoutSec > 0 ? bashMaxTimeoutSec : BASH_MAX_TIMEOUT_MS_CLI_DEFAULT / 1000;
  // §4 (CLI 사양 추종) — 압축을 켜는 방향에만 확인을 띄운다(끄기·켜진 값끼리 이동은 통과 — 매번이면 소음). "봤음"은 기억하지 않는다.
  const [compactConfirm, setCompactConfirm] = useState<{ kind: AutoCompactConfirmKind; value: string } | null>(null);

  const requestAutoCompact = (next: string): void => {
    if (!autoCompactOn && isAutoCompactOn(resolveAutoCompact(next, undefined))) {
      setCompactConfirm({ kind: 'window', value: next });
      return;
    }
    setDirty(true);
    setAutoCompact(next);
  };

  const requestAgentCanCompact = (next: boolean): void => {
    // 에이전트 자율 요청도 `/compact` 를 부르는 유료 축이라 같은 확인을 거친다(끄기는 즉시).
    if (next && !agentCanCompact) {
      setCompactConfirm({ kind: 'agentSelf', value: '' });
      return;
    }
    setDirty(true);
    setAgentCanCompact(next);
  };

  const confirmCompact = (): void => {
    if (!compactConfirm) return;
    setDirty(true);
    if (compactConfirm.kind === 'agentSelf') setAgentCanCompact(true);
    else setAutoCompact(compactConfirm.value);
    setCompactConfirm(null);
  };
  // §4 (Fast 모드) — `--model` 로 나가는 값과 같은 규칙으로 판정(서버 `wantsFastMode` 와 동일).
  const fastModeSupported = supportsFastMode(modelVersion?.trim() || model);
  const oneMillionEnabled = contextWindow !== '200k';

  // 버전 sub-드롭다운 옵션 — CLI scan 결과에서 패밀리 필터, semver 내림차순 top 2 + Latest + Custom
  const VERSION_OPTIONS = useMemo(() => {
    // §4 — 고른 패밀리(alias)의 레지스트리 entry 로 버전 목록을 만든다.
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
    // Effort 칸이 닫히는 모델로 갈 때만 되돌린다 — 네 패밀리 사이를 오가면 고른 값을 지킨다.
    if (!supportsEffortSelection(v)) setEffort('default');
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

  // Agent Defaults 폼 저장 — 서버에 PUT. 성공 여부만 돌려주고 표시는 [적용] 이 맡는다.
  const saveAgentDefaults = useCallback(async (): Promise<boolean> => {
    try {
      // §4 (설정 3층) — 미설정은 `null` 로 보낸다. `undefined` 는 `JSON.stringify` 가 버려 서버 부분 머지가 옛 값을 남긴다(다시 끌 수 없다). 서버는 `null` 키를 지운다.
      const patch: UserDefaultsPatch = {
        agentConfig: {
          model,
          modelVersion: modelVersion ?? null,
          permissionMode,
          permissionTimeoutPolicy: permissionTimeoutPolicy === 'deny' ? 'deny' : null,
          effort: (effortEnabled && effort !== 'default') ? effort : null,
          maxTurns: maxTurns > 0 ? maxTurns : null,
          maxBudgetUsd: maxBudgetUsd > 0 ? maxBudgetUsd : null,
          isolation: isolation !== 'none' ? isolation : null,
          contextWindow: isOpus && contextWindow === '200k' ? '200k' : null,
          tools,
          disallowedTools: disallowedTools.length > 0 ? disallowedTools : null,
          rules: rules.trim() || null,
          color: color || null,
          skills: [...(claudeDefaults?.skills ?? DEFAULT_AGENT_CONFIG.skills)],
          fallbackModel: fallbackModel.trim() || null,
          autoCompact: autoCompact.trim() || null,
          agentCanCompact: agentCanCompact ? true : null,
          excludeDynamicSystemPromptSections: excludeDynamicSections ? true : null,
          settingSources: settingSources.length > 0 ? settingSources : null,
          safeMode: safeMode ? true : null,
          // §4 (Fast 모드) — 지원 모델일 때만 저장(모델을 바꿔 두고 나중에 되돌렸을 때의 부활 방지).
          fastMode: fastMode && fastModeSupported ? true : null,
          // §4 (Thinking on/off) — 켬이 기본이라 **끌 때만** 값을 남긴다. `null` = 그 칸을 비운다(= 켬).
          thinking: thinking ? null : false,
          betas: betas.split(',').map((b) => b.trim()).filter(Boolean).length > 0 ? betas.split(',').map((b) => b.trim()).filter(Boolean) : null,
          // §4 (CLI 사양 추종) — 초 → ms. 0/범위 밖은 미설정(스폰 env 키 자체가 안 붙는다).
          bashDefaultTimeoutMs: bashSecToMs(bashDefaultTimeoutSec) ?? null,
          bashMaxTimeoutMs: bashSecToMs(bashMaxTimeoutSec) ?? null,
        },
        // §4 (CMD ③④) — 이 창이 **모르는 키는 스프레드로 그대로 통과**시킨다(부분 페이로드가
        //   남의 설정을 지우는 사고를 막는 규약 — agent-config PUT 과 같은 이유).
        advanced: { ...(userDefaults?.advanced ?? {}), terminalScrollbackLines: clampTerminalScrollback(terminalScrollback), engineBridge },
        notifications: { ...(userDefaults?.notifications ?? {}), cmdBlocked: cmdBlockedNotify },
        // §5.3 #12-4 (J) — 검증 실행 전 차단. 위 두 칸과 같은 규약(모르는 키는 스프레드로 통과, 값은 켬/끔 그대로).
        permissions: { ...(userDefaults?.permissions ?? {}), verificationGate },
      };
      const claudeConfig = { ...claudeDefaults } as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch.agentConfig ?? {})) {
        if (value === null) delete claudeConfig[key]; else claudeConfig[key] = value;
      }
      patch.engineConfigs = { claude: claudeConfig };
      delete patch.agentConfig;
      const res = await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // §4 — 서버가 거절하면 dirty 를 내리지 않는다(실패가 성공처럼 보이고 닫아도 경고가 없게 된다).
      if (!res.ok) return false;
      const body = await res.json() as { ok?: boolean; userDefaults?: UserDefaults };
      if (body.ok !== true) return false;
      // 저장된 값을 그 자리에서 반영 — 늦게 풀리는 옛 스냅샷은 store 의 `updatedAt` 가드가 막는다.
      if (body.userDefaults) applyUserDefaults(body.userDefaults);
      setDirty(false);
      return true;
    } catch { return false; }
  }, [applyUserDefaults, model, modelVersion, permissionMode, permissionTimeoutPolicy, isOpus, effortEnabled, effort, maxTurns, maxBudgetUsd, isolation, contextWindow, tools, disallowedTools, rules, color, userDefaults, fallbackModel, autoCompact, agentCanCompact, excludeDynamicSections, settingSources, safeMode, fastMode, fastModeSupported, thinking, betas, bashDefaultTimeoutSec, bashMaxTimeoutSec, terminalScrollback, cmdBlockedNotify, engineBridge, verificationGate, claudeDefaults]);

  // Apply — 고쳐 둔 것만 저장한다. §5.25 (C) 메인 제공자도 칸 안이 아니라 여기서 남긴다.
  //   폼을 먼저, 제공자를 나중에 — 폼은 **지금** 제공자일 때의 값(`claudeDefaults`)을 바탕으로 짓는다.
  //   어느 쪽이든 실패하면 그 몫의 미저장 표시를 내리지 않아 창 닫기가 미저장 확인을 거친다.
  const handleApply = useCallback(async () => {
    setSaving(true);
    try {
      if (providerDirty && (!providerForm.current || !(await providerForm.current.save()))) { setSaveError(true); return; }
      if (dirty && !(await saveAgentDefaults())) { setSaveError(true); return; }
      if (mainDirty && mainPending !== null) {
        try { await chooseEngine(mainPending); } catch { setSaveError(true); return; }
        setMainPending(null);
      }
      setSaveError(false);
    } finally { setSaving(false); }
  }, [dirty, providerDirty, saveAgentDefaults, mainDirty, mainPending, chooseEngine]);

  if (!open) return null;

  const categories: { key: CategoryKey; label: string; icon: React.JSX.Element }[] = [
    // §5.25 (C) — 프로젝트 설정. 메인 제공자 칸 하나만 둔다.
    { key: 'project', label: t('providers.project'), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
    ) },
    // §4 — Account(로그인 계정 확인·로그아웃).
    { key: 'account', label: t('panel.options.categories.account', { defaultValue: 'Account' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    ) },
    // §4 API 크레딧 — 종류(개인·비즈니스·클라우드)마다 페이지를 나눈다.
    { key: 'credits', label: t('panel.options.categories.credits'), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
    ) },
    { key: 'agent', label: t('panel.options.categories.agent', { defaultValue: 'Agent Defaults' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    ) },
    { key: 'appearance', label: t('panel.options.categories.appearance', { defaultValue: 'Appearance' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
    ) },
    // §4 앱 테마 — 앱 전체의 색. 고르면 바로 칠하고 저장한다(언어와 같은 즉시 축 — 아래 [적용]과 무관).
    { key: 'theme', label: t('panel.options.categories.theme', { defaultValue: 'Theme' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>
    ) },
    /* §5.10 — 자동 목표 스위치를 이 창에 두지 마라(IDE `목표` 뷰에서 켜고 끈다) — 켜는 자리가 둘이면 왜 안 도는지 못 찾는다(#17-44 ⑧(d)). */
    // §6 — 단축키. 목록은 `COMMANDS` 표에서 나오므로 손으로 적을 것이 없다.
    { key: 'keyboard', label: t('panel.options.categories.keyboard', { defaultValue: 'Keyboard' }), icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>
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
            {(dirty || mainDirty || providerDirty) && <span className="text-xs font-normal text-amber-400">• {t('panel.options.unsaved', { defaultValue: 'unsaved' })}</span>}
          </h3>
          <button type="button" onClick={requestClose} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-9 pointer-coarse:w-9">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body — 좌측 사이드바 + 우측 패널. 폰에선 사이드바가 본문 위 가로 띠가 된다(`windowNav`). */}
        <div className={WINDOW_NAV_BODY}>
          {/* Sidebar */}
          <div className={WINDOW_NAV_LIST}>
            {categories.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={providerDirty && category !== c.key}
                onClick={() => setCategory(c.key)}
                className={windowNavItemClass(category === c.key)}
              >
                <span className="text-gray-500">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          {/* Right pane */}
          <div className={WINDOW_NAV_PANE}>
            {category === 'agent' && <ProviderTabs value={settingsEngine} onChange={setSettingsEngine} disabled={dirty || providerDirty} />}
            {category === 'agent' && settingsEngine !== 'claude' && <>
              <label className="flex flex-col gap-1 text-xs text-gray-300">{t('providers.settingsScope')}
                <select className="rounded border border-gray-700 bg-gray-950 p-2" value={activeSettingsPath ? providerScope : 'global'} disabled={providerDirty || saving} onChange={e => setProviderScope(e.target.value as 'global' | 'project')}>
                  <option value="global">{t('providers.globalScope')}</option>
                  {activeSettingsPath && <option value="project">{t('providers.projectScope')}</option>}
                </select>
                {activeSettingsPath && providerScope === 'project' && <span className="break-all text-[12px] text-gray-500">{activeSettingsPath}</span>}
              </label>
              <ProviderDefaults ref={providerForm} key={`${settingsEngine}:${providerScope}:${activeSettingsPath ?? ''}`} engine={settingsEngine} projectPath={providerScope === 'project' ? activeSettingsPath ?? undefined : undefined} onDirtyChange={setProviderDirty} />
            </>}
            {/* §5.25 (C) — 엔진별 기본값은 Agent Defaults 탭에서 고친다. */}
            {category === 'project' && <MainProviderSelect value={mainPending ?? mainEngine} onChange={(engine) => setMainPending(engine === mainEngine ? null : engine)} disabled={saving} />}
            {category === 'agent' && settingsEngine === 'claude' && (
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
                  {/* Version sub — 폰 폭에서는 버전 목록(고정폭 글꼴의 긴 id)과 직접 입력칸이 줄을 바꿔 선다. */}
                  <div className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-500 max-md:flex-wrap">
                    <span className="uppercase tracking-wider">{t('panel.options.version.versionLabel')}</span>
                    <select
                      value={effectiveVersionValue}
                      onChange={(e) => handleVersionChange(e.target.value)}
                      className="max-w-full cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 font-mono text-[12px] text-gray-300 outline-none hover:border-gray-600 focus:border-blue-500 pointer-coarse:py-1.5"
                    >
                      {VERSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {isCustomVersion && (
                      <input
                        type="text"
                        value={modelVersion ?? ''}
                        onChange={(e) => { setDirty(true); setModelVersion(e.target.value); }}
                        placeholder={`claude-${model}-X-Y`}
                        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-1.5 py-0 font-mono text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none max-md:basis-full pointer-coarse:py-1.5"
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
                        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[12px] text-gray-200 outline-none focus:border-blue-500 pointer-coarse:py-1.5"
                      >
                        <option value="allow">allow</option>
                        <option value="deny">deny</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Effort — 클로드 네 패밀리(Opus·Fable·Sonnet·Haiku) */}
                {effortEnabled && (
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

                {/* Max Turns + Budget + Isolation — 폰 폭에서는 세 칸을 위아래로 쌓는다(한 칸 100px 이 안 돼 라벨이 세 줄로 꺾였다). */}
                <div className="flex gap-3 max-md:flex-col">
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
                  {/* 폰 폭에서는 두 칸을 쌓는다 — 선택지 글이 길어 나란히 두면 상자 밖으로 넘쳤다. */}
                  <div className="flex gap-3 max-md:flex-col">
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
                    {/* §4 (CLI 사양 추종) — 자동 압축 전역 기본값(미설정 버블 전부가 따른다). 여기도 비면 `DEFAULT_AUTOCOMPACT` — 빈 선택지가 `resolveAutoCompact` 로 실제 값을 말한다(§5.25 G-2). */}
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.autoCompact.label')}</label>
                      <select
                        value={autoCompact}
                        onChange={(e) => requestAutoCompact(e.target.value)}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none hover:border-gray-600 focus:border-blue-500"
                      >
                        {AVAILABLE_AUTOCOMPACT_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v === ''
                              ? t('panel.agentConfig.effective.resolved', {
                                value: autoCompactValueLabel(resolveAutoCompact()),
                                source: t('panel.agentConfig.effective.sourceBuiltin'),
                              })
                              : autoCompactValueLabel(v)}
                          </option>
                        ))}
                      </select>
                      {/* §4 (CLI 사양 추종) — 이 숫자 하나가 전부다(별도 체크박스 ❌). 접는 자리는 늘 턴 경계이고, 실제로 접히는 토큰 수를 말한다 — 고른 값과 달라 숨기면 안 된다. */}
                      <span className={`text-[12px] leading-snug ${autoCompactOn ? 'text-gray-400' : 'text-gray-500'}`}>
                        {!autoCompactOn
                          ? t('panel.agentConfig.autoCompact.foldsAtOff')
                          : compactFoldsAtTokens === null
                            ? t('panel.agentConfig.autoCompact.foldsAtAuto', { percent: compactFoldsAtPercent })
                            : t('panel.agentConfig.autoCompact.foldsAt', { tokens: `${Math.round(compactFoldsAtTokens / 1000)}k` })}
                      </span>
                      {/* §9 — 설명문도 가독 하한 12px. 위계는 크기가 아니라 색으로 낮춘다. */}
                      <span className="text-[12px] leading-snug text-gray-600">{t('panel.agentConfig.autoCompact.globalTipEffective', { value: autoCompactValueLabel(resolveAutoCompact()) })}</span>
                      {/* §4 (CLI 사양 추종) — 이 축만 직교로 남는다: 숫자로 못 잡는 자리를 에이전트가 부른다. */}
                      <label className="mt-1 flex items-start gap-2 text-[12px] text-gray-400 pointer-coarse:py-1.5">
                        <input
                          type="checkbox"
                          checked={agentCanCompact}
                          onChange={(e) => requestAgentCanCompact(e.target.checked)}
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
                            className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors pointer-coarse:py-1.5 ${
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
                  <label className="flex items-start gap-2 text-[12px] text-gray-400 pointer-coarse:py-1.5">
                    <input
                      type="checkbox"
                      checked={excludeDynamicSections}
                      onChange={(e) => { setDirty(true); setExcludeDynamicSections(e.target.checked); }}
                      className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                    />
                    <span>{t('panel.agentConfig.excludeDynamicSections.label')}</span>
                  </label>
                  <label className="flex items-start gap-2 text-[12px] text-gray-400 pointer-coarse:py-1.5">
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
                  <label className={`flex items-start gap-2 text-[12px] pointer-coarse:py-1.5 ${fastModeSupported ? 'text-gray-400' : 'text-gray-600'}`}>
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
                  {/* §4 (Thinking on/off) — 확장 사고를 켜고 끈다(Effort 는 깊이라 직교 축).
                      기본이 켬이라 끄면 스폰 설정 파일에 `alwaysThinkingEnabled: false` 가 실린다. */}
                  <label className="flex items-start gap-2 text-[12px] text-gray-400 pointer-coarse:py-1.5">
                    <input
                      type="checkbox"
                      checked={thinking}
                      onChange={(e) => { setDirty(true); setThinking(e.target.checked); }}
                      className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                    />
                    <span>
                      {t('panel.agentConfig.thinking.label')}
                      <span className="ml-1 text-gray-600">
                        {thinking ? t('panel.agentConfig.thinking.hint') : t('panel.agentConfig.thinking.offHint')}
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
                  {/* §4 (CLI 사양 추종) — Bash 시간 제한(초). 0 = 미설정(CLI 가 정한 초가 돈다 — 라벨·안내가 그 초를 적는다). */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-medium text-gray-500">{t('panel.agentConfig.bashTimeout.label')}</span>
                    <div className="flex gap-3">
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.defaultLabelSec', { sec: BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT / 1000 })}</label>
                        <NumberStepper
                          min={0}
                          max={BASH_TIMEOUT_MS_MAX / 1000}
                          step={BASH_TIMEOUT_STEP_SEC}
                          value={bashDefaultTimeoutSec}
                          widthClassName="w-full"
                          ariaLabel={t('panel.agentConfig.bashTimeout.defaultLabelSec', { sec: BASH_DEFAULT_TIMEOUT_MS_CLI_DEFAULT / 1000 })}
                          onChange={(next) => { setDirty(true); setBashDefaultTimeoutSec(next); }}
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-[12px] text-gray-500">{t('panel.agentConfig.bashTimeout.maxLabelSec', { sec: BASH_MAX_TIMEOUT_MS_CLI_DEFAULT / 1000 })}</label>
                        <NumberStepper
                          min={0}
                          max={BASH_TIMEOUT_MS_MAX / 1000}
                          step={BASH_TIMEOUT_STEP_SEC}
                          value={bashMaxTimeoutSec}
                          widthClassName="w-full"
                          ariaLabel={t('panel.agentConfig.bashTimeout.maxLabelSec', { sec: BASH_MAX_TIMEOUT_MS_CLI_DEFAULT / 1000 })}
                          onChange={(next) => { setDirty(true); setBashMaxTimeoutSec(next); }}
                        />
                      </div>
                    </div>
                    <span className="text-[12px] text-gray-600">
                      {t('panel.agentConfig.bashTimeout.hintEffective', {
                        defaultSec: bashEffectiveDefaultSec,
                        maxSec: bashEffectiveMaxSec,
                      })}
                    </span>
                  </div>
                </div>

                {/* Tools allow-list */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.tools', { defaultValue: 'Tools (allow-list)' })}</label>
                  {/* 도구 45종을 다 펼치면 이 두 칸(허용·금지)만으로 탭 하나가 채워진다 — 네 줄쯤에서
                      멈추고 안에서 스크롤한다. 고르는 판이라 목록 자체는 그대로 다 들어 있다. */}
                  <ScrollFade maxHeight={124} className="rounded border border-gray-700/60 bg-gray-900/40">
                  <div className="flex flex-wrap gap-1.5 p-2">
                    {AVAILABLE_AGENT_TOOLS.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        className={`rounded px-2 py-0.5 text-[12px] pointer-coarse:py-1.5 ${
                          tools.includes(tool)
                            ? 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                  </ScrollFade>
                </div>

                {/* Disallowed tools (deny-list) */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">{t('panel.options.agent.disallowedTools', { defaultValue: 'Disallowed Tools (deny-list)' })}</label>
                  <ScrollFade maxHeight={124} className="rounded border border-gray-700/60 bg-gray-900/40">
                  <div className="flex flex-wrap gap-1.5 p-2">
                    {AVAILABLE_AGENT_TOOLS.map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleDisallowed(tool)}
                        className={`rounded px-2 py-0.5 text-[12px] pointer-coarse:py-1.5 ${
                          disallowedTools.includes(tool)
                            ? 'bg-red-500/20 text-red-200 ring-1 ring-red-500/40'
                            : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                        }`}
                      >
                        {tool}
                      </button>
                    ))}
                  </div>
                  </ScrollFade>
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

            {/* §4 — Appearance: 언어 선택(즉시 적용). */}
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

            {category === 'theme' && <ThemeTab />}

            {category === 'account' && <AccountTab />}
            {category === 'credits' && (
              <div className="flex flex-col gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.categories.credits')}</h4>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{t('panel.options.creditsIntro')}</p>
                </div>
                <CreditPages variant="options" />
              </div>
            )}

            {category === 'keyboard' && <KeyboardTab />}
            {category === 'storage' && <StorageTab onDirtyChange={setStorageDirty} />}


            {/* §4 — 버전 칸. 엔진 탭은 보기만 바꾸고(§5.25 (C)), 실행본 버전 자리라 탭 이름은 제품 이름이다. */}
            {category === 'version' && (
              <>
                <ProviderTabs
                  engines={VERSION_TAB_ENGINES}
                  labelOf={(engine) => t(`panel.engineChooser.${engine}.name`)}
                  value={versionEngine}
                  onChange={setVersionEngine}
                />
                {versionEngine === 'codex'
                  ? <CodexVersionTab about={installs} />
                  : (
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
              </>
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

                {/* §5.3 #9-1 — 토큰 절약(J~P). 아래 손잡이들과 같은 문법(머신 단위 설정 · 자기 REST ·
                    미저장만 창에 올림)이고, **효과가 가장 큰 축이라 맨 위**에 둔다. */}
                <TokenSaverSection onDirtyChange={setTokenSaverDirty} />

                {/* §5.5 #17-9 ⑭(g) — 조용한 백그라운드 작업의 자동 판정. 머신 단위 설정이라
                    Storage 탭과 같은 문법으로 자기 REST 를 직접 읽고 쓰고, 미저장만 창에 올린다. */}
                <BgTaskProbeSection onDirtyChange={setBgProbeDirty} />

                {/* §2.4 — "실행중…" 으로 굳은 세션의 자동 판정. 바로 위와 같은 문법(머신 단위
                    설정 · 자기 REST · 미저장만 창에 올림)이라 두 손잡이가 나란히 읽힌다. */}
                <SessionProbeSection onDirtyChange={setSessionProbeDirty} />

                {/* §5.3 #9-2 — 에이전트가 띄운 프로세스의 보호(묶음 · 메모리 상한 · 정리). 위 두 판정과 같은 문법(머신
                    단위 설정 · 자기 REST · 미저장만 창에 올림)이고, 셋 다 "백그라운드에서 우리가 대신 끊는 것"의 손잡이다. */}
                <ProcessGuardSection onDirtyChange={setProcessGuardDirty} />

                {/* §4 엔진 다리 — 엔진이 턴·생존을 직접 알려 주면 바로 위 판정이 덜 묻는다. 두 손잡이가 같은
                    질문("정말 도는가")의 두 답이라 나란히 둔다. 값은 이 창의 [적용]과 함께 저장된다. */}
                <EngineBridgeSection
                  enabled={engineBridge}
                  onChange={(on) => { setDirty(true); setEngineBridge(on); }}
                />

                {/* §2.1 (B) — 프로젝트 밖 폴더가 캔버스에 몇 개까지 펼쳐지는가.
                    위 둘과 같은 문법이라 세 손잡이가 나란히 읽힌다. */}
                <ExternalFolderSection onDirtyChange={setExternalBudgetDirty} />

                {/* §5.23 접어 보기 — 에이전트마다 웹 버블 하나로 접는 보기 옵션(기본 꺼짐).
                    바로 위와 같은 "캔버스에 무엇이 몇 개 서는가"의 손잡이라 그 옆에 둔다. */}
                <WebFoldSection onDirtyChange={setWebFoldDirty} />
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

            {/* §5.3 #12-4 (J) — Permissions: 검증 실행 전 차단 스위치(기본 끔). 값은 이 창의 [적용]과 함께 저장된다. */}
            {category === 'permissions' && (
              <div className="flex flex-col gap-4">
                <VerificationGateSection
                  enabled={verificationGate}
                  onChange={(on) => { setDirty(true); setVerificationGate(on); }}
                />
              </div>
            )}

            {category !== 'agent' && category !== 'version' && category !== 'appearance' && category !== 'theme' && category !== 'account' && category !== 'credits' && category !== 'keyboard' && category !== 'storage' && category !== 'advanced' && category !== 'notifications' && category !== 'permissions' && (
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
          {saveError && (
            <span className="mr-auto flex items-center gap-1.5 text-[12px] text-red-400">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>
              {t('panel.options.saveFailed', { defaultValue: 'Could not save — your changes are still here.' })}
            </span>
          )}
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
            disabled={!(dirty || mainDirty || providerDirty) || saving}
            className={`rounded px-3 py-1.5 text-xs font-medium ${
              (dirty || mainDirty || providerDirty) && !saving
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

      {/* §4 (CLI 사양 추종) — 압축을 켜기 전 비용 확인. 취소하면 값이 앉지 않아 꺼진 채로 남는다. */}
      {compactConfirm && (
        <AutoCompactConfirm
          kind={compactConfirm.kind}
          pendingLabel={compactConfirm.value === 'auto'
            ? 'auto'
            : compactConfirm.value ? `${Number(compactConfirm.value) / 1000}k` : ''}
          onCancel={() => setCompactConfirm(null)}
          onConfirm={confirmCompact}
        />
      )}
    </div>,
    document.body,
  );
}

// §4 — Version / About 탭

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
 * §4 — Claude Code CLI 자동 업데이트 토글. SSOT `UserDefaults.claudeAutoUpdate.enabled`(미설정 = 켬): 켜면 서버가 부팅 때 `isOutdated` 면 `installLatestClaude()`,
 * 끄면 [지금 업데이트]로만. ⚠ 앱 업데이트(electron-updater, 헤더 버튼)와 다른 축 — CLI 에만 걸린다.
 */
function ClaudeAutoUpdateSection({ source, outdated, onRefresh, managed, usesManaged }: {
  source: ClaudeInstall['source'] | undefined;
  outdated: boolean;
  onRefresh: () => void;
  /** §4 (앱 전용 엔진) — 앱 전용 사본의 상태(서버가 폴더를 훑어 만든 그대로). */
  managed?: ManagedEngineStatus;
  /** 갱신 대상이 앱 전용 사본인가(사용자가 자기 설치본을 골라 두지 않았다). */
  usesManaged: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const progress = useGraphStore((s) => s.claudeInstallProgress);
  const install = useGraphStore((s) => s.installClaudeVersion);
  const [saving, setSaving] = useState(false);

  const enabled = userDefaults?.claudeAutoUpdate?.enabled !== false;
  // 앱 전용 사본은 앱이 판을 바꾼다 — 아직 안 받았어도 [지금 업데이트]가 받는다.
  // 사용자가 고른 확장 번들은 마켓플레이스 밖에서 갱신할 수 없다 — 그 사실을 밝힌다.
  const canUpdate = usesManaged || (source !== 'vscode-extension' && source !== 'unknown');
  const managedOutdated = managed?.active && managed.latest ? semverLt(managed.active.version, managed.latest) : !managed?.active;
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
              {!enabled
                ? t('panel.options.version.claudeAutoUpdate.offHint', { updateNow: t('panel.options.version.claudeAutoUpdate.updateNow', { defaultValue: 'Update now' }), defaultValue: 'Automatic updates are off. Use "{{updateNow}}" to update the CLI yourself.' })
                : usesManaged
                  ? t('panel.options.version.managed.hint', { engine: 'Claude Code', defaultValue: 'Vibisual downloads new {{engine}} releases from the official source, checks that each one accepts every option Vibisual uses, then switches over — at launch and every 6 hours. Your login and settings stay shared.' })
                  : t('panel.options.version.claudeAutoUpdate.onHint', { defaultValue: 'Vibisual updates the CLI to the latest version each time you launch the app.' })}
            </span>
          </span>
        </label>

        {usesManaged && managed && <ManagedEngineInfo status={managed} engineName="Claude Code" onChanged={onRefresh} />}

        {source === 'vscode-extension' && !usesManaged && (
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
                : (usesManaged ? managedOutdated : outdated)
                  ? t('panel.options.version.updateAvailable', { defaultValue: 'Update available' })
                  : t('panel.options.version.upToDate', { defaultValue: 'Up to date' })}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * §4 (앱 전용 엔진) ⑨ — "앱 전용" 칸(Claude·코덱스 공용). 서버 `ManagedEngineStatus` 그대로 보인다.
 * 손잡이는 [이전 판으로] 하나 — 업데이트는 감싼 칸의 [지금 업데이트](두 번째 손잡이 ❌).
 */
function ManagedEngineInfo({ status, engineName, onChanged }: {
  status: ManagedEngineStatus;
  engineName: string;
  onChanged: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const rollback = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch(`${API_BASE}/api/managed-engines/${status.engine}/rollback`, { method: 'POST' });
      if (!r.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      onChanged();
    }
  }, [status.engine, onChanged]);

  const cell = (label: string, value: string, tone: 'idle' | 'ok' | 'warn' = 'idle'): React.JSX.Element => (
    <div className={`flex min-w-[7rem] flex-1 flex-col gap-0.5 rounded border px-2.5 py-1.5 ${
      tone === 'ok' ? 'border-emerald-500/40 bg-emerald-500/5' : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5' : 'border-gray-800 bg-gray-950/70'
    }`}>
      <span className="text-[12px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="truncate font-mono text-[13px] text-gray-200">{value}</span>
    </div>
  );

  const behind = status.active && status.latest ? semverLt(status.active.version, status.latest) : false;
  const checked = status.checkedAt
    ? t('panel.options.version.managed.checkedAt', { time: new Date(status.checkedAt).toLocaleString(i18n.language), defaultValue: 'Last checked {{time}}' })
    : t('panel.options.version.managed.notChecked', { defaultValue: 'Not checked yet' });

  return (
    <div className="flex flex-col gap-1.5 border-t border-gray-800 pt-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('panel.options.version.managed.title', { defaultValue: 'App-managed copy' })}
      </span>
      <div className="flex flex-wrap gap-2">
        {cell(
          t('panel.options.version.managed.inUse', { defaultValue: 'In use' }),
          status.active?.version ?? t('panel.options.version.managed.none', { defaultValue: 'Not downloaded yet' }),
          status.active ? (behind ? 'warn' : 'ok') : 'warn',
        )}
        {cell(t('panel.options.version.managed.latest', { defaultValue: 'Latest (official)' }), status.latest ?? '?')}
        {cell(t('panel.options.version.managed.previous', { defaultValue: 'Previous' }), status.previous?.version ?? '—')}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
        <span>{status.updating ? t('panel.options.version.managed.updating', { defaultValue: 'Downloading and checking…' }) : checked}</span>
        {!status.updating && status.nextRetryAt && (
          <span className="text-amber-300/90">
            {t('panel.options.version.managed.nextRetry', { time: new Date(status.nextRetryAt).toLocaleTimeString(i18n.language), defaultValue: 'Next retry {{time}}' })}
          </span>
        )}
        {status.previous && (
          <button
            type="button"
            onClick={() => { void rollback(); }}
            disabled={busy || status.updating}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-gray-300 hover:bg-gray-700 disabled:opacity-40 pointer-coarse:py-1.5"
          >
            {t('panel.options.version.managed.rollback', { version: status.previous.version, defaultValue: 'Roll back to {{version}}' })}
          </button>
        )}
        {failed && <span className="text-red-300">{t('panel.options.version.managed.rollbackFailed', { defaultValue: 'Could not roll back' })}</span>}
      </div>
      {status.deferred === 'not-in-use' && !status.active && (
        <div className="text-[12px] text-gray-500">
          {t('panel.options.version.managed.deferred', { engine: engineName, defaultValue: "Not downloaded — this PC doesn't use {{engine}} yet. It is downloaded when you install it." })}
        </div>
      )}
      {status.failedProbes && status.failedProbes.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
          {t('panel.options.version.managed.rejected', {
            version: status.latest ?? '?',
            options: status.failedProbes.join(', '),
            defaultValue: 'Not switched in — {{version}} rejected: {{options}}',
          })}
        </div>
      )}
      {status.lastError && !(status.failedProbes && status.failedProbes.length > 0) && (
        <div className="break-words rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[12px] text-red-300">{status.lastError}</div>
      )}
      <div className="flex min-w-0 items-baseline gap-1.5 text-[12px] text-gray-600">
        <span className="shrink-0">{t('panel.options.version.managed.folder', { defaultValue: 'Folder' })}</span>
        <span className="min-w-0 break-all font-mono">{status.root}</span>
      </div>
    </div>
  );
}

/**
 * §4 (앱 전용 엔진) — 코덱스 탭의 업데이트 칸. Claude 탭의 `ClaudeAutoUpdateSection` 과 같은 모양이다:
 * 스위치(`UserDefaults.codexAutoUpdate`, 미설정 = 켬) · [지금 업데이트](설치 창과 같은 `/api/codex-setup/install` —
 * 이미 쓸 수 있는 코덱스가 있으면 서버가 업데이트로 다룬다) · 진행 · 앱 전용 칸.
 */
function CodexAutoUpdateSection({ setup, userSelected }: {
  setup: CodexSetupState;
  /** 사용자가 다른 설치본을 보조로 골라 두었다 — 자동 업데이트는 그동안 앱 전용 사본을 받지 않는다(그 설치본은 그 주인의 것). */
  userSelected: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const progress = useGraphStore((s) => s.codexSetupProgress);
  const install = useGraphStore((s) => s.installCodexSetup);
  const refreshCodexSetup = useGraphStore((s) => s.refreshCodexSetup);
  const [saving, setSaving] = useState(false);

  const enabled = userDefaults?.codexAutoUpdate?.enabled !== false;
  const running = progress != null && (progress.status === 'starting' || progress.status === 'running');
  const managed = setup.managed;
  const behind = managed?.active && managed.latest ? semverLt(managed.active.version, managed.latest) : !managed?.active;

  const toggle = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codexAutoUpdate: { enabled: !enabled } } satisfies Partial<UserDefaults>),
      });
    } catch { /* WS user_defaults_updated 로 따라온다 */ }
    finally { setSaving(false); }
  }, [enabled]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('panel.options.version.codexAutoUpdate.title', { defaultValue: 'Codex updates' })}
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
              {t('panel.options.version.codexAutoUpdate.label', { defaultValue: 'Keep Codex up to date automatically' })}
            </span>
            <span className="text-[12px] text-gray-500">
              {enabled
                ? t('panel.options.version.managed.hint', { engine: 'Codex', defaultValue: 'Vibisual downloads new {{engine}} releases from the official source, checks that each one accepts every option Vibisual uses, then switches over — at launch and every 6 hours. Your login and settings stay shared.' })
                : t('panel.options.version.codexAutoUpdate.offHint', { updateNow: t('panel.options.version.claudeAutoUpdate.updateNow', { defaultValue: 'Update now' }), defaultValue: 'Automatic updates are off. Use "{{updateNow}}" to update Codex yourself.' })}
            </span>
          </span>
        </label>

        {userSelected && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
            {t('panel.options.version.codexUserSelected', {
              defaultValue: 'You picked another installation — its owner keeps it up to date. App-managed updates resume when you switch back to the default.',
            })}
          </div>
        )}

        {managed && <ManagedEngineInfo status={managed} engineName="Codex" onChanged={() => { void refreshCodexSetup(); }} />}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2 text-[12px]">
          <button
            type="button"
            onClick={() => { void install(); }}
            disabled={running || !setup.canAutoInstall}
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
                ? t('panel.options.version.claudeAutoUpdate.updated', { defaultValue: 'Updated to {{version}}', version: progress.version ?? '?' })
                : behind
                  ? t('panel.options.version.updateAvailable', { defaultValue: 'Update available' })
                  : t('panel.options.version.upToDate', { defaultValue: 'Up to date' })}
          </span>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ClaudeInstall['source'] }): React.JSX.Element {
  const { t } = useTranslation();
  // §4 (앱 전용 엔진) — 'managed' 는 앱이 받아 깔고 판을 맡는 사본이라 자동 선택 1순위다.
  // §4 (첫 실행 설치 온보딩) — 'native' 는 공식 인스톨러 위치다.
  const cls = source === 'managed'
    ? 'bg-indigo-500/20 text-indigo-300'
    : source === 'native'
      ? 'bg-emerald-500/20 text-emerald-300'
      : source === 'vscode-extension'
        ? 'bg-blue-500/20 text-blue-300'
        : source === 'unknown'
          ? 'bg-red-500/20 text-red-300'
          : 'bg-gray-700 text-gray-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider ${cls}`}>
      {source === 'managed' ? t('panel.options.version.sourceManaged', { defaultValue: 'App-managed' }) : source}
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
  const progress = useGraphStore((s) => s.claudeInstallProgress);
  const active = info?.installs.find((i) => i.active) ?? null;
  const isAuto = info != null && (info.overridePath == null || info.overridePath.length === 0);
  // §4 (앱 전용 엔진) ④⑨ — 기본은 앱 전용이다. 사용자가 다른 설치본을 골라 두지 않았으면(또는 앱 전용 판을 가리키면)
  //   갱신 대상도 최신 칸의 출처도 앱 전용(공식 배포처)이다. 앱 전용이 아직이면 지금 쓰는 것은 "임시"다.
  const usesManaged = isAuto || active?.source === 'managed';
  const managed = info?.managed;
  const onManaged = active?.source === 'managed';
  const pending = usesManaged && !onManaged;
  const temporary = pending && active != null;
  const latest = usesManaged ? (managed?.latest ?? null) : (info?.latest ?? null);
  const outdated = usesManaged
    ? (onManaged && managed?.active ? semverLt(managed.active.version, managed.latest) : false)
    : semverLt(active?.version ?? null, info?.latest ?? null);
  const installRunning = progress != null && (progress.status === 'starting' || progress.status === 'running');
  const lastProgressLine = progress?.stdout?.trim().split(/\r?\n/).filter(Boolean).pop();

  return (
    <div className="flex flex-col gap-4">
      <VersionHeader
        intro={t('panel.options.version.intro', { defaultValue: 'The Claude Code binary Vibisual uses to spawn agents, and where it comes from.' })}
        loading={loading}
        onRefresh={onRefresh}
      />

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
                <span className={`text-[12px] uppercase tracking-wider ${outdated ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {usesManaged
                    ? t('panel.options.version.managed.latest', { defaultValue: 'Latest (official)' })
                    : t('panel.options.version.latest', { defaultValue: 'Latest (npm)' })}
                </span>
                <span className={`font-mono text-base ${outdated ? 'text-amber-300' : 'text-emerald-300'}`}>{latest ?? '?'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-400">
              {active && <SourceBadge source={active.source} />}
              {onManaged && <DefaultChip />}
              {temporary && <TemporaryChip />}
              {!temporary && (outdated
                ? <span className="text-amber-300">{t('panel.options.version.updateAvailable', { defaultValue: 'Update available' })}</span>
                : active?.version && latest
                  ? <span className="text-emerald-300">{t('panel.options.version.upToDate', { defaultValue: 'Up to date' })}</span>
                  : null)}
              {!usesManaged && info.registryError && !info.latest && (
                <span className="text-gray-600">{t('panel.options.version.registryError', { defaultValue: 'npm check failed' })}: {info.registryError}</span>
              )}
            </div>
            {active && <div className="break-all font-mono text-[12px] text-gray-600">{active.binPath}</div>}
            {pending && (
              <ManagedPendingNotice managed={managed} running={installRunning} lastLine={lastProgressLine} engineName="Claude Code" />
            )}
          </div>

          {/* Section 2 — 어느 실행본을 쓰나: 기본 = Vibisual 전용, 나머지 = 보조(§4 앱 전용 엔진 ④⑨) */}
          <div className="flex flex-col gap-2">
            <EngineBinPicker
              managed={managed}
              isDefault={usesManaged}
              rows={info.installs}
              saving={savingBin}
              onSelect={onSelect}
              renderSource={(source) => <SourceBadge source={source as ClaudeInstall['source']} />}
            />
            {binChanged && (
              <div className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[12px] text-emerald-200">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                {/* §4 — 실행본 해석이 지연 캐시라 재시작 없이 새 에이전트에 적용된다. */}
                {t('panel.options.version.selectionApplied', { defaultValue: 'Selection saved and applied — newly spawned agents use it right away.' })}
              </div>
            )}
          </div>

          {/* Section 2-1 — Claude Code CLI 자동 업데이트 (§4). 앱 업데이트(헤더 버튼)와는 별개 축. */}
          <ClaudeAutoUpdateSection
            source={active?.source}
            outdated={outdated}
            onRefresh={onRefresh}
            managed={info.managed}
            usesManaged={usesManaged}
          />

          {/* Section 3 — About */}
          <AboutSection
            info={info}
            engineLink={{ href: MARKETPLACE_URL, label: t('panel.options.version.marketplace', { defaultValue: 'Claude Code on VS Code Marketplace' }) }}
          />
        </>
      )}
    </div>
  );
}

/** 버전 칸 머리줄 — 두 엔진 탭이 같은 제목·[다시 검색] 자리를 쓰고, 안내문과 다시 검색할 대상만 다르다. */
function VersionHeader({ intro, loading, onRefresh }: { intro: string; loading: boolean; onRefresh: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    // 좁으면 안내문이 줄을 바꾸고 [다시 검색]은 제 폭을 지킨다(안 지키면 한글 단추가 한 글자씩 꺾였다).
    <div className="flex items-center justify-between gap-2 border-b border-gray-700/50 pb-2">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-gray-200">{t('panel.options.version.title', { defaultValue: 'Version & About' })}</h4>
        <p className="mt-1 text-[12px] text-gray-500">{intro}</p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[12px] text-gray-300 hover:bg-gray-700 disabled:opacity-40 pointer-coarse:py-2"
      >
        <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        {t('panel.options.version.refresh', { defaultValue: 'Rescan' })}
      </button>
    </div>
  );
}

/**
 * About — 앱 자체의 버전·런타임이라 두 엔진 탭이 같은 것을 보인다. 끝의 링크 하나만 그 탭 엔진의 것이다
 * (Claude Code = VS Code Marketplace · Codex = 공식 설치 안내).
 */
function AboutSection({ info, engineLink }: { info: ClaudeInstallsInfo; engineLink: { href: string; label: string } | null }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.about', { defaultValue: 'About' })}</span>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 text-[12px]">
        <span className="text-gray-500">Vibisual</span>
        <span className="font-mono text-gray-300">{info.appVersion}</span>
        <span className="text-gray-500">Node</span>
        <span className="font-mono text-gray-300">{info.runtime.node}</span>
        {info.runtime.electron && (<><span className="text-gray-500">Electron</span><span className="font-mono text-gray-300">{info.runtime.electron}</span></>)}
        <span className="text-gray-500">{t('panel.options.version.platform')}</span>
        <span className="font-mono text-gray-300">{info.runtime.platform} · {info.runtime.arch}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-[12px]">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
          {t('panel.options.version.repo', { defaultValue: 'GitHub repository' })}
        </a>
        {engineLink && (
          <a href={engineLink.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">
            {engineLink.label}
          </a>
        )}
      </div>
    </div>
  );
}

/** Codex 설치 단계별 상태 칸의 색 — 클로드 탭 "Latest" 칸과 같은 문법(초록 = 됐다, 주황 = 손볼 것). */
const CODEX_STATUS_TONE = {
  ok: { box: 'border-emerald-500/40 bg-emerald-500/5', label: 'text-emerald-400', value: 'text-emerald-300' },
  warn: { box: 'border-amber-500/40 bg-amber-500/5', label: 'text-amber-400', value: 'text-amber-300' },
  idle: { box: 'border-gray-800 bg-gray-950/70', label: 'text-gray-500', value: 'text-gray-200' },
} as const;

/**
 * §4 · §5.25 (D) — Codex 탭: 클로드 탭과 같은 자리를 `codexSetup` 사실로 채운다(새로 모으지 않는다). `codexSetup.managed` 로 자동 업데이트 칸이 서고,
 * 설치본 고르기도 Claude 탭과 같다(기본 = 앱 전용, 다른 설치본은 보조 `UserDefaults.codexBinPath`). 탭에 들어올 때·[다시 검색] 때 다시 판정한다(앱 밖 설치·삭제).
 */
/** 코덱스 실행본 출처 배지 — Claude 의 `SourceBadge` 와 같은 꼴(앱 전용 = 인디고 · 공식 독립 설치 = 초록 · PATH = 회색). */
function CodexSourceBadge({ source }: { source: string }): React.JSX.Element {
  const { t } = useTranslation();
  const cls = source === 'managed'
    ? 'bg-indigo-500/20 text-indigo-300'
    : source === 'standalone'
      ? 'bg-emerald-500/20 text-emerald-300'
      : 'bg-gray-700 text-gray-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider ${cls}`}>
      {source === 'managed' ? t('panel.options.version.sourceManaged', { defaultValue: 'App-managed' }) : source}
    </span>
  );
}

function CodexVersionTab({ about }: { about: ClaudeInstallsInfo | null }): React.JSX.Element {
  const { t } = useTranslation();
  const setup = useGraphStore((s) => s.codexSetup);
  const refreshCodexSetup = useGraphStore((s) => s.refreshCodexSetup);
  const progress = useGraphStore((s) => s.codexSetupProgress);
  // 들어오자마자 판정이 돌므로 처음부터 "확인 중"이다.
  const [checking, setChecking] = useState(true);
  // §4 (앱 전용 엔진) ④ — 고르기 목록(기본 = 앱 전용 · 나머지 = 보조). Claude 탭과 같은 꼴이다.
  const [installs, setInstalls] = useState<CodexInstallsInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const loadInstalls = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/codex-installs`);
      const data = await r.json() as { ok: boolean; info?: CodexInstallsInfo };
      if (data.ok && data.info) setInstalls(data.info);
    } catch { /* 목록을 못 받아도 위 칸(설치 판정)은 그대로 보인다 */ }
  }, []);

  const rescan = useCallback(async () => {
    setChecking(true);
    try { await Promise.all([refreshCodexSetup(), loadInstalls()]); } finally { setChecking(false); }
  }, [refreshCodexSetup, loadInstalls]);

  useEffect(() => { void rescan(); }, [rescan]);

  // [지금 업데이트] · 켤 때 자동이 끝나면 목록(지금 판 · 쓰는 것)을 다시 읽는다 — Claude 탭과 같은 신호.
  const progressStatus = progress?.status;
  useEffect(() => {
    if (progressStatus === 'done' || progressStatus === 'error') void loadInstalls();
  }, [progressStatus, loadInstalls]);

  // 보조 선택 저장 — `codexBinPath` 를 글로벌 user-defaults 에 PUT. '' = 기본(앱 전용).
  const selectBin = useCallback(async (binPath: string | null) => {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codexBinPath: binPath ?? '' } satisfies Partial<UserDefaults>),
      });
      setChanged(true);
      await Promise.all([loadInstalls(), refreshCodexSetup()]);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [loadInstalls, refreshCodexSetup]);

  const activeRow = installs?.installs.find((i) => i.active) ?? null;
  const onManaged = activeRow?.source === 'managed';
  // 앱 전용 판을 가리키는 옛 선택은 서버가 "기본"과 같이 본다 — 화면도 그렇게 읽는다.
  const isDefault = !installs?.overridePath || onManaged;
  const managed = setup?.managed ?? installs?.managed;
  const pending = isDefault && !onManaged;
  const temporary = pending && !!setup?.binPath;
  const running = progress != null && (progress.status === 'starting' || progress.status === 'running');
  const lastProgressLine = progress?.output?.trim().split(/\r?\n/).filter(Boolean).pop();

  const phase = setup?.phase ?? 'unknown';
  const statusLabel = phase === 'ready'
    ? t('panel.options.engines.installed', { defaultValue: 'Installed' })
    : phase === 'missing'
      ? t('panel.options.engines.notInstalled', { defaultValue: 'Not installed' })
      : phase === 'installing'
        ? t('panel.codexSetup.installing', { defaultValue: 'Installing…' })
        : phase === 'failed'
          ? t('panel.codexSetup.installFailed', { defaultValue: 'Install failed' })
          : t('panel.codexSetup.rechecking', { defaultValue: 'Checking…' });
  const tone = CODEX_STATUS_TONE[phase === 'ready' ? 'ok' : phase === 'missing' || phase === 'failed' ? 'warn' : 'idle'];

  return (
    <div className="flex flex-col gap-4">
      <VersionHeader
        intro={t('panel.options.version.codexIntro', { defaultValue: 'The Codex CLI Vibisual uses to run Codex agents, and where it is installed.' })}
        loading={checking}
        onRefresh={() => { void rescan(); }}
      />

      {checking && !setup && (
        <div className="py-8 text-center text-xs text-gray-500">{t('panel.codexSetup.rechecking', { defaultValue: 'Checking…' })}</div>
      )}

      {setup && (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('panel.options.version.codex', { defaultValue: 'Codex (in use)' })}</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded border border-gray-800 bg-gray-950/70 px-3 py-2">
              <span className="text-[12px] uppercase tracking-wider text-gray-500">{t('panel.options.version.current', { defaultValue: 'Current' })}</span>
              <span className="font-mono text-base text-gray-200">{setup.version ?? '?'}</span>
            </div>
            <div className={`flex flex-col gap-1 rounded border px-3 py-2 ${tone.box}`}>
              <span className={`text-[12px] uppercase tracking-wider ${tone.label}`}>{t('panel.detailPanel.status', { defaultValue: 'Status' })}</span>
              <span className={`text-base ${tone.value}`}>{statusLabel}</span>
            </div>
          </div>
          {(activeRow || onManaged || temporary) && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-400">
              {activeRow && <CodexSourceBadge source={activeRow.source} />}
              {onManaged && <DefaultChip />}
              {temporary && <TemporaryChip />}
            </div>
          )}
          {setup.binPath && <div className="break-all font-mono text-[12px] text-gray-600">{setup.binPath}</div>}
          {phase === 'failed' && setup.error && (
            <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">{setup.error}</div>
          )}
          {pending && installs && (
            <ManagedPendingNotice managed={managed} running={running} lastLine={lastProgressLine} engineName="Codex" />
          )}
        </div>
      )}

      {/* §4 (앱 전용 엔진) ④⑨ — 어느 실행본을 쓰나: 기본 = Vibisual 전용, 나머지 = 보조. */}
      {installs && (
        <div className="flex flex-col gap-2">
          <EngineBinPicker
            managed={managed}
            isDefault={isDefault}
            rows={installs.installs}
            saving={saving}
            onSelect={(binPath) => { void selectBin(binPath); }}
            renderSource={(source) => <CodexSourceBadge source={source} />}
          />
          {changed && (
            <div className="flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[12px] text-emerald-200">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              {t('panel.options.version.selectionApplied', { defaultValue: 'Selection saved and applied — newly spawned agents use it right away.' })}
            </div>
          )}
        </div>
      )}

      {/* §4 (앱 전용 엔진) — 코덱스도 앱이 판을 맡는다: 자동 업데이트 스위치 · [지금 업데이트] · 앱 전용 칸. */}
      {setup && <CodexAutoUpdateSection setup={setup} userSelected={!isDefault} />}

      {about && (
        <AboutSection
          info={about}
          engineLink={setup?.docsUrl ? { href: setup.docsUrl, label: t('panel.codexSetup.docs', { defaultValue: 'Official installation guide' }) } : null}
        />
      )}
    </div>
  );
}
