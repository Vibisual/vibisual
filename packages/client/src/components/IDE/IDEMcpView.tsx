/**
 * IDEMcpView.tsx — §5.5 #17-31: 이 프로젝트에서 쓸 수 있는 MCP 를 보고, 그 자리에서 켠다.
 *
 * 활동바 첫 항목(종전 `터미널` = 세션 목록)의 자리다. 세션 목록은 탭 바(#17-5)와 세션 요약
 * (#17-8)이 이미 두 벌로 보여 주고 있었고, 앱 안에서 확인할 길이 전혀 없던 것은 "이 프로젝트에
 * MCP 가 무엇이 붙어 있고 무엇이 켜져 있는가" 였다.
 *
 * 화면이 지키는 것 셋:
 *   ① **어디서 왔는지 말한다** — 글로벌 / 로컬 / 프로젝트(`.mcp.json`) / 프리셋을 묶어 세운다.
 *   ② **꺼짐과 승인 대기를 구분한다** — 사용자가 할 일이 다르다.
 *   ③ **켜기까지 남은 일을 적는다** — 켰는데 안 되는 이유를 화면에서 읽을 수 있어야 한다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, McpInventory, McpServerEntry, McpServerScope } from '@vibisual/shared';
import { findMcpPreset } from '@vibisual/shared';

import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';

import { useIDEProjectRoot } from './useIDEProjectRoot.js';

/** 묶음 순서 — 넓은 범위에서 좁은 범위로, 우리 것(프리셋)은 맨 뒤. */
const SCOPE_ORDER: McpServerScope[] = ['global', 'project', 'local', 'preset'];

/** 범위 칩 색 — "어디에 적혀 있는가" 를 색으로도 갈라 준다(#17-20 의 출처 칩과 같은 규약). */
const SCOPE_TONE: Record<McpServerScope, string> = {
  global: 'bg-sky-500/15 text-sky-300',
  project: 'bg-emerald-500/15 text-emerald-300',
  local: 'bg-violet-500/15 text-violet-300',
  preset: 'bg-amber-500/15 text-amber-300',
};

/** 상태 점 — 켜짐(초록) / 승인 대기(호박) / 꺼짐(회색). */
const STATE_DOT: Record<McpServerEntry['state'], string> = {
  enabled: 'bg-emerald-400',
  pending: 'bg-amber-400',
  disabled: 'bg-gray-600',
};

function RefreshIcon({ spinning }: { spinning: boolean }): React.JSX.Element {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** 켜기까지 남은 일 한 줄. 정책 차단만 붉게(우리가 풀 수 없는 유일한 사유), 나머지는 호박색. */
function RequirementLine({ entry }: { entry: McpServerEntry }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (entry.requirements.length === 0 && !entry.requiresKey) return null;
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5">
      {entry.requirements.map((req) => (
        <li
          key={`${req.kind}-${req.detail ?? ''}`}
          className={`text-[9px] leading-snug ${req.kind === 'policy' ? 'text-rose-400/90' : 'text-amber-400/85'}`}
        >
          {t(`ide.mcp.req.${req.kind}`, { detail: req.detail ?? '', name: entry.name })}
        </li>
      ))}
      {/* 프리셋의 사전 조건 안내(#17-20 ⑥)도 같은 자리에 선다. */}
      {entry.requiresKey && (
        <li className="text-[9px] leading-snug text-amber-400/85">{t(entry.requiresKey)}</li>
      )}
    </ul>
  );
}

export const IDEMcpView = memo(function IDEMcpView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const config = useGraphStore((s) => s.agentConfigs[agentId]) as AgentConfig | undefined;
  const projectId = useGraphStore((s) => selectIDEOverlay(s).projectId);

  const [inventory, setInventory] = useState<McpInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 목록 조회 — 서버가 매번 디스크를 다시 읽으므로 이 호출 하나가 곧 새로고침이다.
   * 프리셋 줄의 켜짐은 파일이 아니라 이 에이전트의 설정이 진실이라 `agentId` 를 함께 보낸다.
   */
  const load = useCallback(() => {
    if (!rootPath) {
      setInventory(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/mcp-servers?root=${encodeURIComponent(rootPath)}&agentId=${encodeURIComponent(agentId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: McpInventory) => setInventory(data))
      .catch(() => {
        setInventory(null);
        setError(t('ide.mcp.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [rootPath, agentId, t]);

  // 뷰를 열 때 · 프로젝트가 바뀔 때 다시 읽는다(#17-31 ⑥).
  useEffect(() => { load(); }, [load, projectId]);

  /**
   * 토글. 범위마다 진실이 사는 곳이 달라 통로도 갈린다 —
   *   글로벌·로컬·프로젝트 → `~/.claude.json` 의 그 프로젝트 엔트리(서버가 쓴다)
   *   프리셋              → `AgentConfig.mcpServers`(#17-20 ⑥ 이 이미 쓰는 그 통로)
   * ⚠ agent-config PUT 은 body 로 config 를 전량 재구축하므로 **항상 전체를 보낸다**.
   */
  const handleToggle = useCallback(
    (entry: McpServerEntry) => {
      if (!rootPath || !entry.toggleable) return;
      const next = entry.state !== 'enabled';
      setBusyId(entry.id);
      setError(null);

      if (entry.scope === 'preset') {
        if (!config) { setBusyId(null); return; }
        const current = config.mcpServers ?? [];
        const ids = next ? [...new Set([...current, entry.name])] : current.filter((id) => id !== entry.name);
        fetch(`/api/agent-config/${agentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...config, mcpServers: ids }),
        })
          .then((r) => (r.ok ? null : Promise.reject(new Error(String(r.status)))))
          .then(() => load())
          .catch(() => setError(t('ide.mcp.toggleFailed')))
          .finally(() => setBusyId(null));
        return;
      }

      fetch('/api/mcp-servers/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootPath, scope: entry.scope, name: entry.name, enabled: next, agentId }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { inventory?: McpInventory }) => {
          // 서버가 갱신된 인벤토리를 함께 주므로 다시 묻지 않는다.
          if (data.inventory) setInventory(data.inventory);
          else load();
        })
        .catch(() => setError(t('ide.mcp.toggleFailed')))
        .finally(() => setBusyId(null));
    },
    [rootPath, agentId, config, load, t],
  );

  /** 범위별로 갈라 담되, 빈 묶음은 그리지 않는다(프리셋은 늘 있으므로 항상 한 묶음은 선다). */
  const grouped = useMemo(() => {
    const servers = inventory?.servers ?? [];
    return SCOPE_ORDER
      .map((scope) => ({ scope, items: servers.filter((s) => s.scope === scope) }))
      .filter((g) => g.items.length > 0);
  }, [inventory]);

  const enabledCount = useMemo(
    () => (inventory?.servers ?? []).filter((s) => s.state === 'enabled').length,
    [inventory],
  );
  /** 설정 파일에서 온 것만 센다 — 프리셋은 늘 4줄이라 "이 프로젝트에 몇 개 붙어 있나"를 가린다. */
  const fileServerCount = useMemo(
    () => (inventory?.servers ?? []).filter((s) => s.scope !== 'preset').length,
    [inventory],
  );

  if (!rootPath) {
    return (
      <div className="p-3 text-[10.5px] leading-relaxed text-gray-500">{t('ide.mcp.noProject')}</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — 제목 + 켜진 수/전체 + 새로고침(#17-31 ⑥) */}
      <div className="flex items-center gap-1 border-b border-gray-700/60 px-2 py-1.5">
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.mcp.title')}
        </span>
        {inventory && (
          <span className="rounded bg-gray-700/60 px-1 text-[9px] font-bold tabular-nums text-gray-300">
            {enabledCount}/{inventory.servers.length}
          </span>
        )}
        <button
          type="button"
          onClick={load}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.mcp.refresh')}
          aria-label={t('ide.mcp.refresh')}
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {error && <p className="px-1 text-[10px] leading-snug text-rose-400">{error}</p>}

          {/* 설정 파일에서 온 서버가 하나도 없으면 "없다"고 적고, 붙이는 법을 알려 준다. */}
          {inventory && fileServerCount === 0 && (
            <p className="px-1 text-[10px] leading-relaxed text-gray-500">
              {t('ide.mcp.empty')}
              <code className="ml-1 rounded bg-gray-800 px-1 py-0.5 text-[9.5px] text-gray-300">claude mcp add</code>
            </p>
          )}

          {/* 전부 자동 승인 상태면 그렇게 말해 준다 — 안 그러면 "승인 대기가 왜 없지" 가 된다. */}
          {inventory?.autoApproveProject && (
            <p className="px-1 text-[9.5px] leading-snug text-sky-400/80">{t('ide.mcp.autoApprove')}</p>
          )}

          {grouped.map((group) => (
            <section key={group.scope}>
              <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <span>{t(`ide.mcp.scope.${group.scope}`)}</span>
                <span className="text-gray-600">({group.items.length})</span>
              </h3>
              <p className="mb-1 px-1 text-[9px] leading-snug text-gray-600">{t(`ide.mcp.scopeHint.${group.scope}`)}</p>
              <ul className="flex flex-col gap-1">
                {group.items.map((entry) => {
                  const on = entry.state === 'enabled';
                  const busy = busyId === entry.id;
                  // 프리셋만은 id 대신 사람이 읽는 이름을 쓴다(#17-20 ⑥ 의 `labelKey`).
                  //   나머지 범위의 이름은 사용자가 직접 지은 것이라 번역 대상이 아니다.
                  const preset = entry.presetId ? findMcpPreset(entry.presetId) : undefined;
                  const label = preset ? t(preset.labelKey) : entry.name;
                  const subtitle = preset
                    ? preset.name
                    : (entry.url ?? [entry.command, ...(entry.args ?? [])].filter(Boolean).join(' '));
                  return (
                    <li key={entry.id} className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATE_DOT[entry.state]}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-gray-200" title={entry.name}>
                              {label}
                            </span>
                            <span className={`flex-shrink-0 rounded px-1 text-[8.5px] font-semibold uppercase ${SCOPE_TONE[entry.scope]}`}>
                              {t(`ide.mcp.scopeShort.${entry.scope}`)}
                            </span>
                          </span>
                          {/* 무엇으로 붙는가 — stdio 는 명령, 원격은 주소. 원문 그대로(번역 ❌). */}
                          <span className="mt-0.5 block truncate text-[9px] text-gray-500" title={subtitle}>
                            {subtitle}
                          </span>
                        </span>
                        {/* 켜기/끄기 — 정책이 막은 줄은 버튼 대신 이유(RequirementLine)만 남는다. */}
                        {entry.toggleable && (
                          <button
                            type="button"
                            onClick={() => handleToggle(entry)}
                            disabled={busy || (entry.scope === 'preset' && !config)}
                            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              on
                                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-600/60'
                            }`}
                            title={t(`ide.mcp.state.${entry.state}`)}
                          >
                            {/* 버튼은 **지금 상태**가 아니라 **누르면 벌어지는 일**을 적는다. */}
                            {t(on ? 'ide.mcp.turnOff' : 'ide.mcp.turnOn')}
                          </button>
                        )}
                      </div>

                      <RequirementLine entry={entry} />

                      <div className="mt-0.5 flex items-center gap-2">
                        {/* 어디에 적혀 있는지 — 눌러서 여는 것이 아니라 "여기서 왔다"는 표기다. */}
                        <span className="min-w-0 flex-1 truncate text-[8.5px] text-gray-600" title={entry.sourceFile}>
                          {entry.sourceFile}
                        </span>
                        {entry.docsUrl && (
                          <a
                            href={entry.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0 text-[9px] text-sky-400 hover:text-sky-300 hover:underline"
                          >
                            {t('ide.mcp.docs')}
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/* 발치 — 켜고 끈 것이 언제 적용되는지 한 번만 말한다(줄마다 반복하지 않는다). */}
          {inventory && inventory.servers.length > 0 && (
            <p className="px-1 text-[9px] leading-snug text-gray-600">{t('ide.mcp.applyHint')}</p>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});
