import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskEdge } from '@vibisual/shared';
import { TASK_EDGE_STYLES, TASK_EDGE_TEMPLATES, TASK_EDGE_KIND_STYLES, TASK_EDGE_DEFAULTS, BUBBLE_COLORS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface TaskEdgeDetailProps {
  edge: TaskEdge;
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export function TaskEdgeDetail({ edge }: TaskEdgeDetailProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const taskEdges = useGraphStore((s) => s.taskEdges);
  const deleteTaskEdge = useGraphStore((s) => s.deleteTaskEdge);
  const openTaskEdgeEdit = useGraphStore((s) => s.openTaskEdgeEdit);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusOnNode = useGraphStore((s) => s.focusOnNode);
  const selectTaskEdge = useGraphStore((s) => s.selectTaskEdge);

  const styleCfg = TASK_EDGE_STYLES[edge.status] ?? TASK_EDGE_STYLES['idle']!;
  const isAutoArtifact = edge.bundleRole === 'auto-artifact';
  const isAutoRework = edge.bundleRole === 'auto-rework';
  const isAutoSibling = isAutoArtifact || isAutoRework;
  const bundleSibling = useMemo(() => {
    if (!edge.bundleId) return null;
    return Object.values(taskEdges).find((e) => e.bundleId === edge.bundleId && e.id !== edge.id) ?? null;
  }, [edge.bundleId, edge.id, taskEdges]);

  const sourceAgent = useMemo(() => agents.find((a) => a.id === edge.sourceAgentId), [agents, edge.sourceAgentId]);
  const targetAgent = useMemo(() => agents.find((a) => a.id === edge.targetAgentId), [agents, edge.targetAgentId]);

  const template = edge.templateId
    ? TASK_EDGE_TEMPLATES.find((t) => t.id === edge.templateId)
    : null;

  const handleJump = useCallback((agentId: string | undefined) => {
    if (!agentId) return;
    selectNode(agentId);
    focusOnNode(agentId);
  }, [selectNode, focusOnNode]);

  const handleDelete = useCallback(() => {
    deleteTaskEdge(edge.id);
    selectTaskEdge(null);
  }, [deleteTaskEdge, edge.id, selectTaskEdge]);

  const handleOpenEdit = useCallback(() => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    openTaskEdgeEdit(edge.id, centerX, centerY);
  }, [openTaskEdgeEdit, edge.id]);

  const agentColor = BUBBLE_COLORS.agent;

  return (
    <div className="flex flex-col gap-4">
      {/* Source → Target */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.flow')}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-gray-800/50 px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={() => handleJump(edge.sourceAgentId)}
            title={t('panel.taskEdgeDetail.goToSource')}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: agentColor }}
            />
            <span className="truncate">{sourceAgent?.label ?? edge.sourceAgentId}</span>
          </button>
          <span className="text-gray-500">→</span>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-gray-800/50 px-2 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={() => handleJump(edge.targetAgentId)}
            title={t('panel.taskEdgeDetail.goToTarget')}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: agentColor }}
            />
            <span className="truncate">{targetAgent?.label ?? edge.targetAgentId}</span>
          </button>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            backgroundColor: `${styleCfg.color}20`,
            color: styleCfg.color,
            border: `1px solid ${styleCfg.color}40`,
          }}
        >
          {t(`panel.taskEdgeDetail.status.${edge.status}`) || edge.status}
        </span>
        {(() => {
          const kind = edge.kind ?? TASK_EDGE_DEFAULTS.kind;
          const kStyle = TASK_EDGE_KIND_STYLES[kind];
          return (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                backgroundColor: `${kStyle.color}20`,
                color: kStyle.color,
                border: `1px solid ${kStyle.color}40`,
              }}
              title={kStyle.description}
            >
              {kStyle.icon} {kStyle.label}
            </span>
          );
        })()}
        <span
          className="rounded-full border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[11px] text-gray-300"
          title={edge.forwardMode === 'auto' ? t('panel.taskEdgeDetail.gateAutoTooltip') : t('panel.taskEdgeDetail.gateManualTooltip')}
        >
          {t('panel.taskEdgeDetail.gate', { value: edge.forwardMode === 'auto' ? t('panel.taskEdgeDetail.gateAuto') : t('panel.taskEdgeDetail.gateManual') })}
        </span>
        {template && (
          <span className="rounded-full border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[11px] text-gray-300">
            {template.label}
          </span>
        )}
      </div>

      {/* Advanced options (v1.18) — 설정된 값만 간결 표시 */}
      {(edge.messageFormat || edge.returnFormat || edge.timeoutMs !== undefined || edge.retryCount !== undefined || edge.cacheEnabled !== undefined || edge.priority) && (
        <div className="flex flex-col gap-1.5 rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">{t('panel.taskEdgeDetail.advanced')}</span>
          <div className="flex flex-wrap gap-2 text-[11px] text-gray-300">
            {edge.messageFormat && <span>{t('panel.taskEdgeDetail.format')}: <span className="text-gray-200">{edge.messageFormat}</span></span>}
            {edge.returnFormat && <span>{t('panel.taskEdgeDetail.return')}: <span className="text-gray-200">{edge.returnFormat}</span></span>}
            {edge.timeoutMs !== undefined && <span>{t('panel.taskEdgeDetail.timeout')}: <span className="text-gray-200">{edge.timeoutMs}ms</span></span>}
            {/* TODO(2026-05-13): retry/cache/priority are stored but not honored at runtime.
             *  Marked with "(coming soon)" in display. See 해보자/2026-05-13/todo.md. */}
            {edge.retryCount !== undefined && edge.retryCount > 0 && (
              <span className="text-gray-500">
                {t('panel.taskEdgeDetail.retry')}: <span className="text-gray-400">{edge.retryCount}</span>
                <span className="ml-1 text-[10px] text-amber-400/60">{t('panel.taskEdgeDetail.comingSoonSuffix')}</span>
              </span>
            )}
            {edge.cacheEnabled && (
              <span className="text-emerald-300/60">
                {t('panel.taskEdgeDetail.cacheOn')}
                <span className="ml-1 text-[10px] text-amber-400/60">{t('panel.taskEdgeDetail.comingSoonSuffix')}</span>
              </span>
            )}
            {edge.priority && edge.priority !== 'normal' && (
              <span className="text-gray-500">
                {t('panel.taskEdgeDetail.priority')}: <span className="text-gray-400">{edge.priority}</span>
                <span className="ml-1 text-[10px] text-amber-400/60">{t('panel.taskEdgeDetail.comingSoonSuffix')}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Command */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.command')}</span>
        <pre className="scrollbar-thin max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5 font-mono text-xs text-gray-200">
          {edge.command || t('panel.taskEdgeDetail.commandEmpty')}
        </pre>
      </div>

      {/* Timestamps */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.created')}</span>
          <span className="font-mono text-xs text-gray-300">{fmtTime(edge.createdAt)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.lastRun')}</span>
          <span className="font-mono text-xs text-gray-300">{fmtTime(edge.lastExecutedAt)}</span>
        </div>
      </div>

      {/* Last result / error */}
      {edge.lastResult && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{t('panel.taskEdgeDetail.lastResult')}</span>
          <pre className="scrollbar-thin max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5 font-mono text-xs text-gray-300">
            {edge.lastResult}
          </pre>
        </div>
      )}
      {edge.errorMessage && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-red-400">{t('panel.taskEdgeDetail.errorLabel')}</span>
          <pre className="scrollbar-thin max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 font-mono text-xs text-red-200">
            {edge.errorMessage}
          </pre>
        </div>
      )}

      {/* Bundle — v1.32 returnFormat='both' / v1.54 critique force-rework 자동 생성 자매 엣지 요약 */}
      {edge.bundleId && (
        <div className="flex flex-col gap-1 rounded border border-indigo-800/50 bg-indigo-950/30 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-indigo-300">{t('panel.taskEdgeDetail.bundle')}</span>
            <span className="rounded-full border border-indigo-700 bg-indigo-900/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-200">
              {isAutoSibling
                ? t('panel.taskEdgeDetail.bundleAutoGenerated')
                : t('panel.taskEdgeDetail.bundlePrimary')}
            </span>
          </div>
          {bundleSibling ? (
            <div className="text-[11px] text-indigo-100">
              {isAutoArtifact
                ? t('panel.taskEdgeDetail.bundleAutoArtifactDesc')
                : isAutoRework
                  ? t('panel.taskEdgeDetail.bundleAutoReworkDesc')
                  : edge.kind === 'critique'
                    ? t('panel.taskEdgeDetail.bundleForceReworkDesc')
                    : t('panel.taskEdgeDetail.bundleBothDesc')}
            </div>
          ) : (
            <div className="text-[11px] text-indigo-100/70">{t('panel.taskEdgeDetail.bundleOrphan')}</div>
          )}
        </div>
      )}

      {/* v1.55 — Critique primary 엣지의 런타임 rework 사이클 진행도 + 강등 알림 */}
      {edge.kind === 'critique' && (edge.bundleRole ?? 'primary') === 'primary' && (
        <div className="flex flex-col gap-1 rounded border border-violet-800/50 bg-violet-950/20 px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-violet-300">
              {t('panel.taskEdgeDetail.critiqueCycle')}
            </span>
            <span className="font-mono text-[11px] text-violet-100">
              {(edge.reworkCount ?? 0) === 0
                ? t('panel.taskEdgeDetail.critiqueCycleFresh')
                : t('panel.taskEdgeDetail.critiqueCycleValue', {
                    count: edge.reworkCount ?? 0,
                    max: edge.maxReworkCount ?? 3,
                  })}
            </span>
          </div>
          {(edge.critiqueAuthority ?? 'force-rework') === 'comment-only' && (edge.reworkCount ?? 0) > 0 && (
            <div className="text-[10px] text-amber-300">
              {t('panel.taskEdgeDetail.critiqueEscalated')}
            </div>
          )}
        </div>
      )}

      {/* Actions — v1.54: auto-sibling 은 선택만 허용, 편집/삭제 차단(primary 에서만 가능) */}
      <div className="flex flex-wrap gap-1.5 border-t border-gray-800 pt-3">
        {isAutoSibling ? (
          <div className="w-full rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5 text-[11px] text-gray-400">
            {t('panel.taskEdgeDetail.autoSiblingReadOnly')}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
              onClick={handleOpenEdit}
            >
              {t('panel.taskEdgeDetail.edit')}
            </button>
            <button
              type="button"
              className="ml-auto rounded border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
              onClick={handleDelete}
              title={edge.bundleId ? t('panel.taskEdgeDetail.deleteBundleTooltip') : t('panel.taskEdgeDetail.deleteEdgeTooltip')}
            >
              {t('panel.taskEdgeDetail.delete')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
