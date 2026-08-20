/**
 * §5.11 v3.88 — 플러그인 호스트 (클라이언트).
 *
 * 코어는 이 파일의 **슬롯 컴포넌트만** 알면 된다. 어떤 플러그인이 무엇을 그리는지는 코어가 몰라야
 * 플러그인이 늘어도 코어 파일이 자라지 않는다(§5.11 을 만든 이유 자체).
 *
 * - 활성 판정 SSOT = `UserDefaults.enabledPluginsByProject`(**프로젝트별**, 서버 저장, WS `user_defaults_updated` 로 즉시 반영).
 * - 비활성 = 기여 미등록일 뿐 **데이터 삭제 아님**. 다시 켜면 그대로 돌아온다.
 * - 기여가 하나도 없으면 **DOM 을 아예 만들지 않는다**(빈 래퍼조차 남기지 않아 캔버스 렌더 비용 0).
 *
 * ⚠ 마지막 줄은 오래 **사실이 아니었다**(v4.30 에서 고침). 슬롯이 한 컴포넌트였을 때는 `return null`
 * 앞에서 이미 훅이 다 돌아, 켠 플러그인이 하나도 없어도 버블마다 스토어 구독 열두 개가 열렸다. 지금은
 * 슬롯을 바깥(사전 판정)과 안쪽(무거운 훅)으로 갈라, 낼 기여가 없으면 안쪽을 아예 그리지 않는다.
 * **슬롯에 훅을 추가할 때는 반드시 안쪽 컴포넌트에 넣을 것** — 바깥에 넣으면 그 비용이 다시 전역이 된다.
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
import { resolveEnabledPluginsFor } from '@vibisual/plugins';
import { PLUGIN_CLIENT_MODULES } from '@vibisual/plugins/client';
import { useGraphStore, selectActiveBrainSummary, selectActivePluginFacts, selectActivePluginProjectPath } from '../stores/graphStore.js';
import { orderPanelSections } from './panelOrder.js';
import { PluginErrorBoundary } from './PluginErrorBoundary.js';
import { tryBuild } from './isolate.js';
import { modulesForSlot } from './slots.js';
import { useMinuteNow } from './minuteClock.js';
import { useStableSlice } from './stableSlice.js';


/**
 * 플러그인에 넘길 번역 함수.
 *
 * i18next 의 `t` 는 옵션에 따라 문자열이 아닌 결과 타입도 가질 수 있어 그대로는 좁혀지지 않는다.
 * 플러그인 계약은 "키를 주면 문자열"이라는 단순한 형태여야 하므로 여기서 한 번만 좁혀 준다.
 */
export function usePluginTranslate(): PluginTranslate {
  const { t } = useTranslation();
  return useMemo(
    () => (key: string, options?: Record<string, unknown>) =>
      (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options),
    [t],
  );
}

/**
 * 지금 활성인 클라이언트 기여 모듈들.
 *
 * v4.54 부터 켬/끔은 **프로젝트별**이라, 어느 프로젝트를 보고 있느냐가 판정에 들어간다. 프로젝트를
 * 옮기면 배지·패널이 그 프로젝트에서 켠 것으로 즉시 갈아탄다(창을 다시 열 필요 없음).
 *
 * 구독은 필요한 두 조각만 잡는다 — `userDefaults` 통짜를 구독하면 다른 옵션 한 글자에도 모든 버블의
 * 기여 맵이 다시 계산된다.
 */
export function useActivePluginModules(): PluginClientModule[] {
  const byProject = useGraphStore((s) => s.userDefaults?.enabledPluginsByProject);
  const legacyGlobal = useGraphStore((s) => s.userDefaults?.enabledPlugins);
  const projectPath = useGraphStore(selectActivePluginProjectPath);
  return useMemo(() => {
    const active = resolveEnabledPluginsFor(
      { enabledPluginsByProject: byProject, enabledPlugins: legacyGlobal },
      projectPath,
    );
    return PLUGIN_CLIENT_MODULES.filter((m) => active.has(m.manifest.id));
  }, [byProject, legacyGlobal, projectPath]);
}

interface BubbleSlotProps {
  bubbleId: string;
  bubbleType: BubbleType;
  label: string;
  customCreated: boolean;
  agentConfig: AgentConfig | undefined;
}

/**
 * 활성 모듈들이 선언한 데이터만 스토어에서 꺼낸다.
 *
 * 아무도 요청하지 않으면 구독 자체가 값을 안 읽어 렌더 비용이 0 에 가깝다 — 플러그인이 늘어도
 * 캔버스가 무거워지지 않게 하는 지점이라, 여기서 전부 실어 보내는 편의를 택하면 안 된다.
 */
function usePluginData(modules: PluginClientModule[], bubbleId: string): PluginAgentData {
  const needs = useMemo(() => new Set(modules.flatMap((m) => m.needs ?? [])), [modules]);

  const agentEvents = useGraphStore((s) => (needs.has('agentEvents') ? s.agentEvents[bubbleId] : undefined));
  const subAgents = useGraphStore((s) => (needs.has('subAgents') ? s.subAgents[bubbleId] : undefined));
  const runningTasks = useGraphStore((s) => (needs.has('runningTasks') ? s.runningSubagentTasks[bubbleId] : undefined));
  const agentReports = useGraphStore((s) => (needs.has('agentReports') ? s.agentReports[bubbleId] : undefined));
  const agentReviews = useGraphStore((s) => (needs.has('agentReviews') ? s.agentReviews[bubbleId] : undefined));
  const brain = useGraphStore((s) => (needs.has('brain') ? selectActiveBrainSummary(s) : undefined));
  // §5.11 v4.65 — 집행이 실제로 무엇을 보고 판단했는지. 프로젝트 단위라 버블과 무관하게 같은 값이 온다.
  const pluginFacts = useGraphStore((s) => (needs.has('pluginFacts') ? selectActivePluginFacts(s) : undefined));
  const brainInjections = useGraphStore((s) => (needs.has('brainInjections') ? s.brainInjections[bubbleId] : undefined));
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
    () => ({ agentEvents, subAgents, runningTasks, agentReports, agentReviews, brain, brainInjections, taskEdges, captureBubbles, bashCommands, pluginFacts }),
    [agentEvents, subAgents, runningTasks, agentReports, agentReviews, brain, brainInjections, taskEdges, captureBubbles, bashCommands, pluginFacts],
  );
}

function useBubbleContext(props: BubbleSlotProps, modules: PluginClientModule[]): PluginBubbleContext {
  const t = usePluginTranslate();
  const { bubbleId, bubbleType, label, customCreated, agentConfig } = props;
  const data = usePluginData(modules, bubbleId);
  // 분 단위로 굳힌 '지금'. 같은 분 안에서는 값이 같아 렌더가 안 흔들리고, 분이 바뀌면 실제로 바뀐다
  // — 예전에는 `useMemo(…, [])` 라 마운트 시점에 굳어 **영영 안 바뀌었다**(§5.11 v4.31).
  const now = useMinuteNow();
  return useMemo(
    () => ({ bubbleId, bubbleType, label, customCreated, agentConfig, data, now, t }),
    [bubbleId, bubbleType, label, customCreated, agentConfig, data, now, t],
  );
}

/**
 * 버블 배지 슬롯 — 버블 우하단. 여러 플러그인이 배지를 내면 가로로 이어 붙는다.
 * `pointer-events-none` 컨테이너 위에 배지만 `auto` 로 살려 툴팁은 뜨되 드래그는 안 막는다.
 */
export function PluginBubbleBadgeSlot(props: BubbleSlotProps): React.JSX.Element | null {
  const modules = useActivePluginModules();
  const badgeModules = useMemo(() => modulesForSlot(modules, 'bubbleBadge'), [modules]);
  // 이 슬롯은 **모든 버블 안에** 들어간다. 배지를 내는 모듈이 없으면 여기서 끝내야 한다 —
  // 아래 안쪽 컴포넌트가 버블마다 스토어 구독 열두 개를 열기 때문이다(§5.11 v4.30).
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
 * DetailPanel 섹션 슬롯.
 *
 * 카드가 111종이 되면 "켠 것을 등록 순서대로 전부 펼치기"는 못 쓴다. 그래서 호스트가 두 가지를 한다.
 *  ① **문제부터 위로** — 심각도 순으로 정렬한다. 무엇을 봐야 하는지가 스크롤 없이 먼저 보인다.
 *  ② **조용한 카드는 접는다** — 경고가 아닌 카드가 문턱을 넘게 많으면 접어 두고 펼치기 버튼을 준다.
 *
 * 정렬 근거는 카드가 렌더 전에 알려 주는 `severity` 뿐이다 — 호스트가 카드 내용을 열어 보지 않는다는
 * 경계는 그대로 유지된다.
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

/**
 * 호스트가 여는 동작들 — 플러그인은 이 이름들만 부를 수 있다.
 *
 * 새 엔드포인트를 만들지 않고 이미 있는 정지 경로를 조합한다. 예약된 루프까지 끊는 이유는,
 * 현재 실행만 죽이고 스케줄러가 살아 있으면 다음 회차가 다시 뜨기 때문이다.
 */
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

  return (
    <div className="flex items-center gap-1">
      {items.map((i) => (
        <PluginErrorBoundary key={i.id} pluginId={i.pluginId}>
          <span>{i.node}</span>
        </PluginErrorBoundary>
      ))}
    </div>
  );
}
