import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';
import {
  resolveAutoCompact, isAutoCompactOn, resolveAliasToLatest, getModelContextLimit,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  NODE_STATUS_RUN_STATE, SESSION_STATUS_DOT, SESSION_STATUS_LABEL_KEY, sessionRunStateOf,
  sessionProbeNote,
} from '../../utils/sessionStatus.js';
import { followSessionKey } from './editorFollow.js';
import { buildDiffCommentPrompt } from './diffCommentPrompt.js';
import { resolveStatusBarUsage, resolveStatusBarModel } from './statusBarContext.js';

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
  const configuredRaw = ownModel ?? globalModel;
  const configuredModel = resolveAliasToLatest(configuredRaw, modelRegistry) ?? configuredRaw;
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
  const ownAutoCompact = useGraphStore((s) => s.agentConfigs[agent.id]?.autoCompact);
  const globalAutoCompact = useGraphStore((s) => s.userDefaults?.agentConfig?.autoCompact);
  const autoCompact = resolveAutoCompact(ownAutoCompact, globalAutoCompact);

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
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${SESSION_STATUS_DOT[runState]}`} />
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

      {/* Context usage — 선택한 세션 기준(없을 때만 버블 값). 못 쟀으면 `0`, 칸은 남는다. */}
      <span className="whitespace-nowrap text-gray-500" title={t('ide.statusBar.contextTip')}>
        {t('ide.statusBar.context', { used: formatTokenCount(context.used), max: formatTokenCount(context.max) })}
      </span>

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
    </div>
  );
});
