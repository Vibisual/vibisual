/**
 * §5.4 #36 (I) · §5.1 #2-1 (F) — **앱 작업 보기**(순수). 말풍선에 앱을 잇는 순간부터 그 앱과 관련된 버블만 보인다.
 *
 * - **초점**: 그 에이전트에 이어진 앱 노드 **전부**(2026-10-21 — 잇는 순간 켜지고 끊으면 풀린다. 종전에는 명령을 보내야 켜졌다).
 *   명령·작업 장부는 차례만 정한다 — 도는(줄 선) 명령의 노드 → 말풍선 작업 장부의 고른 작업 → 마지막 앱 명령 → 나머지 이은
 *   노드. 보기가 "버블 전부"거나 [버블 숨기기] 중이면 초점이 없다.
 * - **작업물**: 서버가 단 `appWork` 꼬리표가 초점 노드를 가리키는 파일. 확장자는 귀속을 정하지 않는다 — 여기서 확장자를
 *   보는 것은 노드 고르기(꼬리표가 여럿일 때) · 역할(자리) · 짝뿐이다. 초점 노드에 담긴 결과·지난 결과는 작업 목록에 넣지 않지만
 *   (별자리가 `appResult` 로 맨 앞에 둔다) **접지도 않는다**.
 * - **연속 번호** 묶기 · 위성 상한을 넘는 것(넘침)은 화면에서 감추고 개수로 말한다.
 *
 * 무엇을 접을지(소유 판정)는 `bubbleVisibility.ts`, 위성 자리는 `constellationView.ts` 가 이 결과를 받아 정한다.
 * 스토어·DOM·시각을 읽지 않는다 — 플랫폼은 인자로 받는다(멀티플랫폼 1축).
 */
import type { AppWorkRole, BubbleData, FileFaceKind, PlatformName, QueuedCommand } from '@vibisual/shared';
import {
  APP_WORK,
  CONSTELLATION,
  appWorkRoleOf,
  appWorkRoleRank,
  commandAppNodeIds,
  companionPartnerName,
  fileBaseName,
  fileSequenceOf,
  normalizePathShape,
  pathKey,
  pickAppWorkHub,
  sequenceLabel,
} from '@vibisual/shared';

/** 앱 노드 하나 — 레지스트리에서 파생한 것(코어는 앱 이름을 모른다)과 그 노드의 선언. */
export interface AppWorkAppInfo {
  /** 앱 노드 id(`AppBubble.id`). */
  readonly id: string;
  /** 앱 이름(툴팁). */
  readonly name: string;
  /** 앱 색(밝은 쪽) — 작업 위성의 테 · 궤도. */
  readonly glow: string;
  /** 그 앱이 받는 확장자(`outputs ?? opens`). */
  readonly exts: readonly string[];
  /** 그 앱이 다루는 종류(`appKindOfExtensions`). */
  readonly kind: FileFaceKind | null;
  readonly linkedAgentIds: readonly string[];
  /** 그 노드에 담긴 결과·지난 결과(절대 경로 — 파일 노드의 `absolutePath` 와 같은 형식). */
  readonly results: readonly string[];
}

export interface AppWorkAgentInfo {
  readonly id: string;
  readonly linkLens?: 'files' | undefined;
  readonly bubblesHidden?: boolean | undefined;
}

export interface AppWorkInput {
  readonly agents: readonly AppWorkAgentInfo[];
  readonly apps: readonly AppWorkAppInfo[];
  /** 이 화면의 파일 노드(원 둘레 파일 + 위성 파일) — 서버 `appWork` 꼬리표를 실은 것. */
  readonly files: readonly BubbleData[];
  /** 에이전트 id → 줄 선·도는 명령. */
  readonly queued: Readonly<Record<string, readonly QueuedCommand[] | undefined>>;
  /** 에이전트 id → 끝난 명령(오래된 것부터). */
  readonly completed: Readonly<Record<string, readonly QueuedCommand[] | undefined>>;
  /** 말풍선 작업 장부의 고른 작업의 노드(읽어 두지 않았으면 `null`). */
  readonly activeTaskNodes: (agentId: string) => readonly string[] | null;
  readonly platform: PlatformName;
}

/** 작업 위성 하나의 표시 정보(툴팁 · 자리). */
export interface AppWorkMoonMeta {
  readonly role: AppWorkRole;
  /** 그 노드 작업 목록 안의 차례(역할 → 짝 → 최근 순) — 위쪽 반원의 자리가 이 순서다. */
  readonly order: number;
  readonly writes: number;
  readonly script: boolean;
  /**
   * 연속 번호 묶음의 대표면 그 묶음. `ids` 는 묶음의 파일 노드 id(번호 순) — 화면은 대표 자리에 묶음 버블을 세우고(§5.1 #2-1 (F) ⑦),
   * 묶음 안(더블클릭)이 이것으로 구성을 찾는다.
   */
  readonly sequence?: { readonly label: string; readonly count: number; readonly names: readonly string[]; readonly ids: readonly string[] } | undefined;
}

export interface AppWorkFile extends Omit<AppWorkMoonMeta, 'order'> {
  readonly fileId: string;
  /** 별자리 판정에 넘기는 경로(파일 노드의 `absolutePath || path || label`). */
  readonly path: string;
  readonly last: number;
}

export interface AppWorkHubPlan {
  readonly app: AppWorkAppInfo;
  /** 위성으로 서는 작업 파일(역할 순 · 상한 안). */
  readonly work: readonly AppWorkFile[];
  /** 위성 상한을 넘은 작업 파일 — 화면에서 감추고 `+N` 점이 말한다. */
  readonly overflow: readonly AppWorkFile[];
  /** 경로 열쇠(`pathKey(normalizePathShape(path))`) → 표시 정보 — 결과로 선언된 것은 없다(별자리가 `result` 로 정한다). */
  readonly meta: ReadonlyMap<string, AppWorkMoonMeta>;
}

export interface AppWorkPlan {
  /** 에이전트 id → 초점 앱 노드 id(초점 순서). */
  readonly focusByAgent: ReadonlyMap<string, readonly string[]>;
  /** 초점 앱 노드 id → 그 노드의 작업. */
  readonly hubs: ReadonlyMap<string, AppWorkHubPlan>;
  /** 접지 않는 것 — 위성으로 서는 작업 파일(파일 id · `sat-` id). */
  readonly keepIds: ReadonlySet<string>;
  /** 작업물이지만 감추는 것 — 연속 번호의 나머지 · 넘침(파일 id · `sat-` id). */
  readonly hiddenWorkIds: ReadonlySet<string>;
}

export const EMPTY_APP_WORK_PLAN: AppWorkPlan = {
  focusByAgent: new Map(),
  hubs: new Map(),
  keepIds: new Set(),
  hiddenWorkIds: new Set(),
};

/** 별자리 판정과 같은 경로 열쇠(플랫폼 규칙 — 멀티플랫폼 1축). */
export function appWorkPathKey(path: string, platform: PlatformName): string {
  return pathKey(normalizePathShape(path), platform);
}

function filePathOf(b: BubbleData): string {
  return b.absolutePath || b.path || b.label;
}

/**
 * 에이전트의 **초점** — 그 에이전트에 이어진 앱 노드 전부(§5.4 #36 (I) — 잇는 순간 켜진다). 없으면 빈 배열.
 *
 * 차례: 도는(줄 선) 명령의 노드 → 말풍선 작업 장부의 고른 작업 → 마지막 앱 명령 → 나머지 이은 노드(만든 순서). 꼬리표가
 * 여럿인 파일이 어느 노드를 돌지의 마지막 기준("첫 노드")이 이 차례다 — 명령은 켜고 끄지 않고 차례만 정한다.
 */
export function appWorkFocusOf(
  agent: AppWorkAgentInfo,
  apps: readonly AppWorkAppInfo[],
  input: Pick<AppWorkInput, 'queued' | 'completed' | 'activeTaskNodes'>,
): string[] {
  if (agent.linkLens === 'files' || agent.bubblesHidden === true) return [];
  const linked = apps.filter((a) => a.linkedAgentIds.includes(agent.id)).map((a) => a.id);
  if (linked.length === 0) return [];
  const out: string[] = [];
  const take = (ids: readonly string[]): void => {
    for (const id of ids) if (linked.includes(id) && !out.includes(id)) out.push(id);
  };
  const queue = input.queued[agent.id] ?? [];
  for (const cmd of queue) if (cmd.status === 'executing') take(commandAppNodeIds(cmd));
  for (const cmd of queue) if (cmd.status === 'queued') take(commandAppNodeIds(cmd));
  take(input.activeTaskNodes(agent.id) ?? []);
  const done = input.completed[agent.id] ?? [];
  for (let i = done.length - 1; i >= 0; i -= 1) {
    const ids = commandAppNodeIds(done[i]!);
    if (ids.length === 0) continue;
    take(ids);
    break;
  }
  take(linked);
  return out;
}

function compareFiles(a: AppWorkFile, b: AppWorkFile): number {
  return (appWorkRoleRank(a.role) - appWorkRoleRank(b.role))
    || (b.last - a.last)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function dirOfPath(p: string): string {
  const shaped = p.replace(/\\/g, '/');
  const slash = shaped.lastIndexOf('/');
  return slash <= 0 ? '' : shaped.slice(0, slash);
}

/** 짝 파일(`.mtl`·`.bin`)을 같은 폴더의 짝 바로 뒤로 옮긴다. 짝이 없으면 제자리. */
function seatCompanions(list: readonly AppWorkFile[], platform: PlatformName): AppWorkFile[] {
  const nameKey = (dir: string, name: string): string => `${appWorkPathKey(dir, platform)}\u0000${name.toLowerCase()}`;
  const byName = new Map(list.map((f) => [nameKey(dirOfPath(f.path), fileBaseName(f.path)), f] as const));
  const partnerOf = new Map<AppWorkFile, AppWorkFile>();
  for (const f of list) {
    const partnerName = companionPartnerName(f.path);
    if (partnerName === null) continue;
    const partner = byName.get(nameKey(dirOfPath(f.path), partnerName));
    if (partner && partner !== f) partnerOf.set(f, partner);
  }
  if (partnerOf.size === 0) return [...list];
  const out: AppWorkFile[] = [];
  for (const f of list) {
    if (partnerOf.has(f)) continue; // 짝 바로 뒤에 앉는다
    out.push(f);
    for (const [companion, partner] of partnerOf) if (partner === f) out.push(companion);
  }
  return out;
}

/**
 * 앱 작업 보기의 판정. 초점이 없으면 빈 판정(`EMPTY_APP_WORK_PLAN` 과 같은 모양)이다.
 */
export function planAppWork(input: AppWorkInput): AppWorkPlan {
  const appById = new Map(input.apps.map((a) => [a.id, a] as const));
  const focusByAgent = new Map<string, readonly string[]>();
  const focusedOrder: string[] = [];
  for (const agent of input.agents) {
    const ids = appWorkFocusOf(agent, input.apps, input);
    if (ids.length === 0) continue;
    focusByAgent.set(agent.id, ids);
    for (const id of ids) if (!focusedOrder.includes(id)) focusedOrder.push(id);
  }
  if (focusedOrder.length === 0) return EMPTY_APP_WORK_PLAN;

  // 결과로 선언된 파일 — 별자리가 `appResult` 로 묶으므로 작업 목록에 넣지 않는다(자리를 두 번 세지 않게).
  const resultKeys = new Map<string, Set<string>>();
  for (const id of focusedOrder) {
    const app = appById.get(id);
    if (app) resultKeys.set(id, new Set(app.results.map((p) => appWorkPathKey(p, input.platform))));
  }

  const candidatesByHub = new Map<string, AppWorkFile[]>();
  const seenFiles = new Set<string>();
  for (const b of input.files) {
    if (b.bubbleType !== 'file' || !b.appWork) continue;
    const fileId = b.id.startsWith('sat-') ? b.id.slice(4) : b.id;
    if (seenFiles.has(fileId)) continue;
    seenFiles.add(fileId);
    const tagged = focusedOrder.filter((id) => b.appWork![id] !== undefined);
    if (tagged.length === 0) continue;
    const path = filePathOf(b);
    const key = appWorkPathKey(path, input.platform);
    if (tagged.some((id) => resultKeys.get(id)?.has(key))) continue;
    const hub = pickAppWorkHub(path, tagged.map((id) => appById.get(id)).filter((a): a is AppWorkAppInfo => a !== undefined));
    if (!hub) continue;
    const mark = b.appWork[hub.id]!;
    const list = candidatesByHub.get(hub.id) ?? [];
    list.push({
      fileId,
      path,
      role: appWorkRoleOf(path, hub.kind, false),
      writes: Math.max(mark.w, b.writeCount ?? 0),
      script: mark.script === true,
      last: Math.max(mark.at, b.lastActivity ?? 0),
    });
    candidatesByHub.set(hub.id, list);
  }

  const hubs = new Map<string, AppWorkHubPlan>();
  const keepIds = new Set<string>();
  const hiddenWorkIds = new Set<string>();
  const hide = (fileId: string): void => {
    hiddenWorkIds.add(fileId);
    hiddenWorkIds.add(`sat-${fileId}`);
  };
  // 초점 노드에 담긴 결과·지난 결과는 접지 않는다 — 작업 목록에서 뺀 것(별자리가 결과로 맨 앞에 둔다)이 남김 목록에서도 빠져,
  //   에이전트가 만들어 넘긴 결과 파일이 접혔다(2026-10-21 실측: 작업물 rig.obj 는 보이고 넘긴 shot.glb 는 접혔다).
  for (const b of input.files) {
    if (b.bubbleType !== 'file') continue;
    const key = appWorkPathKey(filePathOf(b), input.platform);
    if (!focusedOrder.some((id) => resultKeys.get(id)?.has(key))) continue;
    const fileId = b.id.startsWith('sat-') ? b.id.slice(4) : b.id;
    keepIds.add(fileId);
    keepIds.add(`sat-${fileId}`);
  }
  for (const hubId of focusedOrder) {
    const app = appById.get(hubId);
    if (!app) continue;
    const files = candidatesByHub.get(hubId) ?? [];

    // (F) ⑦ 연속 번호 — 같은 열쇠가 `sequenceMin` 이상이면 가장 최근 것 하나만 위성으로.
    const bySeq = new Map<string, Array<{ file: AppWorkFile; num: number; prefix: string; digits: number; ext: string }>>();
    for (const file of files) {
      const seq = fileSequenceOf(file.path, input.platform);
      if (!seq) continue;
      const list = bySeq.get(seq.key) ?? [];
      list.push({ file, num: seq.num, prefix: seq.prefix, digits: seq.digits, ext: seq.ext });
      bySeq.set(seq.key, list);
    }
    const sequenceOf = new Map<AppWorkFile, AppWorkMoonMeta['sequence']>();
    const collapsed = new Set<AppWorkFile>();
    for (const list of bySeq.values()) {
      if (list.length < APP_WORK.sequenceMin) continue;
      const ordered = [...list].sort((a, b) => a.num - b.num);
      const rep = [...list].sort((a, b) => (b.file.last - a.file.last) || (b.num - a.num))[0]!;
      sequenceOf.set(rep.file, {
        label: sequenceLabel(rep),
        count: list.length,
        names: ordered.map((e) => fileBaseName(e.file.path)),
        ids: ordered.map((e) => e.file.fileId),
      });
      for (const e of list) if (e.file !== rep.file) collapsed.add(e.file);
    }
    for (const file of collapsed) hide(file.fileId);

    const shown = files
      .filter((f) => !collapsed.has(f))
      .map((f): AppWorkFile => {
        const sequence = sequenceOf.get(f);
        return sequence ? { ...f, sequence, writes: Math.max(f.writes, sequence.count) } : f;
      })
      .sort(compareFiles);
    const ordered = seatCompanions(shown, input.platform);

    // (F) ⑧ 넘침 — 위성 상한에서 그 노드의 결과 자리를 먼저 뺀다(결과는 별자리가 앞에 둔다). 남은 자리는 **역할마다 하나씩**
    //   먼저 주고(한 역할이 궤도를 다 차지하면 무엇을 만들었는지가 안 보인다), 나머지를 역할 순 · 최근 순으로 채운다.
    const resultsOnScreen = input.files.filter((b) => b.bubbleType === 'file'
      && resultKeys.get(hubId)?.has(appWorkPathKey(filePathOf(b), input.platform))).length;
    const capacity = Math.max(0, CONSTELLATION.moonMax - resultsOnScreen);
    const kept = new Set<AppWorkFile>();
    const seenRoles = new Set<AppWorkRole>();
    for (const f of ordered) {
      if (kept.size >= capacity) break;
      if (seenRoles.has(f.role)) continue;
      seenRoles.add(f.role);
      kept.add(f);
    }
    for (const f of ordered) {
      if (kept.size >= capacity) break;
      kept.add(f);
    }
    const work = ordered.filter((f) => kept.has(f));
    const overflow = ordered.filter((f) => !kept.has(f));
    for (const f of overflow) hide(f.fileId);
    for (const f of work) {
      keepIds.add(f.fileId);
      keepIds.add(`sat-${f.fileId}`);
    }
    const meta = new Map<string, AppWorkMoonMeta>();
    work.forEach((f, order) => {
      meta.set(appWorkPathKey(f.path, input.platform), {
        role: f.role,
        order,
        writes: f.writes,
        script: f.script,
        ...(f.sequence ? { sequence: f.sequence } : {}),
      });
    });
    hubs.set(hubId, { app, work, overflow, meta });
  }
  return { focusByAgent, hubs, keepIds, hiddenWorkIds };
}

/** 같은 판정인가(지문) — 스냅샷마다 새 객체가 와도 그림이 그대로면 아래를 다시 짓지 않게. */
export function appWorkPlanKey(plan: AppWorkPlan): string {
  if (plan.hubs.size === 0) return '';
  const parts: unknown[] = [];
  for (const [agentId, ids] of plan.focusByAgent) parts.push(['f', agentId, ids]);
  for (const [hubId, hub] of plan.hubs) {
    parts.push(['h', hubId, hub.app.glow, hub.work.map((f) => [f.fileId, f.role, f.writes, f.script, f.sequence?.count ?? 0, f.sequence?.ids ?? null]),
      hub.overflow.map((f) => f.fileId)]);
  }
  // 남김 목록에는 결과도 든다 — 작업이 그대로여도 결과가 바뀌면 다른 판정이다(같은 지문이면 옛 판정을 돌려쓴다).
  parts.push(['k', [...plan.keepIds].sort()]);
  return JSON.stringify(parts);
}
