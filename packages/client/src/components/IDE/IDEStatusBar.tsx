import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';
import {
  resolveAutoCompact, isAutoCompactOn, resolveAliasToLatest, getModelContextLimit,
  agentModelLabelOf, BUBBLE_COLORS, resolveCmdCliKind, resolveAgentDefaults,
  resolveSessionRunState, applyAutoCompactFloor, TURN_COMPACT_TRIGGER_RATIO,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { pickCompactFloorSource } from '../../utils/compactFloor.js';
import {
  sessionDotClass, SESSION_STATUS_LABEL_KEY, sessionRunStateOf,
  serializeBusySubIds, parseBusySubIds, serializePendingSubIds, buildSessionRunInputs,
} from '../../utils/sessionStatus.js';
import { followSessionKey } from './editorFollow.js';
import { buildDiffCommentPrompt } from './diffCommentPrompt.js';
import {
  resolveStatusBarUsage, resolveStatusBarModel, resolveStatusBarThinkingOff,
  resolveStatusBarEffort, canOpenModelQuickSwitch,
} from './statusBarContext.js';
import type { InsuranceSessionScope } from '../../utils/insuranceView.js';
import { ContextInsurancePopup } from '../Panel/ContextInsurancePopup.js';
// §4 (상태바 모델 칸 ②) — 모델 칸을 누르면 뜨는 카드는 새 창이 아니라 **설정창의 모델 구역**이다.
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import type { PopupAnchorRect } from '../Panel/modelSectionView.js';
import { useCodexEffectiveConfig } from '../Codex/useCodexEffectiveConfig.js';

interface IDEStatusBarProps {
  agent: BubbleData;
  activeSession: SubAgent | null;
  isCustom: boolean;
  sessionCount: number;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatModelName(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/** §4 (모델 칸 ②) — 설정창(`AgentConfigPopup`)의 모델 구역만 연 카드(규칙·저장 한 벌). `agentConfigs[id]` 는 카드가 떠 있을 때만 구독한다(늘 구독하면 줄 전체가 리렌더). */
function StatusBarModelSwitch({ agent, anchorRect, onClose }: {
  agent: BubbleData;
  anchorRect: PopupAnchorRect;
  onClose: () => void;
}): React.JSX.Element {
  const config = useGraphStore((s) => s.agentConfigs[agent.id]);
  return (
    <AgentConfigPopup
      agentId={agent.id}
      config={config ?? null}
      currentColor={BUBBLE_COLORS[agent.bubbleType]}
      onClose={onClose}
      section="model"
      anchorRect={anchorRect}
    />
  );
}

/**
 * §4 (CLI 사양 추종) — 상태바에 쓸 자동 압축 값 표기.
 * `'auto'` 는 CLI 가 창 크기를 정한다는 뜻이라 낱말 그대로 두고, 토큰 수는 `200k` 꼴로 줄인다.
 */
function formatAutoCompact(value: string, offLabel: string): string {
  // 꺼짐을 먼저 거른다 — `Number('off')` 는 NaN 이라 그대로 두면 상태바에 `NaNk` 가 뜬다.
  if (!isAutoCompactOn(value)) return offLabel;
  return value === 'auto' ? 'auto' : `${Number(value) / 1000}k`;
}

export const IDEStatusBar = memo(function IDEStatusBar({
  agent,
  activeSession,
  isCustom,
  sessionCount,
}: IDEStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const acknowledged = useGraphStore((s) => (activeSession ? !!s.acknowledgedSubAgents[activeSession.id] : false));
  // (판올림 번호 발급 대기) 눌러 들어간 색의 여운 — 이 바가 보는 세션 하나 것만 집어 온다.
  const focusGlow = useGraphStore((s) => (activeSession ? s.sessionFocusGlow[activeSession.id] : undefined));
  // 상태는 `sessionRunStateOf`/`resolveSessionRunState` 로 접어 다른 화면과 색·낱말을 공유한다(enum 원문·별도 색표 ❌).
  // §2.4 — 탭바·분할 칸과 같은 셋째 인자(백그라운드 작업)를 준다 — 빠지면 탭 도트는 켜지고 이 바만 꺼진다.
  const busySubIdsSerialized = useGraphStore((s) => serializeBusySubIds(s.runningSubagentTasks[agent.id]));
  const busySubIds = useMemo(() => parseBusySubIds(busySubIdsSerialized), [busySubIdsSerialized]);
  const hasBackgroundWork = activeSession ? busySubIds.has(activeSession.id) : busySubIds.size > 0;
  // §5.5 #17-18 — 줄 선 명령도 본다. 좀비 `executing` 이 자물쇠를 쥐면 덧말은 `queued` 인데 `sub.status` 는 `idle` 이라 "완료"로 적힌다.
  const pendingSubIdsSerialized = useGraphStore((s) => serializePendingSubIds(s.queuedCommands[agent.id]));
  const pendingSubIds = useMemo(() => parseBusySubIds(pendingSubIdsSerialized), [pendingSubIdsSerialized]);
  const hasQueuedCommand = activeSession ? pendingSubIds.has(activeSession.id) : pendingSubIds.size > 0;
  // 메인 탭도 입력창과 같은 버블·큐·작업 사실을 접는다(세션 미배정 명령 포함).
  const mainRunState = useGraphStore((s) => activeSession ? 'done' : resolveSessionRunState(buildSessionRunInputs({
    sub: null, agentStatus: agent.status, commands: s.queuedCommands[agent.id],
    runningTasks: s.runningSubagentTasks[agent.id], acknowledged: true,
  })));
  const runState = activeSession
    ? sessionRunStateOf(activeSession, acknowledged, hasBackgroundWork, hasQueuedCommand)
    : mainRunState;
  /* §2.4 — 상태바엔 경과 시계를 두지 않는다(되살리지 마라). 경과는 `ThinkingIndicator`, 무응답은 입력창(`IDEMainArea`)이 맡는다(⑥-6). 1초 타이머를 달면 창 수만큼 매초 리렌더. */
  // §5.5 — 모델·컨텍스트·토큰의 주어는 보고 있는 세션이다(`statusBarContext.ts`). `?? agent.X` 폴백 ❌ — 버블 합계로 떨어져 세션을 넘겨도 안 바뀐다.
  // 한 턴도 안 돈 세션의 모델만 설정 모델로 채운다. 별칭은 레지스트리가 아는 만큼만 최신 id 로 편다.
  const ownModel = useGraphStore((s) => s.agentConfigs[agent.id]?.model);
  const globalModel = useGraphStore((s) => s.userDefaults?.agentConfig?.model);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  /** §5.25 (J) — 엔진을 먼저 본다. `config.model` 은 클로드 칸(기본 `opus`)이라 코덱스·로컬도 `opus` 로 적힌다 — 프로바이더가 있으면 그쪽이 주어. */
  const providerKind = useGraphStore((s) => s.agentConfigs[agent.id]?.provider?.kind);
  const providerModelId = useGraphStore((s) => s.agentConfigs[agent.id]?.provider?.modelId);
  const providerModelName = useGraphStore((s) => s.agentConfigs[agent.id]?.provider?.modelName);
  const providerModel = providerKind
    ? agentModelLabelOf(
      { provider: { kind: providerKind, modelId: providerModelId ?? '', modelName: providerModelName } },
      {
        codex: t('ide.overlay.codexLabel', { defaultValue: 'Codex' }),
        local: t('ide.overlay.localLabel', { defaultValue: 'All Model' }),
      },
    ) ?? undefined
    : undefined;
  const cliKind = useGraphStore((s) => s.agentConfigs[agent.id]?.cliKind);
  // `cliKind` 는 **CMD 버블에서만** 읽힌다 — 헤드리스 스폰은 그 칸을 보지 않는다(CMD 채움 한 곳만 읽는다).
  //   CMD 로 한 번 돌렸다가 헤드리스로 되돌린 버블에는 옛 값이 남아 있어, 그대로 넘기면 클로드로 도는
  //   헤드리스 세션을 "클로드가 아닌 CLI"로 읽어 아래 세 칸이 조용히 사라진다.
  const executionMode = useGraphStore((s) => s.agentConfigs[agent.id]?.executionMode);
  const cmdCliKind = executionMode === 'interactive-terminal' ? cliKind : undefined;
  // §5.25 (B-1) — 클로드가 아닌 CLI 를 채우는 CMD(Codex CMD 등)에는 모델 칸이 전달되지 않는다.
  //   `config.model`(opus)로 떨어지지 않고 CLI 이름을 적는다(순수 셸이면 적을 모델이 없다).
  const cmdCliUnmanaged = executionMode === 'interactive-terminal' && !resolveCmdCliKind(cmdCliKind).managed;
  const cliModel = cmdCliUnmanaged
    ? agentModelLabelOf({ executionMode, cliKind: cmdCliKind }) ?? undefined
    : undefined;
  const configuredRaw = cmdCliUnmanaged ? cliModel : providerModel ?? ownModel ?? globalModel;
  // 별칭 펴기는 클로드 이름에만 쓴다 — 코덱스 slug·로컬 파일명은 그 레지스트리의 대상이 아니다.
  const configuredModel = cmdCliUnmanaged
    ? cliModel
    : providerModel ?? (resolveAliasToLatest(configuredRaw, modelRegistry) ?? configuredRaw);
  // 창 크기 폴백은 **모델을 먼저 안 뒤에야** 고를 수 있어 모델만 한 번 따로 푼다(같은 규칙,
  //   같은 함수 — 두 곳에서 따로 판정하지 않는다).
  const model = resolveStatusBarModel(agent, activeSession, configuredModel);
  const usage = resolveStatusBarUsage(agent, activeSession, {
    configuredModel,
    // 실측 창 크기가 없어도 **그 모델의 창**은 안다 — 첫 턴 전에도 `0/1.0M` 이 참이다.
    //   모델조차 모르면 0 을 넘겨 `0/0` 으로 둔다(지어내지 않는다).
    fallbackContextMax: model ? getModelContextLimit(model, modelRegistry) : 0,
  });
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const context = usage.context;

  /* §5.26 (I) — 컨텍스트 칸은 보험 팝업(§7.23)의 입구다. 경고·에러 모양 ❌((I) ⑥) — 칠하면 컨텍스트가 오류처럼 읽힌다. 그래서 원장을 읽지 않고 세션만 넘긴다((I) ④). */
  const setInsurancePopupOpen = useGraphStore((s) => s.setInsurancePopupOpen);
  const insurancePopupOpen = useGraphStore((s) => s.insurancePopupOpen);
  const insuranceScope: InsuranceSessionScope = {
    agentId: agent.id,
    subAgentId: activeSession?.id ?? null,
    sessionId: activeSession?.sessionId ?? null,
  };

  // §4 (CLI 사양 추종) — 이 에이전트의 자동 압축 창(명령 사이 압축의 기준). 서버 턴 경계 판정과 같은 3층
  //   해소(에이전트 설정 → 설정 창 전역 → 내장 기본)를 같은 함수로 계산해 화면과 판정이 어긋나지
  //   않게 한다. 두 선택자 모두 원시 문자열이라 파생 배열/맵 구독의 리렌더 함정을 타지 않는다.
  const ownAutoCompact = useGraphStore((s) => s.agentConfigs[agent.id]?.autoCompact);
  const globalAutoCompact = useGraphStore((s) => s.userDefaults?.agentConfig?.autoCompact);
  const autoCompact = resolveAutoCompact(ownAutoCompact, globalAutoCompact);
  // §4 (CLI 사양 추종) (5) 창 하한 — 보고 있는 세션(없으면 같은 에이전트의 최근 세션)의 시작 문맥으로
  //   **실제로 쓰는** 창을 적는다. 턴 경계 판정과 같은 함수다 — 칸은 200k 라는데 320k 에서 접히면 칸이 거짓말이 된다.
  //   두 선택자 모두 원시값이다(위 칸들과 같은 문법).
  const activeSubId = activeSession?.id ?? null;
  const compactFloor = useGraphStore((s) => pickCompactFloorSource(s.subAgents[agent.id], activeSubId)?.floor ?? null);
  const compactFloorMax = useGraphStore((s) => pickCompactFloorSource(s.subAgents[agent.id], activeSubId)?.contextMax ?? null);
  const compactEffective = applyAutoCompactFloor(autoCompact, compactFloor, compactFloorMax);
  const compactFoldsAtPercent = Math.round(TURN_COMPACT_TRIGGER_RATIO * 100);

  // §4 (Thinking on/off) — 확장 사고를 **꺼 둔** 에이전트인가. 판정(3층 해소 · 안 띄우는 갈래
  //   셋)은 전부 `statusBarContext.ts` 에 있다 — 화면에는 그릴지 말지만 남긴다. 세 선택자 모두
  //   원시값이라 파생 배열/맵 구독의 리렌더 함정을 타지 않는다(위 모델·자동 압축 칸과 같은 문법).
  const ownThinking = useGraphStore((s) => s.agentConfigs[agent.id]?.thinking);
  const globalThinking = useGraphStore((s) => s.userDefaults?.agentConfig?.thinking);
  const thinkingOff = resolveStatusBarThinkingOff({
    isCustom,
    providerKind,
    cliKind: cmdCliKind,
    agentThinking: ownThinking,
    userDefaultThinking: globalThinking,
    // 사고를 끌 수 없는 모델(Opus 5.5·Fable 5.x)이면 꺼 둔 설정이 실려도 그 턴은 생각한다 — 모델 칸과 같은 모델로 본다.
    model,
    registry: modelRegistry,
  });

  // §4 (상태바 모델 칸 ①) — 모델 옆에 붙는 추론 강도. 판정(3층 · 코덱스 갈래 · 안 띄우는 셋)은
  //   `statusBarContext.ts` 한 곳이고, 여기서는 원시값만 집는다(위 칸들과 같은 문법).
  const ownEffort = useGraphStore((s) => s.agentConfigs[agent.id]?.effort);
  const globalEffort = useGraphStore((s) => s.userDefaults?.agentConfig?.effort);
  const codexEffort = useGraphStore((s) => s.agentConfigs[agent.id]?.provider?.reasoningEffort);
  // 설정 창과 같은 상속 경로를 쓴다. 선택된 프로젝트가 아니라 이 에이전트의 프로젝트가 기준이다.
  const inheritedCodexEffort = useGraphStore((s) => {
    const projectName = s.agentProjects[agent.id];
    const projectPath = projectName ? s.projects[projectName]?.path : undefined;
    return resolveAgentDefaults(s.userDefaults, 'codex', projectPath).provider?.reasoningEffort;
  });
  const codexConfig = useCodexEffectiveConfig(isCustom && providerKind === 'codex-cli', agent.id);
  const codexModel = useGraphStore((s) => s.codexModels?.models.find((entry) => entry.slug === providerModelId));
  const effort = resolveStatusBarEffort({
    isCustom,
    providerKind,
    cliKind: cmdCliKind,
    agentEffort: ownEffort,
    userDefaultEffort: globalEffort,
    codexEffort,
    inheritedCodexEffort,
    codexConfig,
    codexModel,
    sessionEffort: activeSession?.reasoningEffort,
    sessionModel: activeSession?.modelName,
    providerModelId,
  });
  // 강도 칸의 이름은 갈래마다 우리 라벨이 다르다(클로드 설정창 칸 · 코덱스 칸) — 그 라벨에서 받아 적는다.
  const effortLabel = providerKind === 'codex-cli'
    ? t('panel.agentConfig.codex.effort')
    : t('panel.agentConfig.effort.label');

  // §4 (상태바 모델 칸 ②) — 누르면 설정창의 모델 구역이 칸 위에 뜬다. 카드가 붙을 자리는 누른 순간의
  //   칸 사각형이다. 어느 버블의 카드인지도 함께 쥔다 — 떠 있는 동안 바가 다른 버블로 넘어가면 그
  //   카드를 새 버블에 그리지 않는다(옛 버블 값을 든 채 새 버블에 저장하게 된다).
  const canSwitchModel = canOpenModelQuickSwitch({ isCustom, cliKind: cmdCliKind });
  const [modelSwitch, setModelSwitch] = useState<{ agentId: string; anchor: PopupAnchorRect } | null>(null);
  const openModelSwitch = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setModelSwitch({ agentId: agent.id, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }, [agent.id]);
  const closeModelSwitch = useCallback(() => setModelSwitch(null), []);
  const modelSwitchOpen = canSwitchModel && modelSwitch !== null && modelSwitch.agentId === agent.id;
  const modelChipName = model ? formatModelName(model) : t('ide.statusBar.modelUnknown');
  const modelChipEffort = effort
    ? (effort.kind === 'level' ? effort.value : t('ide.statusBar.modelUnknown'))
    : null;
  const modelChipTitle = [
    t('ide.statusBar.modelTip'),
    effort ? t('ide.statusBar.effortTip', { effort: effortLabel }) : null,
    canSwitchModel ? t('ide.statusBar.modelSwitchTip') : null,
  ].filter((line): line is string => line !== null).join('\n');

  // ─── §5.5 #17-30 — 이 세션에 모인 diff 리뷰 코멘트를 한 명령으로 보낸다 ───
  const sessionKey = followSessionKey(agent.id, activeSession?.id ?? null);
  const reviewComments = useGraphStore((s) => s.diffComments[sessionKey]);
  const addCommand = useGraphStore((s) => s.addCommand);
  const clearDiffComments = useGraphStore((s) => s.clearDiffComments);
  const reviewCount = reviewComments?.length ?? 0;
  const sendReview = useCallback(() => {
    if (!reviewComments || reviewComments.length === 0) return;
    const text = buildDiffCommentPrompt(reviewComments, t('ide.diff.reviewPromptHeader'));
    if (text === '') return;
    // 전송 창구는 기존 하나뿐(`addCommand`) — 새 경로를 만들지 않는다. 보낸 뒤에만 비운다.
    addCommand(agent.id, text, activeSession?.id ?? null, []);
    clearDiffComments(sessionKey);
  }, [reviewComments, t, addCommand, agent.id, activeSession?.id, clearDiffComments, sessionKey]);

  return (
    // `flex-wrap` + `max-h-11`(≈두 줄, 넘치면 안에서 스크롤) — 상한이 없으면 편집기를 밀어낸다. 항목은 `whitespace-nowrap`.
    // §9 — 왼쪽 한 덩어리(`flex-1` 스페이서 ❌ — 컨텍스트와 자동 압축이 떨어진다), 누르는 것은 맨 끝. 순서 고정: 정체·상태·모델·컨텍스트·총 토큰·자동 압축·세션 수.
    // 값이 없어도 칸을 지우지 않는다(옆 칸이 밀려 줄이 흔들린다) — 모르면 `0`.
    <div className="scrollbar-thin flex max-h-11 min-h-6 flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 overflow-y-auto border-t border-gray-700 bg-gray-900/80 px-3 py-0.5 text-[12px]">
      {/* Agent type */}
      <span
        title={isCustom ? t('ide.statusBar.customTip') : t('ide.statusBar.hookTip')}
        className={`whitespace-nowrap rounded px-1.5 py-0.5 font-semibold ${
          isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-400'
        }`}
      >
        {isCustom ? t('ide.statusBar.custom') : t('ide.statusBar.hook')}
      </span>

      {/* Status */}
      <span className="flex items-center gap-1 whitespace-nowrap" title={t('ide.statusBar.statusTip')}>
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${sessionDotClass(runState, focusGlow, Date.now())}`} />
        <span className={runState === 'error' ? 'text-red-400' : 'text-gray-400'}>
          {t(SESSION_STATUS_LABEL_KEY[runState])}
        </span>
        {/* 경과 시계(`· 0s`)는 이 줄에서 뺐다 — 위 §2.4(경과 시계를 뺀 자리) 참조. */}
        {/* 상태바에는 실행 상태만 표시한다. 탐침의 추측성 보조 문구는 붙이지 않는다. */}
      </span>

      {/* Model — 모르면 "모름". §4 (모델 칸 ①②) — 추론 강도를 같은 칸에(`opus-5 · high`). 미설정 코덱스는 상속·실측·모델 기본값으로 푼다. 잘릴 땐 모델 이름만 줄인다.
         누를 수 없는 버블(훅·클로드 아닌 CMD)은 글자로만. */}
      {canSwitchModel ? (
        <button
          type="button"
          onClick={openModelSwitch}
          aria-haspopup="dialog"
          aria-expanded={modelSwitchOpen}
          className={`flex min-w-0 max-w-[18rem] items-center gap-1 whitespace-nowrap rounded px-1 transition-colors hover:bg-white/[0.08] hover:text-gray-300 ${
            modelSwitchOpen ? 'bg-white/[0.08] text-gray-300' : 'text-gray-500'
          }`}
          title={modelChipTitle}
        >
          <span className="min-w-0 truncate">{modelChipName}</span>
          {modelChipEffort !== null && <span className="flex-shrink-0">· {modelChipEffort}</span>}
        </button>
      ) : (
        <span className="flex min-w-0 max-w-[18rem] items-center gap-1 whitespace-nowrap text-gray-500" title={modelChipTitle}>
          <span className="min-w-0 truncate">{modelChipName}</span>
          {modelChipEffort !== null && <span className="flex-shrink-0">· {modelChipEffort}</span>}
        </span>
      )}

      {/* §4 (Thinking) — 확장 사고를 끈 에이전트에서만 뜬다(켬이 기본이라 늘 띄우면 소음 — "칸을 지우지 않는다"는 수치 칸 규칙이다). 모델 바로 뒤에 둔다. */}
      {thinkingOff && (
        <span
          className="flex items-center gap-1 whitespace-nowrap rounded bg-gray-700/30 px-1.5 py-0.5 text-gray-400"
          title={t('ide.statusBar.thinkingOffTip', {
            // 라벨 이름은 글자로 박지 않고 그 라벨에서 받아 적는다 — 12 로케일에서 각자 번역되는
            //   우리 이름이라, 박아 두면 그 로케일에서만 화면에 없는 곳을 가리키게 된다.
            thinking: t('panel.agentConfig.thinking.label'),
            agentSettings: t('panel.agentConfig.title'),
            file: t('panel.fileMenu.file'),
            options: t('panel.options.title'),
            agentDefaults: t('panel.options.categories.agent'),
          })}
        >
          <svg
            className="h-3.5 w-3.5 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16.8 11.2c.8-.9 1.2-2 1.2-3.2a6 6 0 0 0-9.3-5" />
            <path d="M6.3 6.3a4.7 4.7 0 0 0 1.2 5.2c.7.7 1.3 1.5 1.5 2.5" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="m2 2 20 20" />
          </svg>
          {t('ide.statusBar.thinkingOff')}
        </span>
      )}

      {/* Context usage — 보고 있는 세션 기준, 못 재면 `0`. §5.26 (I) — 칸은 늘 중립색(경고 색·삼각형·툴팁·실패 건수 ❌ — (I) ⑤⑥). */}
      <button
        type="button"
        onClick={() => setInsurancePopupOpen(true)}
        className="flex items-center gap-1 whitespace-nowrap rounded px-1 text-gray-500 transition-colors hover:bg-white/[0.08]"
        title={t('ide.statusBar.contextTip')}
      >
        {t('ide.statusBar.context', { used: formatTokenCount(context.used), max: formatTokenCount(context.max) })}
        {/* §5.26 (I) ⑤ — 실패 건수 배지 ❌(수치 옆 `1` 이 안 읽힌다). 그 수는 팝업 「압축 기록」 칩이 말한다. */}
      </button>

      {/* Token usage — 0 이어도 칸을 남긴다. 그 0 이 "이 세션은 아직 안 썼다"는 정보이고,
          칸이 사라지면 사용자는 그 자리에 있던 **에이전트 합계**를 기억하게 된다. */}
      <span className="whitespace-nowrap text-violet-400/70" title={t('ide.statusBar.tokensTip')}>
        {t('ide.statusBar.tokens', { in: formatTokenCount(inputTokens), out: formatTokenCount(outputTokens) })}
      </span>

      {/* §4 (CLI 사양 추종) — 자동 압축 값. 컨텍스트 수치가 왼쪽에서 오르는 동안 "그래서 어디서
          잘리는가"를 같은 바에서 바로 읽게 한다. 마우스를 올리면 뜻과 바꾸는 자리를 알려 준다. */}
      {/* 올려 잡았으면 칸은 올린 값을 적고, 이유는 툴팁에 한 단락 더한다(경고색 ❌ — 고장이 아니다). */}
      <span
        className="whitespace-nowrap text-gray-600"
        title={compactEffective.raisedFrom !== undefined && compactFloor !== null
          ? [
            t('ide.statusBar.autoCompactTip', { percent: compactFoldsAtPercent }),
            t('ide.statusBar.autoCompactRaised', {
              from: formatAutoCompact(compactEffective.raisedFrom, t('panel.agentConfig.autoCompact.offLabel')),
              floor: `${Math.round(compactFloor / 1000)}k`,
            }),
          ].join('\n\n')
          : t('ide.statusBar.autoCompactTip', { percent: compactFoldsAtPercent })}
      >
        {t('ide.statusBar.autoCompact', { value: formatAutoCompact(compactEffective.value, t('panel.agentConfig.autoCompact.offLabel')) })}
      </span>

      {/* Session count */}
      <span className="whitespace-nowrap text-gray-600" title={t('ide.statusBar.sessionsTip')}>
        {sessionCount === 1
          ? t('ide.statusBar.sessionOne', { count: sessionCount })
          : t('ide.statusBar.sessionMany', { count: sessionCount })}
      </span>

      {/* §5.5 #17-30 — 모인 리뷰 코멘트 보내기. 훅 버블(읽기 전용)에는 뜨지 않는다(#17-29). */}
      {isCustom && reviewCount > 0 && (
        <button
          type="button"
          onClick={sendReview}
          className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded bg-blue-600/80 px-2 py-0.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-500"
          title={t('ide.diff.sendReviewTip')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
          </svg>
          {t('ide.diff.sendReview', { count: reviewCount })}
        </button>
      )}

      {/* §4 (상태바 모델 칸 ②) — 설정창의 모델 구역. 카드가 스스로 body 로 portal 한다(위 팝업과 같은 이유).
          버블이 바뀌면 새로 짓는다 — 설정창은 연 순간의 값으로 칸을 채우기 때문이다. */}
      {modelSwitchOpen && modelSwitch && (
        <StatusBarModelSwitch
          key={agent.id}
          agent={agent}
          anchorRect={modelSwitch.anchor}
          onClose={closeModelSwitch}
        />
      )}

      {/* 상태바가 `overflow-y-auto` 안이라 팝업은 body 로 portal 한다(감사 팝업과 같은 함정). */}
      {insurancePopupOpen && createPortal(
        <ContextInsurancePopup
          onClose={() => setInsurancePopupOpen(false)}
          agentId={agent.id}
          // §7.23 범위 축 — 상태바가 이미 세운 좌표를 그대로 넘긴다. 팝업이 세션을 다시
          //   찾으면 두 화면이 서로 다른 세션을 주어로 삼게 된다(§5.26 (I) 와 같은 규율).
          scope={insuranceScope}
        />,
        document.body,
      )}
    </div>
  );
});
