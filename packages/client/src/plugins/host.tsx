/**
 * §5.11 — 플러그인 호스트(클라). 코어는 슬롯 컴포넌트만 안다. 활성 판정 SSOT = `UserDefaults.enabledPluginsByProject`(프로젝트별, WS `user_defaults_updated` 로 반영).
 * 비활성은 기여 미등록일 뿐 데이터 삭제가 아니다. 슬롯은 바깥(사전 판정)·안쪽(무거운 훅)으로 갈라, 낼 기여가 없으면 안쪽을 안 그린다.
 * **훅은 반드시 안쪽 컴포넌트에** — 바깥에 넣으면 버블마다 구독이 열린다.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig, BubbleType } from '@vibisual/shared';
import type {
  PluginActions,
  PluginAgentData,
  PluginBubbleContext,
  PluginClientModule,
  PluginHeaderContext,
  PluginSeverity,
  PluginTranslate,
} from '@vibisual/plugins';
import { hasOwnToggle, resolveEnabledPluginsFor } from '@vibisual/plugins';
import { PLUGIN_CLIENT_MODULES } from '@vibisual/plugins/client';
import { useGraphStore, selectActiveAutoGoalSummary, selectActivePluginFacts, selectActivePluginProjectPath } from '../stores/graphStore.js';
import { orderPanelSections } from './panelOrder.js';
import { clientPathPlatform } from '../utils/platform.js';
import { PluginErrorBoundary } from './PluginErrorBoundary.js';
import { tryBuild } from './isolate.js';
import { modulesForSlot } from './slots.js';
import { useMinuteNow } from './minuteClock.js';
import { useStableSlice } from './stableSlice.js';


/** i18next `t` 는 문자열 아닌 결과 타입도 가지므로 플러그인 계약("키를 주면 문자열")으로 여기서 한 번 좁힌다. */
export function usePluginTranslate(): PluginTranslate {
  const { t } = useTranslation();
  return useMemo(
    () => (key: string, options?: Record<string, unknown>) =>
      (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options),
    [t],
  );
}

/** 켬/끔은 프로젝트별이라 보고 있는 프로젝트가 판정에 들어간다. 두 조각만 구독한다 — `userDefaults` 통짜면 옵션 한 글자에도 모든 버블이 다시 계산된다. */
export function useActivePluginModules(): PluginClientModule[] {
  const byProject = useGraphStore((s) => s.userDefaults?.enabledPluginsByProject);
  const legacyGlobal = useGraphStore((s) => s.userDefaults?.enabledPlugins);
  const projectPath = useGraphStore(selectActivePluginProjectPath);
  return useMemo(() => {
    const active = resolveEnabledPluginsFor(
      { enabledPluginsByProject: byProject, enabledPlugins: legacyGlobal },
      projectPath,
      clientPathPlatform(),
    );
    // §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드는 켬 집합을 묻지 않는다. 카드는 계기판이지
    //   스위치가 아니라서, 목록에서 내렸다고 버블의 계기판까지 사라지면 켠 결과를 볼 자리가 없어진다.
    return PLUGIN_CLIENT_MODULES.filter((m) => hasOwnToggle(m.manifest) || active.has(m.manifest.id));
  }, [byProject, legacyGlobal, projectPath]);
}

interface BubbleSlotProps {
  bubbleId: string;
  bubbleType: BubbleType;
  label: string;
  customCreated: boolean;
  agentConfig: AgentConfig | undefined;
}

/** 활성 모듈이 선언한 데이터만 꺼낸다 — 전부 실어 보내지 마라(요청 없는 축은 안 읽어야 캔버스가 무거워지지 않는다). */
function usePluginData(modules: PluginClientModule[], bubbleId: string): PluginAgentData {
  const needs = useMemo(() => new Set(modules.flatMap((m) => m.needs ?? [])), [modules]);

  const agentEvents = useGraphStore((s) => (needs.has('agentEvents') ? s.agentEvents[bubbleId] : undefined));
  const subAgents = useGraphStore((s) => (needs.has('subAgents') ? s.subAgents[bubbleId] : undefined));
  const runningTasks = useGraphStore((s) => (needs.has('runningTasks') ? s.runningSubagentTasks[bubbleId] : undefined));
  const agentReports = useGraphStore((s) => (needs.has('agentReports') ? s.agentReports[bubbleId] : undefined));
  const agentReviews = useGraphStore((s) => (needs.has('agentReviews') ? s.agentReviews[bubbleId] : undefined));
  // §5.10 — 되풀이가 절차로 굳은 정도. 프로젝트 단위라 버블과 무관하게 같은 값이 온다.
  const autoGoal = useGraphStore((s) => (needs.has('autoGoal') ? selectActiveAutoGoalSummary(s) : undefined));
  // §5.11 — 집행이 실제로 무엇을 보고 판단했는지(프로젝트 단위 — 버블과 무관하게 같은 값).
  const pluginFacts = useGraphStore((s) => (needs.has('pluginFacts') ? selectActivePluginFacts(s) : undefined));
  const captureBubbles = useGraphStore((s) => (needs.has('captureBubbles') ? s.captureBubbles : undefined));
  // bash 는 세션 id 로 저장돼 있고 에이전트는 자기 세션 목록을 갖고 있다 — 여기서 그 둘을 잇는다.
  const bashStore = useGraphStore((s) => (needs.has('bashCommands') ? s.bashHistory : undefined));
  const sessionsForBash = useGraphStore((s) => (needs.has('bashCommands') ? s.subAgents[bubbleId] : undefined));
  // 통짜 구독이라 남의 세션 명령 하나에도 신원이 바뀐다 — 이 버블 몫이 그대로면 지난 배열을 그대로 쓴다.
  const bashCommands = useStableSlice(useMemo(() => {
    if (!bashStore) return undefined;
    const out = [];
    for (const sub of sessionsForBash ?? []) {
      const entries = sub.sessionId ? bashStore[sub.sessionId] : undefined;
      if (entries) out.push(...entries);
    }
    return out;
  }, [bashStore, sessionsForBash]));
  // Task Edge 는 엣지 id 로 저장돼 있어 이 버블이 양끝 중 하나인 것만 골라 넘긴다.
  const allTaskEdges = useGraphStore((s) => (needs.has('taskEdges') ? s.taskEdges : undefined));
  const taskEdges = useStableSlice(useMemo(
    () =>
      allTaskEdges
        ? Object.values(allTaskEdges).filter((e) => e.sourceAgentId === bubbleId || e.targetAgentId === bubbleId)
        : undefined,
    [allTaskEdges, bubbleId],
  ));

  return useMemo(
    () => ({ agentEvents, subAgents, runningTasks, agentReports, agentReviews, autoGoal, taskEdges, captureBubbles, bashCommands, pluginFacts }),
    [agentEvents, subAgents, runningTasks, agentReports, agentReviews, autoGoal, taskEdges, captureBubbles, bashCommands, pluginFacts],
  );
}

function useBubbleContext(props: BubbleSlotProps, modules: PluginClientModule[]): PluginBubbleContext {
  const t = usePluginTranslate();
  const { bubbleId, bubbleType, label, customCreated, agentConfig } = props;
  const data = usePluginData(modules, bubbleId);
  // 분 단위로 굳힌 '지금'. `useMemo(…, [])` 로 바꾸지 마라 — 마운트 시점에 굳어 영영 안 바뀐다(§5.11).
  const now = useMinuteNow();
  return useMemo(
    () => ({ bubbleId, bubbleType, label, customCreated, agentConfig, data, now, t }),
    [bubbleId, bubbleType, label, customCreated, agentConfig, data, now, t],
  );
}

/** 버블 우하단 배지 슬롯(여럿이면 가로로). 컨테이너는 `pointer-events-none`, 배지만 `auto` — 툴팁은 뜨되 드래그는 안 막는다. */
export function PluginBubbleBadgeSlot(props: BubbleSlotProps): React.JSX.Element | null {
  const modules = useActivePluginModules();
  const badgeModules = useMemo(() => modulesForSlot(modules, 'bubbleBadge'), [modules]);
  // 모든 버블 안에 들어가므로 배지 모듈이 없으면 여기서 끝낸다 — 안쪽이 버블마다 스토어 구독 열두 개를 연다(§5.11).
  if (badgeModules.length === 0) return null;
  return <BadgeSlotInner {...props} modules={badgeModules} />;
}

function BadgeSlotInner(props: BubbleSlotProps & { modules: PluginClientModule[] }): React.JSX.Element | null {
  const { modules } = props;
  const ctx = useBubbleContext(props, modules);

  const badges = useMemo(
    () =>
      modules.flatMap((m) =>
        (m.bubbleBadges ?? []).flatMap((b) => {
          const built = tryBuild(m.manifest.id, () => (b.match(ctx) ? b.render(ctx) : null));
          return built === null ? [] : [{ id: `${m.manifest.id}:${b.key}`, pluginId: m.manifest.id, node: built }];
        }),
      ),
    [modules, ctx],
  );

  if (badges.length === 0) return null;

  return (
    <div className="pointer-events-none absolute z-20 flex items-center gap-1" style={{ bottom: -2, right: -2 }}>
      {badges.map((b) => (
        <PluginErrorBoundary key={b.id} pluginId={b.pluginId}>
          <span>{b.node}</span>
        </PluginErrorBoundary>
      ))}
    </div>
  );
}

/**
 * DetailPanel 섹션 슬롯 — 심각도 순으로 문제부터 위로, 경고 아닌 카드가 문턱을 넘게 많으면 접는다.
 * 정렬 근거는 카드가 렌더 전에 알려 주는 `severity` 뿐이다(호스트는 카드 내용을 열어 보지 않는다).
 */
export function PluginPanelSectionSlot(props: BubbleSlotProps): React.JSX.Element | null {
  const modules = useActivePluginModules();
  const panelModules = useMemo(() => modulesForSlot(modules, 'panelSection'), [modules]);
  if (panelModules.length === 0) return null;
  return <PanelSlotInner {...props} modules={panelModules} />;
}

function PanelSlotInner(props: BubbleSlotProps & { modules: PluginClientModule[] }): React.JSX.Element | null {
  const { modules } = props;
  const ctx = useBubbleContext(props, modules);
  const [expanded, setExpanded] = useState(false);

  const sections = useMemo(
    () =>
      modules.flatMap((m) =>
        (m.panelSections ?? []).flatMap((s) => {
          const built = tryBuild(m.manifest.id, () =>
            s.match(ctx)
              ? {
                  id: `${m.manifest.id}:${s.key}`,
                  pluginId: m.manifest.id,
                  severity: s.severity?.(ctx) ?? ('neutral' as PluginSeverity),
                  node: s.render(ctx),
                }
              : null,
          );
          return built === null ? [] : [built];
        }),
      ),
    [modules, ctx],
  );

  const { shown, hidden, collapsible } = useMemo(
    () => orderPanelSections(sections, expanded),
    [sections, expanded],
  );

  if (sections.length === 0) return null;

  return (
    <>
      {shown.map((s) => (
        <PluginErrorBoundary key={s.id} pluginId={s.pluginId}>
          <div>{s.node}</div>
        </PluginErrorBoundary>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
        >
          {ctx.t('panel.plugins.showMore', { count: hidden })}
        </button>
      )}
      {expanded && collapsible && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
        >
          {ctx.t('panel.plugins.showLess')}
        </button>
      )}
    </>
  );
}

/** 플러그인이 부를 수 있는 동작들(기존 정지 경로 조합). 예약된 루프까지 끊는다 — 실행만 죽이면 스케줄러가 다음 회차를 띄운다. */
function usePluginActions(): PluginActions {
  return useMemo<PluginActions>(
    () => ({
      stopEverything: async () => {
        const state = useGraphStore.getState();
        const agentIds = Object.keys(state.subAgents).filter((id) => (state.subAgents[id] ?? []).length > 0);
        await Promise.all(
          agentIds.map(async (agentId) => {
            // ① 예약을 먼저 끊는다 — 실행만 죽이면 루프가 다음 회차를 다시 띄운다.
            await Promise.all(
              (state.subAgents[agentId] ?? []).map((sub) =>
                fetch(`/api/session-loop/${agentId}/${sub.id}`, { method: 'DELETE' }).catch(() => undefined),
              ),
            );
            // ② 그다음 돌고 있는 세션을 멈춘다.
            await fetch(`/api/subagents/${agentId}/stop-all`, { method: 'POST' }).catch(() => undefined);
          }),
        );
        return agentIds.length;
      },
    }),
    [],
  );
}

/** 헤더 기여 슬롯 — 버블에 매이지 않는 전역 항목. 활성 기여가 없으면 DOM 을 만들지 않는다. */
export function PluginHeaderSlot(): React.JSX.Element | null {
  const modules = useActivePluginModules();
  const headerModules = useMemo(() => modulesForSlot(modules, 'headerItem'), [modules]);
  // 헤더 항목을 내는 카드는 지금 `kill-switch` 하나뿐이다 — 안 켜져 있으면 살아 있는 세션 수를
  // 세는 구독조차 열지 않는다(그 선택자는 전체 subAgents 를 훑는다).
  if (headerModules.length === 0) return null;
  return <HeaderSlotInner modules={headerModules} />;
}

function HeaderSlotInner({ modules }: { modules: PluginClientModule[] }): React.JSX.Element | null {
  const t = usePluginTranslate();
  const actions = usePluginActions();
  const liveAgents = useGraphStore(
    (s) => Object.values(s.subAgents).filter((list) => (list ?? []).length > 0).length,
  );
  const now = useMinuteNow();

  const ctx = useMemo<PluginHeaderContext>(
    () => ({ t, now, liveAgents, actions }),
    [t, now, liveAgents, actions],
  );

  const items = useMemo(
    () =>
      modules.flatMap((m) =>
        (m.headerItems ?? []).flatMap((i) => {
          const built = tryBuild(m.manifest.id, () => ((i.match?.(ctx) ?? true) ? i.render(ctx) : null));
          return built === null ? [] : [{ id: `${m.manifest.id}:${i.key}`, pluginId: m.manifest.id, node: built }];
        }),
      ),
    [modules, ctx],
  );

  if (items.length === 0) return null;

  // `app-nodrag` — 이 슬롯은 헤더(`app-drag`) 안에서 그려진다. 빠져나오지 않으면 그 자리가 OS
  // 캡션이라 카드가 낸 버튼에 **손짓이 도착하지 않는다**(눌러도 창만 끌린다). 헤더의 다른 항목들이
  // 전부 `app-nodrag` 인 것과 같은 이유다.
  return (
    <div className="app-nodrag flex items-center gap-1">
      {items.map((i) => (
        <PluginErrorBoundary key={i.id} pluginId={i.pluginId}>
          <span>{i.node}</span>
        </PluginErrorBoundary>
      ))}
    </div>
  );
}
