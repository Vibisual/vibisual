/**
 * §5.4 #36 (K) — 말풍선 전용 버블. 말풍선 에이전트의 활동 버블을 전용 버블 하나 아래 종류별로 다시 세운다.
 * 표시 전용 파생이다(서버 노드·엣지 ❌) — 기본 버블로 돌아가면 이 판정이 빠지면서 원래 모양이 그대로 돌아온다.
 * 판정(`planDedicatedHubs`)과 위성 조립(`dedicatedSatInfos`)을 나눈 까닭: 조립만 히트 척도·저장 자리를 본다.
 */
import type { ActivityEdge, AppBubble, BubbleData, FileFaceKind, HeatScale, NodeStatus } from '@vibisual/shared';
import { BUBBLE_COLORS, BUNDLE_BUBBLE, DEDICATED_BUBBLE, fileFaceKindOf } from '@vibisual/shared';
import { classifyDedicatedItem, GENERAL_DEDICATED_PROFILE, type DedicatedItem, type DedicatedProfile } from '../apps/dedicatedProfiles.js';
import { BUNDLE_SATELLITE_MAX, bundleMoonsOf, stableBundle } from './constellationView.js';
import { DEDICATED_CATEGORY_PREFIX, DEDICATED_HUB_PREFIX, type DedicatedHubMarks } from './dedicatedBubbleInfo.js';
import type { SatelliteInfo } from './satellite.js';
import { calcBubbleSize, calcFileSizeRange } from './sizeCalc.js';

/** 전용 버블 하나의 출처 — 이어진 앱(또는 앱 없음). */
export interface DedicatedHubSource {
  readonly appId: string | null;
  readonly profile: DedicatedProfile;
  readonly color: string | null;
  readonly glow: string | null;
}

export interface DedicatedCategoryPlan {
  readonly id: string;
  readonly label: string;
  /** 저장 열쇠 `<프로필>:<종류>`. */
  readonly key: string;
  readonly hidden: boolean;
  /** 최근 것부터. */
  readonly members: readonly BubbleData[];
}

export interface DedicatedHubPlan {
  readonly hubId: string;
  readonly agentId: string;
  readonly appId: string | null;
  readonly profileId: string;
  readonly label: string;
  readonly color: string | null;
  readonly glow: string | null;
  readonly categories: readonly DedicatedCategoryPlan[];
}

export interface DedicatedPlan {
  readonly folders: readonly BubbleData[];
  readonly edges: readonly ActivityEdge[];
  readonly hubs: readonly DedicatedHubPlan[];
}

export interface DedicatedPlanInput {
  readonly agents: readonly BubbleData[];
  readonly folders: readonly BubbleData[];
  readonly edges: readonly ActivityEdge[];
  readonly satellites: Readonly<Record<string, readonly BubbleData[] | undefined>>;
  readonly hubSourcesOf: (agentId: string) => readonly DedicatedHubSource[];
  readonly label: (key: string) => string;
}

const FOLDER_TYPES: ReadonlySet<BubbleData['bubbleType']> = new Set(['internal_folder', 'external_folder']);

/** 말풍선으로 전용 버블을 가질 수 있는 에이전트. [버블 숨기기]가 이긴다(§5.4 #36 (H) ①-1) — 그때는 숨김 판정이 원본을 그대로 감춘다. */
export function hasDedicatedBubble(agent: Pick<BubbleData, 'bubbleType' | 'agentForm' | 'bubblesHidden' | 'trashed'>): boolean {
  return agent.bubbleType === 'agent' && agent.agentForm === 'card' && agent.bubblesHidden !== true && agent.trashed !== true;
}

function isFoldable(b: BubbleData): boolean {
  if (b.pinned || b.preservePinned || b.status === 'disappearing') return false;
  return b.bubbleType === 'file' || FOLDER_TYPES.has(b.bubbleType) || b.bubbleType === 'domain'
    || (b.bubbleType === 'bash' && b.commandApp !== undefined);
}

function itemOf(b: BubbleData): DedicatedItem {
  if (b.bubbleType === 'domain') return { kind: 'domain' };
  if (b.bubbleType === 'bash') return { kind: 'command', name: b.label };
  return { kind: 'file', path: b.absolutePath || b.path || b.label };
}

function byRecent(a: BubbleData, b: BubbleData): number {
  return (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function statusOf(members: readonly BubbleData[]): NodeStatus {
  if (members.some((m) => m.status === 'active')) return 'active';
  if (members.some((m) => m.status === 'completed')) return 'completed';
  return 'idle';
}

/** 이 에이전트에 이어진 앱들의 전용 버블 출처 — 앱이 없거나 표를 선언하지 않았으면 일반 전용 버블 하나. 같은 앱 노드가 둘이어도 한 벌. */
export function dedicatedHubSourcesOf(
  agentId: string,
  appBubbles: readonly Pick<AppBubble, 'appId' | 'linkedAgentIds' | 'projectName'>[],
  projectName: string | null | undefined,
  appOf: (appId: string) => { readonly dedicated?: DedicatedProfile | undefined; readonly color: string; readonly glow: string } | undefined,
): readonly DedicatedHubSource[] {
  const out: DedicatedHubSource[] = [];
  const seen = new Set<string>();
  for (const b of appBubbles) {
    if (projectName && b.projectName !== projectName) continue;
    if (!b.linkedAgentIds?.includes(agentId) || seen.has(b.appId)) continue;
    seen.add(b.appId);
    const app = appOf(b.appId);
    if (app?.dedicated) out.push({ appId: b.appId, profile: app.dedicated, color: app.color, glow: app.glow });
  }
  return out.length > 0 ? out : [{ appId: null, profile: GENERAL_DEDICATED_PROFILE, color: null, glow: null }];
}

/** 어떤 버블을 접어 어느 전용 버블에 세울지 정한다. 말풍선이 없으면 입력 배열을 그대로 돌려준다. */
export function planDedicatedHubs(input: DedicatedPlanInput): DedicatedPlan {
  const none: DedicatedPlan = { folders: input.folders, edges: input.edges, hubs: [] };
  const cards = input.agents.filter(hasDedicatedBubble);
  if (cards.length === 0) return none;

  const cardIds = new Set(cards.map((a) => a.id));
  const agentIds = new Set(input.agents.map((a) => a.id));
  const foldable = new Map(input.folders.filter(isFoldable).map((b) => [b.id, b] as const));
  const touching = new Map<string, Set<string>>();
  for (const e of input.edges) {
    const pair = agentIds.has(e.source) && foldable.has(e.target) ? [e.source, e.target] as const
      : agentIds.has(e.target) && foldable.has(e.source) ? [e.target, e.source] as const
        : null;
    if (!pair) continue;
    const set = touching.get(pair[1]) ?? new Set<string>();
    set.add(pair[0]);
    touching.set(pair[1], set);
  }

  // 한 버블은 한 자리에만 — 말풍선 여럿이 함께 쓰면 활동이 가장 최근인 쪽이 가져간다. 다른 형태의 에이전트도 쓰면 그쪽이 보여 주므로 접지 않는다.
  const activityOf = new Map(cards.map((a) => [a.id, a.lastActivity ?? 0] as const));
  const folded = new Set<string>();
  const itemsOf = new Map<string, BubbleData[]>();
  for (const [id, agents] of touching) {
    if ([...agents].some((a) => !cardIds.has(a))) continue;
    const owner = [...agents].reduce((best, a) => ((activityOf.get(a) ?? 0) > (activityOf.get(best) ?? 0) ? a : best));
    folded.add(id);
    const list = itemsOf.get(owner) ?? [];
    itemsOf.set(owner, list);
    const bubble = foldable.get(id)!;
    if (FOLDER_TYPES.has(bubble.bubbleType)) {
      for (const f of input.satellites[id] ?? []) if (f?.bubbleType === 'file') list.push(f);
    } else {
      list.push(bubble);
    }
  }

  const hubs: DedicatedHubPlan[] = [];
  for (const agent of cards) {
    const unique = new Map((itemsOf.get(agent.id) ?? []).map((b) => [b.id, b] as const));
    const hidden = new Set(agent.dedicatedHidden ?? []);
    const claimed = new Set<string>();
    for (const source of input.hubSourcesOf(agent.id)) {
      const byCategory = new Map<string, BubbleData[]>();
      for (const b of unique.values()) {
        if (claimed.has(b.id)) continue;
        const category = classifyDedicatedItem(source.profile, itemOf(b));
        if (category === null) continue;
        claimed.add(b.id);
        const list = byCategory.get(category) ?? [];
        list.push(b);
        byCategory.set(category, list);
      }
      // 앱에 이어졌으면 비어 있어도 선다(그 앱의 전용 버블이 이름표다). 일반 전용 버블은 담을 것이 있을 때만.
      if (byCategory.size === 0 && source.appId === null) continue;
      hubs.push({
        hubId: `${DEDICATED_HUB_PREFIX}${encodeURIComponent(agent.id)}-${source.profile.id}`,
        agentId: agent.id,
        appId: source.appId,
        profileId: source.profile.id,
        label: input.label(source.profile.hubLabelKey),
        color: source.color,
        glow: source.glow,
        categories: source.profile.categories.map((id) => {
          const key = `${source.profile.id}:${id}`;
          return {
            id,
            key,
            label: input.label(`canvas.dedicated.category.${id}`),
            hidden: hidden.has(key),
            members: [...(byCategory.get(id) ?? [])].sort(byRecent),
          };
        }),
      });
    }
  }

  if (folded.size === 0 && hubs.length === 0) return none;
  return {
    folders: input.folders.filter((b) => !folded.has(b.id)),
    edges: input.edges.filter((e) => !folded.has(e.source) && !folded.has(e.target)),
    hubs,
  };
}

function kindOfMembers(members: readonly BubbleData[]): FileFaceKind {
  const counts = new Map<FileFaceKind, number>();
  for (const m of members) {
    if (m.bubbleType !== 'file') continue;
    const kind = fileFaceKindOf(m.absolutePath || m.path || m.label);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: FileFaceKind = 'other';
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) { best = kind; bestCount = count; }
  }
  return best;
}

export interface DedicatedSatContext {
  readonly agents: readonly BubbleData[];
  readonly heat: HeatScale | undefined;
  /** 그 화면에 이미 선 위성 id — 다른 에이전트가 보여 주는 파일과 노드 id 가 겹치지 않게 건너뛴다. */
  readonly taken: ReadonlySet<string>;
}

interface ChildSpec {
  readonly bubble: BubbleData;
  readonly size: number;
  readonly color: string;
}

/** 부모 하나에 달리는 위성들 — 선은 부모에서 나간다(전용 버블·종류 묶음에는 읽기/쓰기 방향이 없다). */
function childInfos(
  parentId: string,
  parentSize: number,
  children: readonly ChildSpec[],
  heat: HeatScale | undefined,
  localRange: SatelliteInfo['localRange'],
): SatelliteInfo[] {
  return children.map(({ bubble, size, color }, index) => ({
    bubble,
    parentId,
    parentSize,
    edge: {
      id: `sat-edge-${bubble.id.slice(4)}`,
      source: parentId,
      target: bubble.id,
      isActive: bubble.status === 'active',
      color,
      sourceRadius: parentSize / 2,
      targetRadius: size / 2,
    },
    index,
    total: children.length,
    localRange,
    heat,
    parentSlots: Math.max(1, children.length),
  }));
}

/** 전용 버블 → 종류(하나면 그 버블 · 둘부터 묶음) → 묶음의 위성. 부모가 앞에 오게 쌓는다(첫 자리를 부모 둘레에 잡는 순서다). */
export function dedicatedSatInfos(plan: DedicatedPlan, ctx: DedicatedSatContext): SatelliteInfo[] {
  const out: SatelliteInfo[] = [];
  const taken = new Set(ctx.taken);
  for (const hub of plan.hubs) {
    const agent = ctx.agents.find((a) => a.id === hub.agentId);
    if (!agent) continue;
    const visible = hub.categories.filter((c) => !c.hidden && c.members.length > 0);
    const allMembers = visible.flatMap((c) => c.members);
    const hubNodeId = `sat-${hub.hubId}`;
    const marks: DedicatedHubMarks = {
      _dedicatedAppId: hub.appId,
      _dedicatedColor: hub.color,
      _dedicatedGlow: hub.glow,
      _dedicatedCount: allMembers.length,
    };
    const hubBubble = {
      id: hubNodeId,
      label: hub.label,
      bubbleType: 'bundle',
      path: '',
      status: statusOf(allMembers),
      activity: 1,
      lastActivity: Math.max(0, ...allMembers.map((m) => m.lastActivity ?? 0)),
      ...marks,
    } as BubbleData;
    const parentSize = calcBubbleSize(agent, undefined, ctx.heat);
    const color = hub.color ?? BUBBLE_COLORS.bundle;
    out.push(...childInfos(agent.id, parentSize, [{ bubble: hubBubble, size: DEDICATED_BUBBLE.size, color }], ctx.heat, { min: 0, max: 0 }));

    const singles = visible
      .filter((c) => c.members.length < BUNDLE_BUBBLE.minMembers)
      .map((c) => c.members[0]!)
      .filter((m) => !taken.has(`sat-${m.id}`));
    const singleRange = calcFileSizeRange(singles.filter((m) => m.bubbleType === 'file'));
    const moons: SatelliteInfo[] = [];
    const children: ChildSpec[] = [];
    for (const category of visible) {
      if (category.members.length < BUNDLE_BUBBLE.minMembers) {
        const member = category.members[0]!;
        const id = `sat-${member.id}`;
        if (taken.has(id)) continue;
        taken.add(id);
        const bubble: BubbleData = { ...member, id, activity: 1 };
        children.push({ bubble, size: calcBubbleSize(bubble, singleRange, ctx.heat), color: BUBBLE_COLORS[member.bubbleType] });
        continue;
      }
      const bundleId = `sat-${DEDICATED_CATEGORY_PREFIX}${encodeURIComponent(hub.agentId)}-${hub.profileId}-${category.id}`;
      const fileMembers = category.members.filter((m) => m.bubbleType === 'file');
      const bundle = {
        id: bundleId,
        label: category.label,
        bubbleType: 'bundle',
        path: '',
        status: statusOf(category.members),
        activity: 1,
        lastActivity: Math.max(0, ...category.members.map((m) => m.lastActivity ?? 0)),
        _bundle: stableBundle({
          source: 'dedicated',
          kind: kindOfMembers(category.members),
          memberIds: fileMembers.map((m) => m.id),
          members: category.members.slice(0, BUNDLE_BUBBLE.tooltipNameMax).map((m) => ({ label: m.label, reason: null })),
          count: category.members.length,
          maxSatellites: BUNDLE_SATELLITE_MAX,
        }),
      } as BubbleData;
      children.push({ bubble: bundle, size: BUNDLE_BUBBLE.size, color: BUBBLE_COLORS.bundle });
      const bundleMoons = bundleMoonsOf(
        bundleId,
        category.members.map((m) => ({ fileId: m.id, bubble: m, position: undefined })),
        ctx.heat,
        taken,
      );
      for (const m of bundleMoons) taken.add(m.bubble.id);
      moons.push(...bundleMoons);
    }
    out.push(...childInfos(hubNodeId, DEDICATED_BUBBLE.size, children, ctx.heat, singleRange), ...moons);
  }
  return out;
}

/** 디테일창 체크 목록 — 줄 하나가 그 전용 버블의 위성 하나다. */
export interface DedicatedHubPanelRow {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly hidden: boolean;
  readonly count: number;
}

export interface DedicatedHubPanel {
  readonly hubId: string;
  readonly agentId: string;
  /** 패널 머리에 쓰는 이름·색 — `bubbleType` 은 묶음(서버 노드가 없어 고정 칸만 쓴다). */
  readonly bubble: BubbleData;
  readonly color: string | null;
  readonly rows: readonly DedicatedHubPanelRow[];
}

export function dedicatedHubPanels(plan: DedicatedPlan): DedicatedHubPanel[] {
  return plan.hubs.map((hub) => ({
    hubId: hub.hubId,
    agentId: hub.agentId,
    color: hub.color,
    bubble: { id: hub.hubId, label: hub.label, bubbleType: 'bundle', path: '', status: 'idle', activity: 1 } as BubbleData,
    rows: hub.categories.map((c) => ({ id: c.id, key: c.key, label: c.label, hidden: c.hidden, count: c.members.length })),
  }));
}
