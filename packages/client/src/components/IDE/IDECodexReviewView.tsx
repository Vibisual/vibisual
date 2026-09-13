/**
 * IDECodexReviewView.tsx — §5.25 (N): 검증 칸의 **코덱스 대응물**(`codex review`).
 *
 * 클로드의 검증(§5.5 #17-35)과 자리는 같고 **묻는 것이 다르다** — 그쪽은 "앱을 띄워 돌려 보니
 * 되던가"(pass/fail/held 판정 · 시연 · 재시도)이고, 이쪽은 "**git 변경분에 문제가 있나**"이다.
 * 그래서 판정 칸을 빌려 오지 않는다 — 앱을 띄운 적이 없는 결과에 `pass` 를 붙이면 거짓말이 된다.
 *
 * **누를 때만 돈다.** 모델을 부르는 일이라 자동 실행하지 않는다(그 비용은 사용자 것이다 —
 * 검증이 자동 실행을 일부러 뺀 것과 같은 판단).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexReviewMode, CodexReviewRun } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';

/** 고를 수 있는 대상 셋 — 코덱스가 실제로 받는 플래그와 하나씩 짝이다. */
const MODES: readonly { mode: CodexReviewMode; labelKey: string; needsTarget: boolean }[] = [
  { mode: 'uncommitted', labelKey: 'ide.codex.review.modeUncommitted', needsTarget: false },
  { mode: 'base', labelKey: 'ide.codex.review.modeBase', needsTarget: true },
  { mode: 'commit', labelKey: 'ide.codex.review.modeCommit', needsTarget: true },
];

export const IDECodexReviewView = memo(function IDECodexReviewView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CodexReviewMode>('uncommitted');
  const [target, setTarget] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const runs = useGraphStore((s) => s.codexReviews);
  const startReview = useGraphStore((s) => s.startCodexReview);

  // 이 버블의 것만 본다 — 옆 버블의 리뷰가 여기 뜨면 어느 폴더를 본 결과인지 알 수 없다.
  const mine = useMemo(
    () => (runs ?? []).filter((r: CodexReviewRun) => r.agentId === agentId),
    [runs, agentId],
  );
  const running = mine.some((r) => r.status === 'running');
  const needsTarget = MODES.find((m) => m.mode === mode)?.needsTarget ?? false;
  // 값이 필요한 대상인데 비어 있으면 서버가 미커밋으로 떨어뜨린다 — 그 사실을 미리 말한다.
  const willFallBack = needsTarget && target.trim() === '';

  useEffect(() => { setStartError(null); }, [mode, target]);

  const onStart = useCallback(() => {
    setStartError(null);
    startReview(agentId, mode, target.trim()).catch((err: unknown) => {
      setStartError(err instanceof Error ? err.message : String(err));
    });
  }, [startReview, agentId, mode, target]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 border-b border-gray-800 px-2 py-1.5">
        <span className="text-[12px] font-semibold text-gray-300">{t('ide.codex.review.title')}</span>
        <p className="mt-0.5 text-[12px] text-gray-500">{t('ide.codex.review.intro')}</p>
      </div>

      <div className="flex-shrink-0 border-b border-gray-800 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              onClick={() => { setMode(m.mode); }}
              className={`app-nodrag rounded px-1.5 py-0.5 text-[12px] transition-colors ${
                mode === m.mode ? 'bg-sky-500/20 text-sky-300' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
        {needsTarget && (
          <input
            value={target}
            onChange={(e) => { setTarget(e.target.value); }}
            placeholder={t(mode === 'base' ? 'ide.codex.review.basePlaceholder' : 'ide.codex.review.commitPlaceholder')}
            className="app-nodrag mt-1.5 w-full rounded bg-gray-800 px-1.5 py-1 text-[12px] text-gray-200 outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-sky-500/40"
          />
        )}
        {willFallBack && <p className="mt-1 text-[12px] text-amber-400/80">{t('ide.codex.review.fallbackNote')}</p>}
        <button
          type="button"
          onClick={onStart}
          disabled={running}
          className="app-nodrag mt-1.5 w-full rounded bg-sky-500/15 px-2 py-1 text-[12px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? t('ide.codex.review.running') : t('ide.codex.review.start')}
        </button>
        {startError && <p className="mt-1 text-[12px] text-rose-400">{startError}</p>}
        <p className="mt-1.5 text-[12px] text-gray-600">{t('ide.codex.review.costNote')}</p>
      </div>

      {/* `fill` 이 있어야 래퍼가 flex 컨테이너로 서서 안쪽 스크롤 칸이 남은 높이를 받는다 —
          없으면 `scroll-fade relative` 로 서고 내용이 길어질 때 스크롤이 아니라 잘린다(§5.10 (N) (g)). */}
      <ScrollFade fill className="min-h-0 flex-1">
        {mine.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-gray-500">{t('ide.codex.review.empty')}</p>
        ) : (
          <ul>
            {mine.map((r) => (
              <li key={r.id} className="border-b border-gray-800/60 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    r.status === 'running' ? 'bg-sky-400' : r.status === 'done' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`} />
                  <span className="truncate text-[12px] font-medium text-gray-200">
                    {/* 실제로 무엇을 봤는지를 적는다 — 값이 비어 떨어졌으면 그 사실이 여기 드러난다. */}
                    {r.mode === 'uncommitted'
                      ? t('ide.codex.review.modeUncommitted')
                      : `${t(r.mode === 'base' ? 'ide.codex.review.modeBase' : 'ide.codex.review.modeCommit')} ${r.target ?? ''}`}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-[12px] text-gray-600">
                    {new Date(r.startedAt).toLocaleTimeString()}
                  </span>
                </div>
                {r.error && <p className="mt-0.5 text-[12px] text-rose-400">{r.error}</p>}
                {/* 코덱스가 뱉은 그대로 — 우리가 요약하거나 판정으로 바꾸지 않는다. */}
                {r.output && (
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-900/60 p-1.5 text-[12px] text-gray-300">
                    {r.output}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScrollFade>
    </div>
  );
});
