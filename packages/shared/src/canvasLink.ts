/**
 * §5.4 #36 — 전환과 연결의 **순수 판정** 한 벌.
 *
 * 서버(REST 검증)와 클라(낙관 반영·그리기)가 같은 답을 내야 하는 것만 여기 둔다 — 두 벌이 되면
 * 한쪽만 고쳐져 "화면에선 이어졌는데 껐다 켜면 끊긴" 선이 생긴다.
 *
 * shared 는 브라우저에서도 로드되므로 `process.platform` 을 읽지 않는다 — 경로 판정은 플랫폼을
 * 인자로 받는다(multiplatform 정본: "플랫폼 분기는 인자로").
 */

import { APP_BUBBLE_LINK_MAX } from './constants.js';
import { isPathWithin, normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

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

/** 상대 경로에서 파일 이름만(구분자는 둘 다 받는다 — multiplatform: `path.basename` 에 맡기지 않는다). */
export function linkedFileName(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? relPath;
}
