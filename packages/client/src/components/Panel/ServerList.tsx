import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerEntry } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

interface ServerListProps {
  servers: ServerEntry[];
}

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function handleOpenBrowser(port: number): void {
  // 패키지 Electron renderer 는 file:// 로 로드돼 window.location.hostname 이 빈 문자열이다
  // (http://:<port> 로 깨짐) → 'localhost' 고정. main 의 setWindowOpenHandler 가
  // shell.openExternal 로 외부 브라우저에 연다.
  window.open(`http://localhost:${port}`, '_blank');
}

function serverName(entry: ServerEntry): string {
  if (entry.port) return `localhost:${entry.port}`;
  const cmd = entry.command.trim();
  const last = cmd.split('&&').pop()?.trim() ?? cmd;
  return last.length > 30 ? last.slice(0, 30) + '…' : last;
}

async function callApi(path: string, body?: Record<string, unknown>): Promise<void> {
  await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // 서버가 broadcast(graph_snapshot) 하므로 store 갱신은 WebSocket이 처리
}

export const ServerList = memo(function ServerList({
  servers,
}: ServerListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);

  // id 중복 방어 — 서버 측 dedup이 깨져도 React key 경고 방지.
  // §7.11 v2.4 — 스냅샷은 죽은 ServerEntry 도 싣는다(IframeServerCard 의 Start/Restart
  // 매칭용). ServerList 는 §7.11 v2.1 "alive-only" 계약대로 살아있는 서버만 표시한다.
  const uniqueServers = Array.from(
    new Map(servers.map((s) => [s.id, s])).values(),
  ).filter((s) => s.alive);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await callApi('/api/refresh-servers'); }
    catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);

  const handleStop = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStopping(id);
    try { await callApi('/api/stop-server', { id }); }
    catch { /* ignore */ }
    finally { setStopping(null); }
  }, []);

  const handleRestart = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStopping(id);
    try { await callApi('/api/restart-server', { id }); }
    catch { /* ignore */ }
    finally { setStopping(null); }
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {t('panel.serverList.heading', { count: uniqueServers.length })}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40"
        >
          <svg
            className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M21 12a9 9 0 1 1-2.63-6.36M21 3v6h-6" />
          </svg>
          {t('panel.serverList.refresh')}
        </button>
      </div>

      {uniqueServers.length === 0 ? (
        <p className="py-1 text-[10px] text-gray-600">{t('panel.serverList.empty')}</p>
      ) : (
      <ScrollFade maxHeight={160}><ul className="flex flex-col gap-1.5">
        {uniqueServers.map((s) => (
          <li
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => s.port && handleOpenBrowser(s.port)}
            onKeyDown={(e) => e.key === 'Enter' && s.port && handleOpenBrowser(s.port)}
            className={`flex items-center justify-between rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5 transition-colors ${s.port ? 'cursor-pointer hover:border-gray-600 hover:bg-gray-700/60' : ''}`}
            title={s.command}
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-gray-200">
                {serverName(s)}
              </span>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                <span>{formatUptime(s.startedAt)}</span>
                {s.alive && <span className="text-emerald-400/80">{t('panel.serverList.running')}</span>}
              </div>
            </div>

            {/* Restart button */}
            <button
              type="button"
              onClick={(e) => handleRestart(s.id, e)}
              disabled={stopping === s.id}
              className="ml-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-blue-500/20 hover:text-blue-400 disabled:opacity-40"
              title={t('panel.serverList.restart')}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M21 12a9 9 0 1 1-2.63-6.36M21 3v6h-6" />
              </svg>
            </button>

            {/* Stop button */}
            <button
              type="button"
              onClick={(e) => handleStop(s.id, e)}
              disabled={stopping === s.id}
              className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:opacity-40"
              title={t('panel.serverList.stop')}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          </li>
        ))}
      </ul></ScrollFade>
      )}
    </div>
  );
});
