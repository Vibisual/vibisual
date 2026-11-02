/**
 * §5.5 #17-51 — 중첩 서브에이전트(`nestedUnderToolUseId`) 줄의 표시 판정. 순수 함수만 둔다.
 * 가상 리스트라 화면 밖 앞 항목은 DOM 에 없다 — 이어짐은 CSS 형제 선택자가 아니라 항목 배열로 가린다(#17-45 ① 과 같은 이유).
 */
import type { SubAgentStreamEvent } from '@vibisual/shared';

/** 이어짐 판정에 필요한 최소 형태. `owner` 미설정 = 부모 자신의 줄(여기서 이어짐이 끊긴다). */
export interface NestedOwnerRole {
  id: string;
  owner?: string | undefined;
}

/**
 * 바로 앞 항목과 주인이 같은 중첩 줄의 id 묶음 — 이 줄들은 머리표 없이 세로선만 잇는다.
 * 다른 주인·부모 줄이 끼면 끊긴다(주인이 바뀌었다는 것을 알릴 자리가 그 머리표다).
 */
export function nestedContinuationIds(seq: readonly NestedOwnerRole[]): Set<string> {
  const out = new Set<string>();
  let prev: string | undefined;
  for (const it of seq) {
    if (it.owner !== undefined && it.owner === prev) out.add(it.id);
    prev = it.owner;
  }
  return out;
}

/** 두 묶음이 같은가 — 같으면 앞 참조를 그대로 써서 `itemContent` 가 매 틱 바뀌지 않게 한다. */
export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * 서브에이전트 색. 호출 id 의 해시로 고른다 — 등장 순서로 매기면 위쪽 과거를 불러올 때(#17-12) 번호가 밀려 같은 서브에이전트의 색이 바뀐다.
 * 클래스는 Tailwind 가 소스에서 그대로 읽어야 하므로 통째 문자열로 둔다. 도구 칩(amber)·오류(red)와 겹치는 색은 뺐다.
 */
export const NESTED_AGENT_TONES = [
  { rail: 'border-violet-400/50', text: 'text-violet-300', chip: 'bg-violet-500/15' },
  { rail: 'border-sky-400/50', text: 'text-sky-300', chip: 'bg-sky-500/15' },
  { rail: 'border-emerald-400/50', text: 'text-emerald-300', chip: 'bg-emerald-500/15' },
  { rail: 'border-pink-400/50', text: 'text-pink-300', chip: 'bg-pink-500/15' },
  { rail: 'border-lime-400/50', text: 'text-lime-300', chip: 'bg-lime-500/15' },
  { rail: 'border-orange-400/50', text: 'text-orange-300', chip: 'bg-orange-500/15' },
  { rail: 'border-cyan-400/50', text: 'text-cyan-300', chip: 'bg-cyan-500/15' },
  { rail: 'border-fuchsia-400/50', text: 'text-fuchsia-300', chip: 'bg-fuchsia-500/15' },
] as const;

export type NestedAgentTone = (typeof NESTED_AGENT_TONES)[number];

/** FNV-1a 32bit — 같은 id 는 언제나 같은 색, 다른 id 는 고르게 흩어진다. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function nestedAgentTone(toolUseId: string): NestedAgentTone {
  return NESTED_AGENT_TONES[hashId(toolUseId) % NESTED_AGENT_TONES.length]!;
}

/** 머리표 옆 짧은 id — 호출 id(`toolu_01…`)의 끝 4자. 색이 겹쳐도 이것으로 가른다. */
export function nestedAgentShortId(toolUseId: string): string {
  const alnum = toolUseId.replace(/[^0-9A-Za-z]/g, '');
  return (alnum.length > 0 ? alnum : toolUseId).slice(-4);
}

/** 도구 입력 미리보기(JSON, 길면 잘려 온다)에서 문자열 필드 하나 — 잘린 JSON 도 앞쪽 필드는 읽는다. */
function readInputString(input: string, key: string): string | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(input);
  if (!m) return undefined;
  try {
    const v = JSON.parse(`"${m[1]}"`) as unknown;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 서브에이전트를 띄운 호출(`tool_use`)의 입력에서 사람이 읽을 이름 — `description` 이 있으면 그것, 없으면 `subagent_type`.
 * 그 호출이 복원 창 밖으로 밀렸으면 이름 없이 색·짧은 id 만 선다.
 */
export function nestedAgentLabels(events: readonly SubAgentStreamEvent[], owners: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (owners.size === 0) return out;
  for (const evt of events) {
    if (evt.eventType !== 'tool_use' || !evt.toolUseId || !owners.has(evt.toolUseId) || out.has(evt.toolUseId)) continue;
    const label = readInputString(evt.content, 'description') ?? readInputString(evt.content, 'subagent_type');
    if (label) out.set(evt.toolUseId, label);
    if (out.size === owners.size) break;
  }
  return out;
}

export function sameLabelMap(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
