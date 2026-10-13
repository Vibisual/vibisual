import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { SESSION_STATUS_LABEL_KEY, sessionDotClass, sessionRunStateOf, serializeBusySubIds, parseBusySubIds, serializePendingSubIds } from '../../utils/sessionStatus.js';

interface SubAgentListProps {
  subAgents: SubAgent[];
}

// 색·라벨 규약은 `utils/sessionStatus` 공용(종전 사본은 확인 여부를 안 봐서 IDE 탭바와 어긋났다).

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export const SubAgentList = memo(function SubAgentList({
  subAgents,
}: SubAgentListProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const openIDEOverlay = useGraphStore((s) => s.openIDEOverlay);
  // IDE 탭바와 같은 규약 — 확인한 세션은 조용한 색으로 내려간다.
  const acknowledged = useGraphStore((s) => s.acknowledgedSubAgents);
  const sessionFocusGlow = useGraphStore((s) => s.sessionFocusGlow);
  // 백단 작업을 가진 세션은 IDE 탭바와 같이 도트가 켜진다(부모 id 는 목록의 sub 에서 얻는다).
  const parentAgentId = subAgents[0]?.parentAgentId;
  const busySubKey = useGraphStore((s) => serializeBusySubIds(parentAgentId ? s.runningSubagentTasks[parentAgentId] : undefined));
  const busySubIds = useMemo(() => parseBusySubIds(busySubKey), [busySubKey]);
  // §5.5 #17-18 (대기) — 이 목록도 IDE 탭바와 같은 색을 낸다. 줄 선 명령 재료가 빠지면
  //   패널만 "완료"라고 적어 탭 도트와 어긋난다.
  const pendingSubKey = useGraphStore((s) => serializePendingSubIds(parentAgentId ? s.queuedCommands[parentAgentId] : undefined));
  const pendingSubIds = useMemo(() => parseBusySubIds(pendingSubKey), [pendingSubKey]);
  if (subAgents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">
        {t('panel.subAgent.heading', { count: subAgents.length })}
      </span>
      <ScrollFade maxHeight={256}><ul className="flex flex-col gap-1.5">
        {subAgents.map((sub) => {
          const runState = sessionRunStateOf(sub, !!acknowledged[sub.id], busySubIds.has(sub.id), pendingSubIds.has(sub.id));
          return (
            <li key={sub.id}>
              {/* §7.2 (판올림 번호 발급 대기) — 행을 누르면 IDE 의 그 세션 탭이 열린다. 종전에는 눌러도 아무 일이
                  없었다. 지휘통제실 [세션으로 이동]·콘티 이력과 같은 호출이고, 이 목록의 세션은 지금 있는
                  세션이라 그대로 세운다. 안쪽 칸은 버튼 안에 둘 수 있는 span 으로 쌓는다.
                  버튼에는 `items-stretch` 가 꼭 있어야 한다 — 브라우저 기본 스타일의 `align-items: flex-start` 가 남으면
                  안쪽 줄이 행 폭이 아니라 글자 길이만큼 넓어져, 이름·명령이 잘리지 않고 행 밖으로 새며 상태·시각도
                  오른쪽 끝에 서지 못한다(`li` 였던 종전 행은 이 기본값이 없어 멀쩡했다). */}
              <button
                type="button"
                onClick={() => openIDEOverlay(sub.parentAgentId, { focus: { sessionId: sub.id } })}
                title={t('commandCenter.jump')}
                className="flex w-full min-w-0 flex-col items-stretch gap-1 rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5 text-left transition-colors hover:border-gray-600 hover:bg-gray-700/60"
              >
                {/* 1행: 도트 + 이름 + 상태. 이름은 긴 경로가 와도 한 줄로 잘린다(전체는 title 로).
                    종전에는 잘림이 없어 경로가 오른쪽 칸(상태·토큰) 위로 넘어가 겹쳐 보였다. */}
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${sessionDotClass(runState, sessionFocusGlow[sub.id], Date.now())}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-200" title={sub.label}>
                    {sub.label}
                  </span>
                  <span className={`flex-shrink-0 whitespace-nowrap text-[12px] ${runState === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                    {t(SESSION_STATUS_LABEL_KEY[runState])}
                  </span>
                </span>
                {sub.lastCommand && (
                  <span className="block truncate pl-4 text-[12px] text-gray-500" title={sub.lastCommand}>
                    {sub.lastCommand}
                  </span>
                )}
                {/* 2행: 메타 — 토큰·잠듦은 왼쪽, 시각은 오른쪽 끝. 패널은 240px 까지 좁아지므로
                    이것들이 이름과 가로를 나눠 쓰면 이름이 설 자리가 없어진다. 아래로 내려 제 줄을 준다. */}
                <span className="flex items-center gap-2 pl-4 text-[12px]">
                  {(sub.totalInputTokens ?? 0) > 0 && (
                    <span className="min-w-0 truncate text-violet-400/70">
                      {t('panel.subAgent.tokensInOut', { in: formatTokenShort(sub.totalInputTokens ?? 0), out: formatTokenShort(sub.totalOutputTokens ?? 0) })}
                    </span>
                  )}
                  {/* §2.4 (잠듦) — 이 세션의 자식 프로세스는 회수됐다. 다음 명령이 --resume 으로 되살린다. */}
                  {sub.dormant && (
                    <span className="flex-shrink-0 whitespace-nowrap text-gray-500">
                      {t('common.bubble.dormant')}
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0 whitespace-nowrap text-gray-600">
                    {formatTime(sub.lastActivityAt)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul></ScrollFade>
    </div>
  );
});
