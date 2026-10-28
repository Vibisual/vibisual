/** §5.4 #36 — 서버(REST 검증)와 클라(낙관 반영)가 같은 답을 내야 하는 전환·연결 판정 한 벌(두 벌이면 껐다 켜면 끊긴 선이 생긴다). 플랫폼은 인자. */

import { APP_BUBBLE_LINK_MAX, APP_BUBBLE_PAST_FILE_MAX } from './constants.js';
import { isPathWithin, normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import type { AppBubblePastFile } from './types.js';

/** `linkedAgentIds` 다듬기(문자열·trim·빈 값/중복 제거·앞에서 `max` 개). 배열이 아니면 `null` = 이 칸을 건드리지 않는다(기존 연결을 지우지 않게). */
export function sanitizeLinkedAgentIds(input: unknown, max: number = APP_BUBBLE_LINK_MAX): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id === '' || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** 연결 하나를 더한 목록. 이미 있으면 같은 내용, 상한이 차면 더하지 않는다(가장 오래된 것을 밀어내지 않는다). */
export function withLinkedAgent(list: readonly string[] | undefined, agentId: string, max: number = APP_BUBBLE_LINK_MAX): string[] {
  const base = sanitizeLinkedAgentIds(list ?? [], max) ?? [];
  if (base.includes(agentId) || base.length >= max) return base;
  return [...base, agentId];
}

/** 연결 하나를 뺀 목록. */
export function withoutLinkedAgent(list: readonly string[] | undefined, agentId: string): string[] {
  return (list ?? []).filter((id) => id !== agentId);
}

/** 이 앱 노드가 이 에이전트를 참조하는가. */
export function isLinkedTo(list: readonly string[] | undefined, agentId: string): boolean {
  return (list ?? []).includes(agentId);
}

/** §5.4 #36 (C) — 루트 기준 상대 경로(`/`). 루트 밖·루트 자신이면 `null`. 안팎은 `pathKey` 로 재고 결과는 입력 대소문자 그대로(접힌 키면 linux 에서 다른 파일). */
export function projectRelativePath(root: string, absPath: string, platform: PlatformName): string | null {
  if (root.trim() === '' || absPath.trim() === '') return null;
  const r = normalizePathShape(root);
  const a = normalizePathShape(absPath);
  if (pathKey(a, platform) === pathKey(r, platform)) return null;
  if (!isPathWithin(a, r, platform)) return null;
  const cut = r.endsWith('/') ? r.length : r.length + 1;
  const rel = a.slice(cut);
  if (rel === '' || rel.split('/').some((seg) => seg === '..')) return null;
  return rel;
}

/**
 * §5.4 #36 (H) ③ — 결과 전달로 `file` 이 바뀔 때 지난 결과를 쌓는다(순수). `prev` 를 맨 앞에, 다시 보낸 파일이 `prev` 와 같으면 쌓지 않는다(방금 덮였다).
 * `next` 는 목록에서 뺀다. 비교는 `pathKey`, 저장은 입력 그대로. 모양이 틀린 칸은 버린다(손으로 고친 체크포인트 대비).
 */
export function pushPastFile(
  past: readonly AppBubblePastFile[] | undefined,
  prev: { readonly file?: string | undefined; readonly at?: number | undefined },
  next: string,
  platform: PlatformName,
  max: number = APP_BUBBLE_PAST_FILE_MAX,
): AppBubblePastFile[] {
  const same = (a: string, b: string): boolean => pathKey(a, platform) === pathKey(b, platform);
  let list: AppBubblePastFile[] = (past ?? []).filter(
    (p): p is AppBubblePastFile => !!p && typeof p.file === 'string' && p.file.trim() !== '',
  );
  const before = typeof prev.file === 'string' ? prev.file.trim() : '';
  if (before !== '' && !same(before, next)) {
    const entry: AppBubblePastFile = typeof prev.at === 'number' && Number.isFinite(prev.at)
      ? { file: before, at: prev.at }
      : { file: before };
    list = [entry, ...list.filter((p) => !same(p.file, before))];
  }
  return list.filter((p) => !same(p.file, next)).slice(0, Math.max(0, max));
}

/** 상대 경로에서 파일 이름만(구분자는 둘 다 받는다 — multiplatform: `path.basename` 에 맡기지 않는다). */
export function linkedFileName(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? relPath;
}

/** §5.4 #36 (F) — 앱 노드 id 형식. 클라가 먼저 짓고 서버는 이 형식의 새 id 만 받는다 — 서버도 {@link makeAppBubbleId} 로 짓는다(두 벌이면 자기 형식을 거절한다). */
export const APP_BUBBLE_ID_PATTERN = /^app-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/;

/** 새 앱 노드 id — `app-<시각 36진>-<난수 36진 5자리>`. 인자는 시험에서 고정하려고 받는다. */
export function makeAppBubbleId(now: number = Date.now(), random: () => number = Math.random): string {
  const head = Math.max(0, Math.floor(now)).toString(36);
  const tail = Math.floor(Math.min(0.999999, Math.max(0, random())) * 36 ** 5).toString(36).padStart(5, '0');
  return `app-${head}-${tail}`;
}

/** 클라가 지어 보낸 id 를 받아도 되는 모양인가(있는지 없는지는 서버가 따로 본다). */
export function isAppBubbleId(value: unknown): value is string {
  return typeof value === 'string' && APP_BUBBLE_ID_PATTERN.test(value);
}
