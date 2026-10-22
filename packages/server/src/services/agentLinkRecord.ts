/**
 * agentLinkRecord.ts — §5.4 #36 (H) ①-2 [이전 연결 다시 보기]의 **기록 다루기 한 벌**.
 *
 * ① 디스크에서 온 기록 정화(`sanitizeAgentLinkRecords`) · ② 한도 자르기(`capAgentLinkEntries`) ·
 * ③ 다시 세울 순서 짜기(`planLinkReplay`). 그래프 장부를 만지지 않는 순수 함수라 그대로 단위 테스트된다 —
 * 실제로 세우는 일은 `ProjectGraph.replayAgentLinks` 가 훅 이벤트와 같은 라우팅으로 한다(구조 장부를 손으로
 * 되돌리지 않는다 — 두 벌이 되면 한쪽만 고쳐져 다시 선 버블이 처음 선 버블과 어긋난다).
 */

import type { AgentLinkEntry, AgentLinkRecord, AppWorkMark, BubbleType, CommandAppTarget, WebEntry } from '@vibisual/shared';
import { AGENT_LINK_RECORD } from '@vibisual/shared';

/** 기록에 오를 수 있는 종류 — §2.4 확인 dismiss 가 걷는 활동 버블(`followsActivityBubbleLifecycle`)과 같은 다섯. */
const LINK_ENTRY_TYPES: ReadonlySet<BubbleType> = new Set<BubbleType>(['file', 'internal_folder', 'external_folder', 'domain', 'bash']);

/** 폴더를 훑는 도구 — 외부 폴더 묶음은 이 이름으로 다시 흘린다(결과 파일이 그 폴더 하나에 평탄하게 붙는 길). */
const DIR_TOOLS: ReadonlySet<string> = new Set(['Grep', 'Glob']);
const DIR_TOOL_FALLBACK = 'Glob';
/** 마지막 도구를 모르면 읽기로 본다 — 모르는 것을 쓰기로 넘겨짚지 않는다(§2.1 #3 과 같은 규율). */
const FILE_TOOL_FALLBACK = 'Read';

/** 다시 세우기 한 걸음. `at` 은 그 버블을 마지막으로 만진 시각 — 오래된 것부터 흘려 선 방향이 마지막 도구로 맞는다. */
export type LinkReplayOp =
  | { readonly kind: 'file'; readonly at: number; readonly target: string; readonly tool: string }
  | {
      readonly kind: 'dir';
      readonly at: number;
      readonly target: string;
      readonly tool: string;
      /** 외부 폴더 묶음이면 그 폴더 밑으로 다시 붙일 결과 파일(절대 경로). 내부 폴더면 없다. */
      readonly files?: readonly string[];
    }
  | {
      readonly kind: 'domain';
      readonly at: number;
      readonly key: string;
      readonly host: string;
      readonly tool: string;
      readonly webEntries?: readonly WebEntry[];
    }
  | {
      readonly kind: 'app';
      readonly at: number;
      readonly key: string;
      readonly target: CommandAppTarget;
      readonly project: string;
      readonly tool: string;
    };

/**
 * 다시 세울 순서를 짠다.
 *
 * - **파일**은 낱개로 흘린다 — 라우팅이 폴더 사슬·위성·내부 엣지를 함께 세운다.
 * - Grep/Glob 결과처럼 **직속 부모가 아닌 외부 폴더에 붙어 있던 파일**(`folders` 가 있다)은 그 폴더별로 묶어
 *   폴더 하나를 훑은 것처럼 흘린다 — 낱개로만 흘리면 직속 부모 밑에 다른 모양으로 선다. 직속 부모 밑에도
 *   있었으면(`folderOnly` 가 아니면) 낱개로도 흘린다.
 * - **내부 폴더**는 기록에 그 아래 파일이 하나도 없을 때만 폴더로 흘린다(파일이 있으면 그 파일이 사슬째 세운다 —
 *   두 번 흘리면 선 방향이 폴더의 도구로 덮인다).
 * - **외부 폴더**는 흘리지 않는다 — 위성 ≥ 1 불변식(§2.1 v2.28)이라 그 파일이 세우고, 접합은 트리 재구성이 세운다.
 * - **도메인·명령 앱**은 각자의 등록 함수로.
 *
 * 순서는 마지막으로 만진 시각 오름차순(같으면 기록 순서 그대로).
 */
export function planLinkReplay(entries: readonly AgentLinkEntry[]): LinkReplayOp[] {
  const fileKeys = entries.filter((e) => e.bubbleType === 'file').map((e) => e.key);
  const groups = new Map<string, { at: number; tool: string; files: string[] }>();
  const ops: LinkReplayOp[] = [];
  for (const e of entries) {
    const at = e.lastActivity ?? 0;
    if (e.bubbleType === 'file') {
      if (!e.target) continue;
      for (const folder of e.folders ?? []) {
        let group = groups.get(folder);
        if (!group) {
          group = { at, tool: DIR_TOOL_FALLBACK, files: [] };
          groups.set(folder, group);
        }
        if (!group.files.includes(e.target)) group.files.push(e.target);
        if (at >= group.at) group.at = at;
        if (e.lastTool && DIR_TOOLS.has(e.lastTool)) group.tool = e.lastTool;
      }
      if (e.folderOnly === true && (e.folders?.length ?? 0) > 0) continue;
      ops.push({ kind: 'file', at, target: e.target, tool: e.lastTool || FILE_TOOL_FALLBACK });
      continue;
    }
    if (e.bubbleType === 'internal_folder') {
      if (!e.target) continue;
      const prefix = `${e.key}/`;
      if (fileKeys.some((k) => k.startsWith(prefix))) continue;
      ops.push({ kind: 'dir', at, target: e.target, tool: e.lastTool || DIR_TOOL_FALLBACK });
      continue;
    }
    if (e.bubbleType === 'domain') {
      if (!e.target) continue;
      ops.push({
        kind: 'domain',
        at,
        key: e.key,
        host: e.target,
        tool: e.lastTool || FILE_TOOL_FALLBACK,
        ...(e.webEntries && e.webEntries.length > 0 ? { webEntries: e.webEntries } : {}),
      });
      continue;
    }
    if (e.bubbleType === 'bash' && e.commandApp && e.project) {
      ops.push({ kind: 'app', at, key: e.key, target: e.commandApp, project: e.project, tool: e.lastTool || 'Bash' });
    }
  }
  for (const [folder, group] of groups) {
    ops.push({ kind: 'dir', at: group.at, target: folder, tool: group.tool, files: group.files });
  }
  // Array.prototype.sort 는 안정 정렬이다(ES2019) — 같은 시각이면 위에서 쌓은 순서가 남는다.
  return ops.sort((a, b) => a.at - b.at);
}

/** 한도 안으로 — 오래 안 만진 버블부터 버리고, 도메인 웹 이력도 버블 기본 상한까지(최신이 앞). */
export function capAgentLinkEntries(entries: readonly AgentLinkEntry[]): AgentLinkEntry[] {
  const sorted = [...entries].sort((a, b) => (a.lastActivity ?? 0) - (b.lastActivity ?? 0));
  const kept = sorted.length > AGENT_LINK_RECORD.maxEntries
    ? sorted.slice(sorted.length - AGENT_LINK_RECORD.maxEntries)
    : sorted;
  return kept.map((e) => (e.webEntries && e.webEntries.length > AGENT_LINK_RECORD.maxWebEntries
    ? { ...e, webEntries: e.webEntries.slice(0, AGENT_LINK_RECORD.maxWebEntries) }
    : e));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** 디스크에서 온 한 줄을 아는 칸만 골라 다시 짓는다. 열쇠·종류가 맞지 않으면 버린다(null). */
function sanitizeEntry(raw: unknown): AgentLinkEntry | null {
  if (!isRecord(raw)) return null;
  const key = text(raw['key']);
  const bubbleType = raw['bubbleType'];
  if (!key || typeof bubbleType !== 'string' || !LINK_ENTRY_TYPES.has(bubbleType as BubbleType)) return null;
  const out: AgentLinkEntry = { key, bubbleType: bubbleType as BubbleType };
  const target = text(raw['target']);
  if (target) out.target = target;
  const folders = raw['folders'];
  if (Array.isArray(folders)) {
    const clean = folders.filter((f): f is string => typeof f === 'string' && f.length > 0);
    if (clean.length > 0) out.folders = clean;
  }
  if (raw['folderOnly'] === true && out.folders) out.folderOnly = true;
  const project = text(raw['project']);
  if (project) out.project = project;
  const app = raw['commandApp'];
  if (isRecord(app) && text(app['id']) && text(app['name'])) out.commandApp = app as unknown as CommandAppTarget;
  const web = raw['webEntries'];
  if (Array.isArray(web)) {
    const entries = web.filter((w): w is WebEntry => isRecord(w) && typeof w['id'] === 'string' && typeof w['at'] === 'number');
    if (entries.length > 0) out.webEntries = entries;
  }
  const lastTool = text(raw['lastTool']);
  if (lastTool) out.lastTool = lastTool;
  for (const field of ['lastActivity', 'activity', 'readCount', 'writeCount', 'maxSatellites', 'maxWebEntries'] as const) {
    const n = finite(raw[field]);
    if (n !== undefined) out[field] = n;
  }
  const pos = raw['position'];
  if (isRecord(pos)) {
    const x = finite(pos['x']);
    const y = finite(pos['y']);
    if (x !== undefined && y !== undefined) out.position = { x, y };
  }
  const appWork = raw['appWork'];
  if (isRecord(appWork) && Object.keys(appWork).length > 0) out.appWork = appWork as Record<string, AppWorkMark>;
  return out;
}

/**
 * 디스크에서 온 기록 묶음을 정화한다 — 아는 칸만, 한도 안으로. 손상된 값이 화면 좌표·라우팅으로 새지 않게 하고,
 * 줄이 하나도 남지 않은 에이전트는 빼서 "다시 볼 것이 있다"고 거짓말하지 않는다.
 */
export function sanitizeAgentLinkRecords(raw: unknown): Map<string, AgentLinkRecord> {
  const out = new Map<string, AgentLinkRecord>();
  if (!isRecord(raw)) return out;
  for (const [agentId, rec] of Object.entries(raw)) {
    if (!agentId || !isRecord(rec) || !Array.isArray(rec['entries'])) continue;
    const entries = capAgentLinkEntries(
      rec['entries'].map(sanitizeEntry).filter((e): e is AgentLinkEntry => e !== null),
    );
    if (entries.length === 0) continue;
    out.set(agentId, { at: finite(rec['at']) ?? 0, entries });
  }
  return out;
}
