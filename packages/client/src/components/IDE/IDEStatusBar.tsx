import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';
import { resolveAutoCompact } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  NODE_STATUS_RUN_STATE, SESSION_STATUS_DOT, SESSION_STATUS_LABEL_KEY, sessionRunStateOf,
} from '../../utils/sessionStatus.js';
import { followSessionKey } from './editorFollow.js';
import { buildDiffCommentPrompt } from './diffCommentPrompt.js';

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
function formatAutoCompact(value: string): string {
  return value === 'auto' ? 'auto' : `${Number(value) / 1000}k`;
}

export const IDEStatusBar = memo(function IDEStatusBar({
  agent,
  activeSession,
  isCustom,
  sessionCount,
}: IDEStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const model = activeSession?.modelName ?? agent.modelName;
  const acknowledged = useGraphStore((s) => (activeSession ? !!s.acknowledgedSubAgents[activeSession.id] : false));
  // 종전에는 여기서 `activeSession?.status ?? agent.status` 로 **값 집합이 다른 두 축**(SubAgentStatus /
  //   NodeStatus)을 한 칸에 섞어 그리고, 그 enum 원문을 번역 없이 출력했다(`awaiting_permission` 이
  //   날 문자열로 보였다). 게다가 색 규약이 나머지 화면과 **정반대**였다 — 다른 넷은 완료·미확인을
  //   초록으로 강조하고 completed 를 회색으로 죽이는데, 이 바만 그 둘을 뒤집어 칠했다.
  //   이제 두 축을 같은 표시 어휘로 접어(`sessionRunStateOf` / `NODE_STATUS_RUN_STATE`) 색·낱말을 공유한다.
  const runState = activeSession
    ? sessionRunStateOf(activeSession, acknowledged)
    : NODE_STATUS_RUN_STATE[agent.status];
  const inputTokens = activeSession?.totalInputTokens ?? agent.totalInputTokens ?? 0;
  const outputTokens = activeSession?.totalOutputTokens ?? agent.totalOutputTokens ?? 0;

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
    <div className="flex min-h-6 flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-gray-700 bg-gray-900/80 px-3 py-0.5 text-[12px]">
      {/* Agent type */}
      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 font-semibold ${
        isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-400'
      }`}>
        {isCustom ? t('ide.statusBar.custom') : t('ide.statusBar.hook')}
      </span>

      {/* Status */}
      <span className="flex items-center gap-1 whitespace-nowrap">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${SESSION_STATUS_DOT[runState]}`} />
        <span className={runState === 'error' ? 'text-red-400' : 'text-gray-400'}>
          {t(SESSION_STATUS_LABEL_KEY[runState])}
        </span>
      </span>

      {/* Model */}
      {model && (
        <span className="max-w-[14rem] truncate whitespace-nowrap text-gray-500">
          {formatModelName(model)}
        </span>
      )}

      {/* Context usage */}
      {agent.contextMax && (
        <span className="whitespace-nowrap text-gray-500">
          {t('ide.statusBar.context', { used: formatTokenCount(agent.contextUsed ?? 0), max: formatTokenCount(agent.contextMax) })}
        </span>
      )}

      {/* Token usage */}
      {inputTokens > 0 && (
        <span className="whitespace-nowrap text-violet-400/70">
          {t('ide.statusBar.tokens', { in: formatTokenCount(inputTokens), out: formatTokenCount(outputTokens) })}
        </span>
      )}

      {/* §4 (CLI 사양 추종) — 자동 압축 값. 컨텍스트 수치가 왼쪽에서 오르는 동안 "그래서 어디서
          잘리는가"를 같은 바에서 바로 읽게 한다. 마우스를 올리면 뜻과 바꾸는 자리를 알려 준다. */}
      <span className="whitespace-nowrap text-gray-600" title={t('ide.statusBar.autoCompactTip')}>
        {t('ide.statusBar.autoCompact', { value: formatAutoCompact(autoCompact) })}
      </span>

      {/* Session count */}
      <span className="whitespace-nowrap text-gray-600">
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
