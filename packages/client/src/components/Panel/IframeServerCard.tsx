import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, ServerEntry } from '@vibisual/shared';

interface IframeServerCardProps {
  node: BubbleData;
  runningServers: Record<string, ServerEntry[]>;
}

function extractPortFromUrl(url?: string): number | null {
  if (!url) return null;
  const m = url.match(/:(\d+)(?:\/|$)/);
  return m?.[1] ? parseInt(m[1], 10) : null;
}

async function callApi(path: string, id: string): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export const IframeServerCard = memo(function IframeServerCard({
  node,
  runningServers,
}: IframeServerCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'stop' | 'restart' | 'start' | null>(null);

  // §7.11 v2.1 — ServerEntry 가 포트 단위라 한 shellId 에 여러 entry 가 붙는다.
  // URL 에서 뽑은 port 를 우선 키로 써서 정확한 포트의 entry 를 고른다.
  const entry = useMemo<ServerEntry | null>(() => {
    const wantedShell = node.shellId;
    const wantedPort = extractPortFromUrl(node.url);
    let portMatch: ServerEntry | null = null;
    let shellMatch: ServerEntry | null = null;
    for (const entries of Object.values(runningServers)) {
      for (const e of entries) {
        if (wantedShell && e.shellId === wantedShell && wantedPort != null && e.port === wantedPort) {
          return e; // (shellId AND port) 정확 일치 — 최우선
        }
        if (wantedPort != null && e.port === wantedPort && portMatch == null) portMatch = e;
        if (wantedShell && e.shellId === wantedShell && shellMatch == null) shellMatch = e;
      }
    }
    return portMatch ?? shellMatch;
  }, [runningServers, node.shellId, node.url]);

  const serverId = entry?.id ?? null;
  // §7.11 v3.85 — 에이전트 신고로만 알게 된 서버는 기동 명령을 몰라 respawn 이 불가능하다.
  // Stop(killByPort)은 포트만 알면 되므로 그대로 활성 — 이 구분이 없으면 신고 iframe 은
  // 서버가 running 인데도 Stop 이 회색으로 잠겨 사용자가 서버를 끌 수 없었다.
  const canRespawn = entry !== null && entry.reportedOnly !== true;

  const handleRestart = useCallback(async () => {
    if (!serverId || !canRespawn || busy) return;
    setBusy('restart');
    try { await callApi('/api/restart-server', serverId); }
    catch { /* ignore — 서버가 graph_snapshot 브로드캐스트 */ }
    finally { setBusy(null); }
  }, [serverId, canRespawn, busy]);

  const handleStop = useCallback(async () => {
    if (!serverId || busy) return;
    setBusy('stop');
    try { await callApi('/api/stop-server', serverId); }
    catch { /* ignore */ }
    finally { setBusy(null); }
  }, [serverId, busy]);

  const handleStart = useCallback(async () => {
    if (!serverId || !canRespawn || busy) return;
    setBusy('start');
    // /api/restart-server 는 alive 면 kill+respawn, 아니면 그냥 spawn — Start 와 동일 동작
    try { await callApi('/api/restart-server', serverId); }
    catch { /* ignore */ }
    finally { setBusy(null); }
  }, [serverId, canRespawn, busy]);

  const alive = node.iframeAlive === true;
  const kindLabel = node.serverKind === 'frontend' ? 'FE' : node.serverKind === 'backend' ? 'BE' : '?';
  const kindClasses = node.serverKind === 'frontend'
    ? 'bg-sky-500/20 text-sky-300'
    : 'bg-amber-500/20 text-amber-300';

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-700/60 bg-gray-800/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Server</span>
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${kindClasses}`}>
            {kindLabel}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              alive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'
            }`}
          >
            {alive ? 'running' : 'stopped'}
          </span>
        </div>
      </div>

      {node.url && (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-mono text-xs text-sky-300 hover:text-sky-200 hover:underline"
          title={node.url}
        >
          {node.url}
        </a>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleRestart}
          disabled={!canRespawn || busy !== null}
          title={
            !serverId
              ? t('panel.serverList.noEntry')
              : canRespawn
                ? t('panel.serverList.restart')
                : t('panel.serverList.noCommand')
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-sky-700/60 bg-sky-900/40 px-2 py-1 text-xs text-sky-200 transition-colors hover:bg-sky-800/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg
            className={`h-3.5 w-3.5 ${busy === 'restart' ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M21 12a9 9 0 1 1-2.63-6.36M21 3v6h-6" />
          </svg>
          Restart
        </button>

        {alive ? (
          <button
            type="button"
            onClick={handleStop}
            disabled={!serverId || busy !== null}
            title={serverId ? t('panel.serverList.stop') : t('panel.serverList.noEntry')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-rose-700/60 bg-rose-900/40 px-2 py-1 text-xs text-rose-200 transition-colors hover:bg-rose-800/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={!canRespawn || busy !== null}
            title={
              !serverId
                ? t('panel.serverList.noEntry')
                : canRespawn
                  ? t('panel.serverList.start')
                  : t('panel.serverList.noCommand')
            }
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-emerald-700/60 bg-emerald-900/40 px-2 py-1 text-xs text-emerald-200 transition-colors hover:bg-emerald-800/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className={`h-3.5 w-3.5 ${busy === 'start' ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <polygon points="6,4 20,12 6,20" />
            </svg>
            Start
          </button>
        )}
      </div>
    </div>
  );
});
