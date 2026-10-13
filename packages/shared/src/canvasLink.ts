/**
 * §5.4 #36 — 전환과 연결의 **순수 판정** 한 벌.
 *
 * 서버(REST 검증)와 클라(낙관 반영·그리기)가 같은 답을 내야 하는 것만 여기 둔다 — 두 벌이 되면
 * 한쪽만 고쳐져 "화면에선 이어졌는데 껐다 켜면 끊긴" 선이 생긴다.
 *
 * shared 는 브라우저에서도 로드되므로 `process.platform` 을 읽지 않는다 — 경로 판정은 플랫폼을
 * 인자로 받는다(multiplatform 정본: "플랫폼 분기는 인자로").
 */

import { APP_BUBBLE_LINK_MAX, APP_BUBBLE_PAST_FILE_MAX } from './constants.js';
import { isPathWithin, normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import type { AppBubblePastFile } from './types.js';

/**
 * `AppBubble.linkedAgentIds` 로 받을 값을 다듬는다 — 문자열만, 앞뒤 공백 제거, 빈 값·중복 제거,
 * 앞에서부터 `max` 개까지.
 *
 * 배열이 아니면 `null` — 호출부가 "이 칸은 건드리지 않는다"로 읽는다(잘못된 본문이 기존 연결을
 * 빈 배열로 지우지 않게 — 부분 페이로드 삭제 결함).
 */
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

/**
 * §5.4 #36 (C) — 앱 노드에 담을 파일을 **프로젝트 루트 기준 상대 경로**(`/` 구분)로 바꾼다.
 *
 * 루트 밖이거나 루트 자신이면 `null` — 결과 전달 창구가 그 요청을 거절한다. 안팎 판정은
 * `pathKey` 규칙(win·mac 은 대소문자를 접고 linux 는 보존)이고, 돌려주는 상대 경로는 **입력의
 * 대소문자 그대로**다(표시·저장 포맷 — 접힌 키를 저장하면 linux 에서 다른 파일을 가리킨다).
 */
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
 * §5.4 #36 (H) ③ — 결과 전달이 노드의 `file` 을 바꿀 때 **지난 결과**를 쌓는다(순수).
 *
 * - 바뀌기 전 파일(`prev`)을 맨 앞에 둔다. 이미 목록에 있으면 그 자리에서 빼고 앞으로 올린다(최근 것부터).
 * - 다시 보낸 파일이 바뀌기 전 파일과 **같으면 쌓지 않는다** — 그 파일은 방금 덮였다(옛 판이 디스크에 없다).
 * - 이번에 담긴 파일(`next`)은 목록에서 뺀다 — 지금 결과가 지난 결과 행세를 하지 않게.
 * - 비교는 `pathKey`(win·mac 은 대소문자를 접고 linux 는 보존 — 플랫폼은 인자로 받는다), 저장은 입력 그대로.
 * - 모양이 틀린 칸(문자열 아닌 `file`·빈 글자)은 버린다 — 손으로 고친 체크포인트가 구슬 줄을 깨지 않게.
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

/**
 * §5.4 #36 (F) — 앱 노드 id 형식. 꽃잎을 고르는 즉시 노드가 서도록 **클라가 먼저 짓고**(낙관 생성),
 * 서버는 이 형식이고 아직 없는 id 만 받는다. 서버가 스스로 지을 때도 {@link makeAppBubbleId} 를 쓴다 —
 * 짓는 쪽이 두 벌이면 언젠가 서버가 자기 형식을 "형식 밖"으로 거절한다.
 */
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
