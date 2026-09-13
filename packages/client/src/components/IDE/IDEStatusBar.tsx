import { memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';
import {
  resolveAutoCompact, isAutoCompactOn, resolveAliasToLatest, getModelContextLimit,
  agentModelLabelOf,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  NODE_STATUS_RUN_STATE, sessionDotClass, SESSION_STATUS_LABEL_KEY, sessionRunStateOf,
  sessionProbeNote,
} from '../../utils/sessionStatus.js';
import { followSessionKey } from './editorFollow.js';
import { buildDiffCommentPrompt } from './diffCommentPrompt.js';
import { resolveStatusBarUsage, resolveStatusBarModel, resolveStatusBarThinkingOff } from './statusBarContext.js';
import { findInsuranceLedger, sessionFailedCompacts, sessionWatchLevel } from '../../utils/insuranceView.js';
import type { InsuranceSessionScope } from '../../utils/insuranceView.js';
import { ContextInsurancePopup } from '../Panel/ContextInsurancePopup.js';

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
  // 종전에는 여기서 `activeSession?.status ?? agent.status` 로 **값 집합이 다른 두 축**(SubAgentStatus /
  //   NodeStatus)을 한 칸에 섞어 그리고, 그 enum 원문을 번역 없이 출력했다(`awaiting_permission` 이
  //   날 문자열로 보였다). 게다가 색 규약이 나머지 화면과 **정반대**였다 — 다른 넷은 완료·미확인을
  //   초록으로 강조하고 completed 를 회색으로 죽이는데, 이 바만 그 둘을 뒤집어 칠했다.
  //   이제 두 축을 같은 표시 어휘로 접어(`sessionRunStateOf` / `NODE_STATUS_RUN_STATE`) 색·낱말을 공유한다.
  const runState = activeSession
    ? sessionRunStateOf(activeSession, acknowledged)
    : NODE_STATUS_RUN_STATE[agent.status];
  // §2.4 — 서버가 붙여 준 세션 생존 판정(있을 때만). 낱말로 접는 것은 `sessionProbeNote` 한 곳이다.
  const probeNote = sessionProbeNote(activeSession);
  // §5.5 — 모델·컨텍스트·토큰은 **보고 있는 세션 하나**를 주어로 삼는다. 종전에는 칸마다
  //   `activeSession?.X ?? agent.X` 로 폴백을 걸어, 고른 세션이 그 값을 아직 안 가졌으면 조용히
  //   버블 값(= 커스텀이면 "가장 최근에 움직인 sub" + **모든 sub 토큰 합**)으로 굴러떨어졌다.
  //   그래서 방금 연 세션 넷을 오가도 `입력 1267.2M / 출력 7.4M`(24개 세션 합계)가 넷 다 똑같이
  //   떴다(사용자 보고 — "세션을 넘겨도 안 변한다"). 이제 주어를 한 곳에서 고른다 —
  //   근거와 규칙은 `statusBarContext.ts`.
  //   아직 한 턴도 안 돈 세션의 모델만은 **이 에이전트에 설정된 모델**로 채운다(다른 세션의 실측
  //   모델이 아니라 그 세션이 다음 턴에 쓸 모델이라 거짓말이 아니다). 별칭(`opus`)은 레지스트리가
  //   아는 만큼만 최신 id 로 편다 — 못 펴면 별칭 그대로 적는다(UI 라벨 전용 용법).
  const ownModel = useGraphStore((s) => s.agentConfigs[agent.id]?.model);
  const globalModel = useGraphStore((s) => s.userDefaults?.agentConfig?.model);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  /**
   * §5.25 (J) — **엔진을 먼저 본다.** `config.model` 은 클로드 칸이고 기본값이 `opus` 라,
   * 그대로 쓰면 코덱스·로컬 세션의 상태바가 `opus` 라고 말한다(캔버스 버블에서 났던 것과
   * 같은 사고 — 표시 자리마다 따로 판정한 대가다). 프로바이더가 있으면 그쪽이 주어이고,
   * 없을 때만 종전 3층(에이전트 → 전역)을 그대로 탄다.
   */
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
  const configuredRaw = providerModel ?? ownModel ?? globalModel;
  // 별칭 펴기는 클로드 이름에만 쓴다 — 코덱스 slug·로컬 파일명은 그 레지스트리의 대상이 아니다.
  const configuredModel = providerModel ?? (resolveAliasToLatest(configuredRaw, modelRegistry) ?? configuredRaw);
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

  // §4 (CLI 사양 추종) — 이 에이전트에 **실제로 실리는** 자동 압축 값. 서버 스폰과 같은 3층
  //   해소(에이전트 설정 → 설정 창 전역 → 내장 기본)를 같은 함수로 계산해 화면과 스폰이 어긋나지
  //   않게 한다. 두 선택자 모두 원시 문자열이라 파생 배열/맵 구독의 리렌더 함정을 타지 않는다.
  /*
   * §5.26 (F)(I) — 컨텍스트 칸은 **누를 수 있는 칸**이다. 압축·사본·부활이 전부 이 숫자에
   * 얽힌 사건이라, 그 숫자를 보다가 "그래서 뭘 잃었나"가 궁금해지는 자리가 바로 여기다.
   * 헤더에 세 번째 필을 더하지 않는 이유이기도 하다(§5.26 (I)).
   *
   * 등급은 서버가 매긴 것을 **그대로** 읽는다 — 여기서 비율을 다시 재면 서버와 화면이 갈린다.
   *
   * **주어는 원장(프로젝트)이 아니라 세션이다(§5.26 (I)).** 종전에는 등급을 프로젝트 안 모든
   * 세션의 최악값으로, 실패 건수를 프로젝트 전체 합(`counts.failedCompacts`)으로 읽어 **세션을
   * 넘겨도 같은 색·같은 숫자가 남았다**(사용자 보고 — 세션 8개짜리 버블의 여덟 탭 전부에 `1`).
   * 위 모델·토큰 칸이 겪었던 것과 같은 사고라 고치는 방법도 같다: 원장은 그대로 두고 **내 줄만
   * 골라 본다**. 팝업(§7.23)은 여전히 프로젝트 한 장이다 — 저장고가 프로젝트 단위이기 때문이다.
   */
  const insuranceLedgers = useGraphStore((s) => s.contextInsurance);
  const activeProject = useGraphStore((s) => s.activeProject);
  const setInsurancePopupOpen = useGraphStore((s) => s.setInsurancePopupOpen);
  const insurancePopupOpen = useGraphStore((s) => s.insurancePopupOpen);
  const insuranceLedger = findInsuranceLedger(insuranceLedgers, activeProject);
  const insuranceScope: InsuranceSessionScope = {
    agentId: agent.id,
    subAgentId: activeSession?.id ?? null,
    sessionId: activeSession?.sessionId ?? null,
  };
  const watchLevel = sessionWatchLevel(insuranceLedger, insuranceScope);
  const failedCompacts = sessionFailedCompacts(insuranceLedger, insuranceScope);

  const ownAutoCompact = useGraphStore((s) => s.agentConfigs[agent.id]?.autoCompact);
  const globalAutoCompact = useGraphStore((s) => s.userDefaults?.agentConfig?.autoCompact);
  const autoCompact = resolveAutoCompact(ownAutoCompact, globalAutoCompact);

  // §4 (Thinking on/off) — 확장 사고를 **꺼 둔** 에이전트인가. 판정(3층 해소 · 안 띄우는 갈래
  //   셋)은 전부 `statusBarContext.ts` 에 있다 — 화면에는 그릴지 말지만 남긴다. 세 선택자 모두
  //   원시값이라 파생 배열/맵 구독의 리렌더 함정을 타지 않는다(위 모델·자동 압축 칸과 같은 문법).
  const ownThinking = useGraphStore((s) => s.agentConfigs[agent.id]?.thinking);
  const globalThinking = useGraphStore((s) => s.userDefaults?.agentConfig?.thinking);
  const cliKind = useGraphStore((s) => s.agentConfigs[agent.id]?.cliKind);
  const thinkingOff = resolveStatusBarThinkingOff({
    isCustom,
    providerKind,
    cliKind,
    agentThinking: ownThinking,
    userDefaultThinking: globalThinking,
  });

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
    // 창을 좁히면 이 한 줄(정체·상태·모델·컨텍스트·토큰·자동압축·세션 수)이 넘친다 — 종전에는
    //   `h-6` 고정이라 넘친 항목이 줄 밖으로 밀려나 잘렸다. 이제 `flex-wrap` 이라 다음 줄로
    //   내려가고 높이가 그만큼 늘어난다(넓은 창에서는 한 줄 그대로 = 종전 화면과 같다).
    //   항목마다 `whitespace-nowrap` — 낱말 중간이 아니라 **항목 사이**에서 끊겨야 읽힌다.
    //   §9 — 항목은 **한 덩어리로 왼쪽에 붙는다.** 종전에는 가운데 `flex-1` 스페이서가 뒤쪽
    //   셋(리뷰 버튼·자동 압축·세션 수)을 오른쪽 끝으로 밀어, 컨텍스트 수치와 "그 컨텍스트가
    //   어디서 잘리는가"(자동 압축)가 창 폭만큼 떨어져 한 줄로 읽히지 않았다. 스페이서를 빼고
    //   읽는 항목을 먼저, **누르는 것(리뷰 보내기)은 맨 끝**에 둔다.
    //   다만 줄바꿈에는 **상한을 둔다(`max-h-11` ≈ 두 줄)** — 항목은 기능이 붙을 때마다 늘어나는
    //   자리라, 좁은 창에서 넉 줄 다섯 줄이 되면 상태바가 편집기를 밀어낸다. 넘친 만큼은 이 안에서
    //   스크롤하므로 종전처럼 잘려 사라지지는 않는다.
    //   **항목 순서는 고정이다(사용자 지시)** — 정체 · 상태 · **모델 · 현재 컨텍스트 · 총 입출력
    //   토큰 · 자동 압축** · 세션 수. 가운데 넷은 "무엇으로 도는가 → 지금 얼마나 찼나 → 여태 얼마나
    //   썼나 → 어디서 접히나" 순으로 한 문장처럼 읽힌다.
    //   **값이 없다고 칸을 지우지 않는다** — 지우면 옆 칸이 그 폭만큼 밀렸다 되돌아와 줄이
    //   흔들린다(사용자 보고 "간헐적으로 아래 내용이 사라진다"). 모르면 `0` 을 적는다.
    //   칸마다 `title` 로 그 숫자가 무엇인지 적어 둔다 — 낱말만으로는 "컨텍스트"와 "총 입력"이
    //   왜 자릿수가 다른지 알 수 없다(누적 vs 지금 한 턴).
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
        {/*
          §2.4 — "실행중…" 옆의 한 마디. 스피너만으로는 정보가 0 이라 사용자가 "아직도?"를
          판단할 근거가 없었다(이 축이 생긴 이유). 판정은 서버가 하고 여기서는 적기만 한다.
        */}
        {probeNote && (
          <span
            className={probeNote.warn ? 'text-amber-400' : 'text-gray-500'}
            title={probeNote.detail}
          >
            · {t(probeNote.key)}
          </span>
        )}
      </span>

      {/* Model — 모르면 "모름"을 적는다. 이름 자리라 `0` 으로 대신할 수 없다. */}
      <span
        className="max-w-[14rem] truncate whitespace-nowrap text-gray-500"
        title={t('ide.statusBar.modelTip')}
      >
        {model ? formatModelName(model) : t('ide.statusBar.modelUnknown')}
      </span>

      {/* §4 (Thinking on/off) — 확장 사고를 **꺼 둔** 에이전트에서만 뜨는 칸.
          위 "값이 없다고 칸을 지우지 않는다" 규칙의 예외가 아니다 — 그 규칙은 턴마다 흔들리는
          **수치** 칸(컨텍스트·토큰)을 두고 한 말이고, 이 칸은 사용자가 체크를 만질 때만 나타났다
          사라진다. 켬이 기본이라 늘 띄우면 거의 모든 상태바에 아무 정보 없는 낱말이 하나 더 붙는다.
          모델 바로 뒤에 두는 이유: "무엇으로 도는가"의 단서라 `opus-5 · 확장 사고 꺼짐` 이
          한 문장으로 읽힌다(뒤따르는 컨텍스트 → 토큰 → 자동 압축 순서는 그대로다). */}
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

      {/* Context usage — 선택한 세션 기준(없을 때만 버블 값). 못 쟀으면 `0`, 칸은 남는다.
          §5.26 (I) — 누르면 보험 팝업(§7.23)이 열린다. 자동압축이 안 도는 것 같으면 여기 색이
          바뀌고, 압축이 실패로 못 박힌 건수가 있으면 그 숫자가 옆에 붙는다. */}
      <button
        type="button"
        onClick={() => setInsurancePopupOpen(true)}
        className={`flex items-center gap-1 whitespace-nowrap rounded px-1 transition-colors hover:bg-white/[0.08] ${
          watchLevel === 'stalled' || watchLevel === 'rejected'
            ? 'text-red-400'
            : watchLevel === 'overdue' ? 'text-amber-400' : 'text-gray-500'
        }`}
        title={t(
          watchLevel === 'stalled'
            ? 'ide.statusBar.contextStalledTip'
            // §5.26 (F)(b) — 보냈는데 안 온 것. 사유(슬래시가 꺼져 있다)를 그 자리에서 짚어 준다.
            : watchLevel === 'rejected'
              ? 'ide.statusBar.contextRejectedTip'
              : watchLevel === 'overdue' ? 'ide.statusBar.contextOverdueTip' : 'ide.statusBar.contextTip',
          // 주입원 칸의 이름은 로케일마다 다르다 — 글자로 박지 않고 그 라벨에서 받아 적는다.
          { contextSources: t('ide.activityBar.context') },
        )}
      >
        {t('ide.statusBar.context', { used: formatTokenCount(context.used), max: formatTokenCount(context.max) })}
        {watchLevel && (
          <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        )}
        {/* §5.26 (I) — **이 세션에서** 실패로 못 박힌 압축 건수. 숫자만 있고 아무 설명이 없으면
            사용자가 컨텍스트 수치의 일부로 읽는다(주어가 세션으로 바뀐 지금은 더 그렇다). */}
        {failedCompacts > 0 && (
          <span
            className="rounded bg-red-500/15 px-1 text-[12px] font-semibold text-red-300"
            title={t('ide.statusBar.failedCompactsTip', { count: failedCompacts })}
          >
            {failedCompacts}
          </span>
        )}
      </button>

      {/* Token usage — 0 이어도 칸을 남긴다. 그 0 이 "이 세션은 아직 안 썼다"는 정보이고,
          칸이 사라지면 사용자는 그 자리에 있던 **에이전트 합계**를 기억하게 된다. */}
      <span className="whitespace-nowrap text-violet-400/70" title={t('ide.statusBar.tokensTip')}>
        {t('ide.statusBar.tokens', { in: formatTokenCount(inputTokens), out: formatTokenCount(outputTokens) })}
      </span>

      {/* §4 (CLI 사양 추종) — 자동 압축 값. 컨텍스트 수치가 왼쪽에서 오르는 동안 "그래서 어디서
          잘리는가"를 같은 바에서 바로 읽게 한다. 마우스를 올리면 뜻과 바꾸는 자리를 알려 준다. */}
      <span className="whitespace-nowrap text-gray-600" title={t('ide.statusBar.autoCompactTip')}>
        {t('ide.statusBar.autoCompact', { value: formatAutoCompact(autoCompact, t('panel.agentConfig.autoCompact.offLabel')) })}
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
