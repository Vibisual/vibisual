/**
 * §5.1 #2-1 (F) · §5.4 #36 (I) — **앱 작업물** 판정(순수). 서버(꼬리표를 다는 쪽)와 클라(앱 작업 보기)가 같은 답을 낸다.
 *
 * - **어느 앱 노드의 작업인가** — 명령이 싣는 `appNodeIds`, 옛 명령은 본문에 적힌 앱 노드 id(말풍선 프로토콜 블록).
 * - **꼬리표** — 파일 노드의 `appWork`(앱 노드 id → 쓰기 수·시각·표식). 상한을 넘으면 오래된 것부터 뺀다.
 * - **역할 · 자리** — 앱 노드 위쪽 반원에 왼쪽부터 결과 → 같은 종류 → 소재 → 제작 코드 → 데이터 → 메모 → 기타.
 * - **연속 번호** — 이름 끝 번호만 다른 같은 확장자 파일은 위성 하나로 묶는다.
 *
 * 확장자는 귀속을 정하지 않는다 — 여기서 확장자를 보는 것은 역할(자리)·짝·노드 고르기뿐이다.
 * 플랫폼·시각을 읽지 않는다 — 경로 비교가 필요한 쪽이 플랫폼을 인자로 넘긴다(멀티플랫폼 1축).
 */

import { isAppBubbleId } from './canvasLink.js';
import { APP_WORK } from './constants.js';
import { fileBaseName, fileFaceExtOf, fileFaceKindOf, isMediaFaceKind } from './fileFace.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import type { AppWorkMark, AppWorkRole, FileFaceKind, QueuedCommand } from './types.js';

/** 본문에서 앱 노드 id 를 찾는 낱말 — 앞뒤가 id 글자가 아니어야 한다(`xapp-…` · `app-1-2-3` 의 일부 ❌). */
const APP_NODE_ID_IN_TEXT = /(?<![a-z0-9-])app-[a-z0-9]{1,16}-[a-z0-9]{1,16}(?![a-z0-9-])/g;

/** 본문에 적힌 앱 노드 id(나온 순서 · 중복 없이 · 상한까지). 옛 명령의 앱 노드를 읽는 유일한 길이다. */
export function appNodeIdsInText(text: string, max: number = APP_WORK.commandNodeMax): string[] {
  if (typeof text !== 'string' || text === '' || max <= 0) return [];
  const out: string[] = [];
  for (const m of text.matchAll(APP_NODE_ID_IN_TEXT)) {
    const id = m[0];
    if (!out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** 요청 본문의 `appNodeIds` — 앱 노드 id 모양인 것만 · 중복 없이 · 상한까지. 비면 `undefined`(칸을 싣지 않는다). */
export function normalizeAppNodeIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (!isAppBubbleId(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= APP_WORK.commandNodeMax) break;
  }
  return out.length > 0 ? out : undefined;
}

/** 이 명령의 앱 노드 — 실린 `appNodeIds`, 없으면 본문의 앱 노드 id. */
export function commandAppNodeIds(cmd: Pick<QueuedCommand, 'appNodeIds' | 'text'>): string[] {
  if (Array.isArray(cmd.appNodeIds) && cmd.appNodeIds.length > 0) {
    return cmd.appNodeIds.filter((id) => isAppBubbleId(id)).slice(0, APP_WORK.commandNodeMax);
  }
  return appNodeIdsInText(cmd.text ?? '');
}

export interface AppWorkMarkOptions {
  readonly now: number;
  /** 쓰기 수를 올린다(사후 이벤트 · 스크립트 출력). 사전 이벤트는 꼬리표만 세운다. */
  readonly write: boolean;
  readonly script?: boolean;
  readonly retro?: boolean;
  /** 되짚기의 쓰기 수(노드의 `writeCount`). 주면 `w` 를 이 값으로 둔다. */
  readonly writes?: number;
}

/**
 * 꼬리표를 단 **새 기록**(원본은 건드리지 않는다). 상한(`APP_WORK.nodeTagMax`)을 넘으면 마지막으로 쓴 시각이 가장
 * 오래된 노드부터 뺀다. 같은 내용이면 같은 객체를 돌려준다(저장 판본을 헛올리지 않게).
 */
export function withAppWorkMark(
  marks: Readonly<Record<string, AppWorkMark>> | undefined,
  ids: readonly string[],
  opts: AppWorkMarkOptions,
): Record<string, AppWorkMark> | undefined {
  if (ids.length === 0) return marks ? { ...marks } : undefined;
  const next: Record<string, AppWorkMark> = { ...(marks ?? {}) };
  for (const id of ids) {
    const prev = next[id];
    const w = opts.writes !== undefined
      ? Math.max(prev?.w ?? 0, opts.writes)
      : (prev?.w ?? 0) + (opts.write ? 1 : 0);
    const mark: AppWorkMark = { w, at: Math.max(prev?.at ?? 0, opts.now) };
    if (opts.script || prev?.script) mark.script = true;
    // 되짚기 표식은 되짚기로만 선 꼬리표에 남는다 — 실시간으로 다시 쓰면 걷는다.
    if (opts.retro ? prev === undefined || prev.retro === true : false) mark.retro = true;
    next[id] = mark;
  }
  const keys = Object.keys(next);
  if (keys.length > APP_WORK.nodeTagMax) {
    keys.sort((a, b) => (next[a]!.at - next[b]!.at) || (a < b ? -1 : a > b ? 1 : 0));
    for (const key of keys.slice(0, keys.length - APP_WORK.nodeTagMax)) delete next[key];
  }
  return next;
}

/** 같은 꼬리표인가(쓰기 수·시각·표식까지). */
export function sameAppWork(
  a: Readonly<Record<string, AppWorkMark>> | undefined,
  b: Readonly<Record<string, AppWorkMark>> | undefined,
): boolean {
  const ak = Object.keys(a ?? {});
  const bk = Object.keys(b ?? {});
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const x = a![k];
    const y = b?.[k];
    if (!x || !y || x.w !== y.w || x.at !== y.at || !!x.script !== !!y.script || !!x.retro !== !!y.retro) return false;
  }
  return true;
}

// ─── 역할 · 자리 ───

/** (F) ⑤ — 위쪽 반원에서 왼쪽부터 앉는 순서. */
export const APP_WORK_ROLES: readonly AppWorkRole[] = ['result', 'sibling', 'material', 'code', 'data', 'memo', 'other'];

/**
 * 앱이 다루는 **종류** — 그 앱이 선언한 확장자(`outputs ?? opens`)의 얼굴 종류 중 가장 많은 것. 선언이 없으면 `null`
 * (그 앱에는 "같은 종류" 자리가 없다). 코어가 앱 이름을 모르고도 역할을 정하는 자리다(§5.13 (P-4)).
 */
export function appKindOfExtensions(exts: readonly string[]): FileFaceKind | null {
  const counts = new Map<FileFaceKind, number>();
  for (const ext of exts) {
    const kind = fileFaceKindOf(`x${ext}`);
    if (kind === 'other') continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: FileFaceKind | null = null;
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

/** 이 파일의 역할. `isResult` = 그 앱 노드에 담긴 파일(결과·지난 결과). */
export function appWorkRoleOf(filePath: string, appKind: FileFaceKind | null, isResult: boolean): AppWorkRole {
  if (isResult) return 'result';
  const kind = fileFaceKindOf(filePath);
  if (appKind !== null && kind === appKind) return 'sibling';
  if (isMediaFaceKind(kind) || kind === 'subtitle' || kind === 'font') return 'material';
  switch (kind) {
    case 'code': return 'code';
    case 'data': return 'data';
    case 'doc': return 'memo';
    default: return 'other';
  }
}

/** 역할 순위(작을수록 왼쪽). */
export function appWorkRoleRank(role: AppWorkRole): number {
  const i = APP_WORK_ROLES.indexOf(role);
  return i < 0 ? APP_WORK_ROLES.length : i;
}

/** 짝 파일 — 이 확장자는 같은 이름의 저 확장자 바로 옆에 앉는다(OBJ 재질 · glTF 버퍼). */
const COMPANION_OF: Readonly<Record<string, string>> = { '.mtl': '.obj', '.bin': '.gltf' };

/** 이 파일이 짝이면 그 짝의 경로 열쇠 재료(같은 폴더 · 같은 이름 · 짝 확장자). 아니면 `null`. */
export function companionPartnerName(filePath: string): string | null {
  const ext = fileFaceExtOf(filePath);
  const partner = COMPANION_OF[ext];
  if (!partner) return null;
  const name = fileBaseName(filePath);
  return `${name.slice(0, name.length - ext.length)}${partner}`;
}

/**
 * (F) ⑤ — 작업 위성 `count` 개가 앉는 각도(라디안 · 화면 좌표). 위쪽 반원(9시 → 12시 → 3시)을 고르게 나누고 양 끝은
 * 반 칸씩 비운다(정확히 9시·3시면 위성줄·이웃 선과 겹친다). 하나면 12시다.
 */
export function appWorkSeatAngles(count: number): number[] {
  if (count <= 0) return [];
  const from = APP_WORK.seatArcFrom;
  const span = APP_WORK.seatArcTo - APP_WORK.seatArcFrom;
  const step = span / count;
  return Array.from({ length: count }, (_, i) => from + step * (i + 0.5));
}

/**
 * 한 파일에 꼬리표가 여럿일 때 **어느 앱 노드를 돌지** — 그 확장자를 받겠다고 선언한 앱의 노드 → 그 앱 종류와 같은 종류의
 * 노드 → 첫 노드. 후보 순서는 호출부가 정한다(초점 순서).
 */
export function pickAppWorkHub<T extends { readonly id: string; readonly exts: readonly string[]; readonly kind: FileFaceKind | null }>(
  filePath: string,
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;
  const ext = fileFaceExtOf(filePath);
  if (ext !== '') {
    const declared = candidates.find((c) => c.exts.includes(ext));
    if (declared) return declared;
  }
  const kind = fileFaceKindOf(filePath);
  const sameKind = candidates.find((c) => c.kind !== null && c.kind === kind);
  return sameKind ?? candidates[0] ?? null;
}

// ─── 연속 번호 ───

export interface FileSequence {
  /** 같은 연속인가를 가르는 열쇠 — 폴더 경로키 + 앞부분(소문자) + 확장자. */
  readonly key: string;
  /** 번호 앞부분(원래 글자 그대로 — 화면에 쓴다). */
  readonly prefix: string;
  readonly num: number;
  readonly digits: number;
  readonly ext: string;
}

/**
 * 이름 끝이 번호인 파일의 연속 정보(`frame_0012.exr` → 앞부분 `frame_` · 번호 12 · 자릿수 4). 번호가 없으면 `null`.
 * 앞부분 비교는 뜻의 비교라 소문자로 접고, 폴더는 경로키로 가른다(`pathKey` — 멀티플랫폼 1축).
 */
export function fileSequenceOf(filePath: string, platform: PlatformName): FileSequence | null {
  const shaped = normalizePathShape(filePath);
  const name = fileBaseName(shaped);
  const ext = fileFaceExtOf(name);
  if (ext === '' || ext === name.toLowerCase()) return null;
  const stem = name.slice(0, name.length - ext.length);
  const m = /^(.*?)(\d+)$/.exec(stem);
  if (!m) return null;
  const prefix = m[1] ?? '';
  const digits = (m[2] ?? '').length;
  const num = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(num) || digits === 0 || digits > 9) return null;
  const slash = shaped.lastIndexOf('/');
  const dir = slash <= 0 ? '' : shaped.slice(0, slash);
  return { key: `${pathKey(dir, platform)}\u0000${prefix.toLowerCase()}\u0000${ext}`, prefix, num, digits, ext };
}

/** 연속 묶음의 표시 이름 — `frame_####.exr`(자릿수만큼 `#`). */
export function sequenceLabel(seq: Pick<FileSequence, 'prefix' | 'digits' | 'ext'>): string {
  return `${seq.prefix}${'#'.repeat(Math.max(1, seq.digits))}${seq.ext}`;
}

/** 이름 목록을 툴팁 줄로 — 상한(`APP_WORK.tooltipNameMax`)을 넘으면 나머지 수를 돌려준다. */
export function clipNameList(names: readonly string[], max: number = APP_WORK.tooltipNameMax): { shown: string[]; more: number } {
  const shown = names.slice(0, Math.max(0, max));
  return { shown, more: Math.max(0, names.length - shown.length) };
}
