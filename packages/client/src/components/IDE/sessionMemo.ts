import {
  SESSION_MEMO,
  SESSION_MEMO_DEFAULT_COLOR,
  normalizeMemoName,
  repairMemoGroups,
  type SessionMemo,
} from '@vibisual/shared';
import { pickReadableTextColor } from '../../utils/commentBoxStyle.js';

/**
 * sessionMemo.ts — §5.5 #17-36 스티키 메모의 **순수 계산**(React·DOM 없음).
 *
 * 화면(`SessionMemoLayer`/`SessionMemoCard`)은 이 함수들만 부르고 자기 산수를 하지 않는다.
 * 그래야 "판이 좁아지면 메모가 어디로 가는가" 같은 규칙을 단위 테스트로 못 박을 수 있다.
 *
 * 좌표계는 **판(스트림 본문 컨테이너)의 좌상단 기준 px** 이다. 대화와 함께 스크롤되지 않는다.
 *
 * `floatingWindowGeom` 을 빌려 쓰지 않는 이유: 그쪽 규칙은 "창은 화면 밖으로 밀려도 된다(최소
 * 가시량만 남긴다)"인데, 판 안의 메모는 **항상 판 안에 온전히** 있어야 한다(밖은 잘려서 안 보인다).
 * 규칙이 다르므로 함수를 공유하면 둘 중 하나가 반드시 어긋난다.
 */

/** 메모가 놓이는 판의 크기(px). */
export interface MemoBounds {
  w: number;
  h: number;
}

/** 한 장을 갱신할 때 바꿀 수 있는 값들(`updatedAt` 은 자동). */
export type MemoPatch = Partial<Pick<SessionMemo, 'text' | 'name' | 'x' | 'y' | 'w' | 'h' | 'color' | 'alpha' | 'collapsed'>>;

/** 위치·크기 넷 — 끄는 동안 화면이 들고 있는 임시 사각형. */
export interface MemoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, v)));
}

/** 새 메모 id — 시각(36진) + 난수. 같은 ms 에 둘을 만들어도 겹치지 않는다. */
export function newMemoId(now: number = Date.now(), rand: () => number = Math.random): string {
  return `memo-${now.toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

/**
 * 판 안으로 되돌린 사본. **값이 그대로면 같은 객체를 돌려준다** — 그래야 판 크기가 바뀔 때마다
 * 새 배열이 생겨 서버로 헛 저장이 나가는 것을 막는다.
 */
export function clampMemoRect(memo: SessionMemo, bounds: MemoBounds): SessionMemo {
  const boardW = Math.max(SESSION_MEMO.MIN_W, Math.round(bounds.w));
  const boardH = Math.max(SESSION_MEMO.MIN_H, Math.round(bounds.h));
  const w = clamp(memo.w, SESSION_MEMO.MIN_W, Math.min(SESSION_MEMO.MAX_W, boardW));
  const h = clamp(memo.h, SESSION_MEMO.MIN_H, Math.min(SESSION_MEMO.MAX_H, boardH));
  // 접힌 메모는 제목줄만 보이므로 세로 여유를 그만큼만 본다(펼침 높이 `h` 는 그대로 보관).
  const shownH = memo.collapsed ? SESSION_MEMO.HEADER_H : h;
  const x = clamp(memo.x, 0, Math.max(0, boardW - w));
  const y = clamp(memo.y, 0, Math.max(0, boardH - shownH));
  if (x === memo.x && y === memo.y && w === memo.w && h === memo.h) return memo;
  return { ...memo, x, y, w, h };
}

/**
 * 목록 전체를 판 안으로. 한 장도 안 바뀌었으면 **같은 배열**을 돌려준다.
 *
 * 판 크기를 아직 모르거나(첫 렌더) 화면에서 감춰져 0 이 된 순간에는 **아무것도 하지 않는다** —
 * 그때 접어 버리면 다시 보일 때 모든 메모가 최소 크기로 좌상단에 쌓여 있다.
 */
export function clampMemos(memos: SessionMemo[], bounds: MemoBounds): SessionMemo[] {
  if (bounds.w <= 0 || bounds.h <= 0) return memos;
  let changed = false;
  const out = memos.map((m) => {
    const next = clampMemoRect(m, bounds);
    if (next !== m) changed = true;
    return next;
  });
  return changed ? out : memos;
}

/**
 * 제목줄에 보일 한 줄. 우선순위는 **사람이 붙인 이름 → 본문 첫 줄 → 라벨** 셋이다.
 *
 * 이름을 별도 필드로 둔 이유: 종전에는 제목이 본문 첫 줄에서 파생돼, 무슨 메모인지 알아보게 하려면
 * 사용자가 **본문 맨 위를 제목처럼 써야** 했다. 접어 두면 그 한 줄이 유일한 단서라 실질적 강제였다.
 * 이제 이름은 이름대로, 본문은 본문대로 쓴다. 그리고 **이름을 지우면 옛 동작 그대로** 본문 첫 줄이
 * 다시 제목이 된다 — "자동으로 되돌리기" 스위치를 따로 만들지 않는 이유가 이것이다.
 *
 * 반환값은 자르지 않은 **전문**이다. 줄이는 것은 화면의 몫이라(폭에 따라 달라진다) CSS 말줄임이
 * 하고, 이 함수는 잘린 글자를 툴팁으로 보여 줄 원본을 그대로 돌려준다.
 */
export function memoTitle(memo: Pick<SessionMemo, 'name' | 'text'>, fallback: string): string {
  const named = normalizeMemoName(memo.name);
  if (named) return named;
  const first = memo.text.split('\n', 1)[0]?.trim() ?? '';
  return first.length > 0 ? first : fallback;
}

/** 이름을 사람이 직접 붙였나 — 붙인 이름이 없으면 제목은 본문에서 파생된 것이다(편집 시작값 판정용). */
export function hasMemoName(memo: Pick<SessionMemo, 'name'>): boolean {
  return normalizeMemoName(memo.name).length > 0;
}

/** 이 판에 메모를 더 붙일 수 있나(§3.2.3 장수 상한) — 목록 대신 **장수**만 아는 자리용(우클릭 메뉴). */
export function canAddMemoCount(count: number): boolean {
  return count < SESSION_MEMO.MAX_PER_OWNER;
}

/** 이 판에 메모를 더 붙일 수 있나(§3.2.3 장수 상한). */
export function canAddMemo(memos: SessionMemo[]): boolean {
  return canAddMemoCount(memos.length);
}

/**
 * 우클릭 지점(판 기준)에 새 메모 한 장. 이미 그 자리에 다른 메모가 있으면 **계단식으로 민다**
 * (정확히 겹쳐 놓으면 아래 장이 있는 줄도 모른다). 결과는 항상 판 안이다.
 */
export function spawnMemo(
  at: { x: number; y: number },
  existing: SessionMemo[],
  bounds: MemoBounds,
  now: number = Date.now(),
  rand: () => number = Math.random,
): SessionMemo {
  const step = SESSION_MEMO.CASCADE_STEP;
  let x = Math.round(at.x);
  let y = Math.round(at.y);
  // 같은 자리에 쌓인 만큼 밀어 놓는다(상한 장수만큼만 시도 — 무한 루프 ❌).
  for (let i = 0; i < SESSION_MEMO.MAX_PER_OWNER; i += 1) {
    const taken = existing.some((m) => Math.abs(m.x - x) < step && Math.abs(m.y - y) < step);
    if (!taken) break;
    x += step;
    y += step;
  }
  const memo: SessionMemo = {
    id: newMemoId(now, rand),
    text: '',
    x,
    y,
    w: SESSION_MEMO.DEFAULT_W,
    h: SESSION_MEMO.DEFAULT_H,
    color: SESSION_MEMO_DEFAULT_COLOR,
    createdAt: now,
    updatedAt: now,
  };
  return clampMemoRect(memo, bounds);
}

/**
 * 맨 앞으로 — **배열 순서가 곧 z-order** 다(뒤에 있을수록 위). 없는 id 면 원본 그대로.
 *
 * 합쳐진 장이면 **묶음 전원이 함께** 올라간다(서로의 상대 순서 = 탭 순서는 그대로). 한 장만
 * 올리면 한 카드의 탭들이 배열 안에서 흩어져, 그 카드가 다른 카드를 **뚫고** 그려진다.
 */
export function raiseMemo(memos: SessionMemo[], id: string): SessionMemo[] {
  const target = memos.find((m) => m.id === id);
  if (!target) return memos;
  const gid = target.groupId;
  const isMember = (m: SessionMemo): boolean => (gid ? m.groupId === gid : m.id === id);
  const group = memos.filter(isMember);
  if (group.length === 0) return memos;
  // 이미 맨 뒤에 통째로 모여 있으면 그대로 — 헛 저장이 나가지 않는다.
  if (memos.slice(memos.length - group.length).every(isMember)) return memos;
  return [...memos.filter((m) => !isMember(m)), ...group];
}

/** 한 장 갱신(`updatedAt` 자동). 바뀐 값이 없거나 없는 id 면 **같은 배열**. */
export function patchMemo(
  memos: SessionMemo[],
  id: string,
  patch: MemoPatch,
  now: number = Date.now(),
): SessionMemo[] {
  const idx = memos.findIndex((m) => m.id === id);
  if (idx < 0) return memos;
  const cur = memos[idx];
  if (!cur) return memos;
  const merged: SessionMemo = { ...cur, ...patch, updatedAt: now };
  // collapsed 는 false 를 남기지 않는다(기본값이라 없는 것과 같다 — 저장 비교가 흔들리지 않게).
  if (!merged.collapsed) delete merged.collapsed;
  // 이름도 같은 규약 — 빈 이름을 남기면 서버 정화본(필드 없음)과 글자가 달라 낙관 표시가 안 풀린다.
  //   비운다 = "자동 제목(본문 첫 줄)으로 되돌린다" 라는 뜻이기도 하다.
  if (merged.name !== undefined) {
    const cleanName = normalizeMemoName(merged.name);
    if (cleanName) merged.name = cleanName;
    else delete merged.name;
  }
  // alpha 도 같은 규약 — 기본값이면 필드를 지운다(서버 정화본과 글자 그대로 같아야 낙관 표시가 풀린다).
  if (merged.alpha === undefined || merged.alpha === SESSION_MEMO.DEFAULT_ALPHA) delete merged.alpha;
  // 이름은 **정화한 결과끼리** 견준다 — 없는 이름과 공백뿐인 이름은 같은 것이라, 그대로 비교하면
  //   같은 값을 다시 저장하며 `updatedAt` 만 흔든다(빈 칸에서 Enter 를 칠 때마다 왕복이 나간다).
  const same = (Object.keys(patch) as (keyof MemoPatch)[]).every((k) => (
    k === 'name' ? normalizeMemoName(cur.name) === normalizeMemoName(patch.name) : cur[k] === patch[k]
  ));
  if (same) return memos;
  // 합쳐진 장이면 **자리·크기·접힘은 묶음 전체의 값**이다 — 한 카드로 그려지므로 멤버끼리 어긋나면
  //   어느 것을 믿을지 규칙이 없다(정화의 `repairMemoGroups` 도 같은 규칙으로 보정한다).
  //   본문·이름·색·불투명도는 탭마다 따로다 — 그것이 "합쳤다"와 "하나가 됐다"의 차이다.
  const sharedTouched = GROUP_SHARED_KEYS.some((k) => k in patch);
  const gid = cur.groupId;
  if (!gid || !sharedTouched) {
    const next = [...memos];
    next[idx] = merged;
    return next;
  }
  return memos.map((m, i) => {
    if (i === idx) return merged;
    if (m.groupId !== gid) return m;
    const sibling: SessionMemo = { ...m, x: merged.x, y: merged.y, w: merged.w, h: merged.h, updatedAt: now };
    if (merged.collapsed === true) sibling.collapsed = true;
    else delete sibling.collapsed;
    return sibling;
  });
}

/** 한 장 제거. 없는 id 면 같은 배열. 묶음의 마지막 한 장이 남으면 그 묶음은 저절로 풀린다(정화). */
export function removeMemo(memos: SessionMemo[], id: string): SessionMemo[] {
  if (!memos.some((m) => m.id === id)) return memos;
  return repairMemoGroups(memos.filter((m) => m.id !== id));
}


// ─── 합침 (§5.5 #17-36 ⑩) ───

/**
 * 합쳐진 카드가 **공유하는** 값들. 한 카드로 그려지므로 자리·크기·접힘은 묶음 전체의 것이다.
 * 나머지(본문·이름·색·불투명도)는 탭마다 따로 — 그것이 "합쳤다"와 "하나로 뭉갰다"의 차이다.
 */
const GROUP_SHARED_KEYS = ['x', 'y', 'w', 'h', 'collapsed'] as const;

/** 새 묶음 이름표. `newMemoId` 와 같은 방식(시각+난수)이라 같은 ms 에 둘을 만들어도 안 겹친다. */
export function newMemoGroupId(now: number = Date.now(), rand: () => number = Math.random): string {
  return `mg-${now.toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

/** 화면에 그릴 카드 한 장 — 혼자인 장도, 여럿이 합쳐진 묶음도 여기서는 같은 모양이다. */
export interface MemoCard {
  /** React key. 묶음이면 이름표, 혼자면 그 장의 id. */
  key: string;
  /** 탭 순서 = 배열 순서. 혼자면 한 장. */
  members: SessionMemo[];
  /** 지금 보이는 장(= 활성 탭). 자리·크기는 이 장의 것을 쓴다. */
  active: SessionMemo;
  /** 1부터. 뒤에 있을수록 위. */
  zIndex: number;
}

/**
 * 목록 → **카드 목록**. 화면(층)은 장이 아니라 카드를 그린다.
 *
 * 카드의 z 는 **멤버 중 가장 뒤에 있는 것**의 자리다 — 그래야 묶음이 다른 카드를 뚫지 않는다.
 * 멤버가 배열에서 흩어져 있어도(옛 파일·다른 창이 만든 순서) 무너지지 않게 만든 것이 요점이다.
 */
export function memoCards(memos: SessionMemo[]): MemoCard[] {
  const groups = new Map<string, { members: SessionMemo[]; top: number }>();
  memos.forEach((m, i) => {
    const key = m.groupId ?? m.id;
    const hit = groups.get(key);
    if (hit) { hit.members.push(m); hit.top = i; }
    else groups.set(key, { members: [m], top: i });
  });
  return [...groups.entries()]
    .sort((a, b) => a[1].top - b[1].top)
    .map(([key, g], i) => {
      const marked = g.members.filter((m) => m.groupActive === true);
      const active = marked[marked.length - 1] ?? g.members[g.members.length - 1]!;
      return { key, members: g.members, active, zIndex: i + 1 };
    });
}

/** 이 장이 속한 카드의 멤버들(혼자면 자기 하나). */
function cardMembers(memos: SessionMemo[], memo: SessionMemo): SessionMemo[] {
  return memo.groupId ? memos.filter((m) => m.groupId === memo.groupId) : [memo];
}

/**
 * **합치기** — `dragId` 를 `targetId` 의 카드에 붙인다.
 *
 * `wholeCard` 가 참이면 끌어온 **카드 통째로**(카드 헤더를 끌어 다른 카드에 떨어뜨린 경우),
 * 거짓이면 그 **탭 한 장만** 옮긴다(탭을 뽑아 다른 카드에 떨어뜨린 경우). 두 동작을 한 함수로
 * 두는 이유는 결과가 같은 자료 구조이기 때문이다 — 갈라 두면 한쪽만 고치는 날이 온다.
 *
 * 규칙 셋. ① **자리·크기는 받는 쪽 카드가 정한다**(끌어온 것이 그 자리로 빨려 들어간다 —
 * 화면에서 본 그대로다). ② **끌어온 장이 활성 탭이 된다** — 방금까지 보던 것이 합치자마자
 * 사라지면 안 된다. ③ 탭 순서는 **받는 쪽 뒤에 이어 붙인다**(끼워 넣지 않는다 — 어디에 끼울지는
 * 사용자가 지정하지 않았다).
 */
export function mergeMemos(
  memos: SessionMemo[],
  dragId: string,
  targetId: string,
  wholeCard: boolean = true,
  now: number = Date.now(),
  rand: () => number = Math.random,
): SessionMemo[] {
  const drag = memos.find((m) => m.id === dragId);
  const target = memos.find((m) => m.id === targetId);
  if (!drag || !target || drag.id === target.id) return memos;
  const dragKey = drag.groupId ?? drag.id;
  const targetKey = target.groupId ?? target.id;
  if (dragKey === targetKey) return memos; // 이미 같은 카드 — 할 일이 없다.

  const gid = target.groupId ?? newMemoGroupId(now, rand);
  const targetSide = cardMembers(memos, target);
  const dragSide = wholeCard ? cardMembers(memos, drag) : [drag];
  const movingIds = new Set([...targetSide, ...dragSide].map((m) => m.id));

  const joined = [...targetSide, ...dragSide].map((m) => {
    const next: SessionMemo = {
      ...m,
      groupId: gid,
      x: target.x, y: target.y, w: target.w, h: target.h,
      updatedAt: now,
    };
    if (target.collapsed === true) next.collapsed = true;
    else delete next.collapsed;
    if (m.id === drag.id) next.groupActive = true;
    else delete next.groupActive;
    return next;
  });
  // 합친 카드는 맨 앞으로 — 방금 만든 것이 남의 뒤에 숨으면 안 된다.
  return repairMemoGroups([...memos.filter((m) => !movingIds.has(m.id)), ...joined]);
}

/**
 * **떼어내기** — 탭 한 장을 묶음에서 빼내 `at` 자리의 혼자 서는 카드로 만든다.
 *
 * 크기는 **떠나온 카드의 크기**를 물려받는다(원래 크기로 되돌리면 화면에서 갑자기 다른 물건이
 * 된다). 남은 묶음이 한 장뿐이면 그 묶음은 저절로 풀린다(정화) — "탭이 하나뿐인 탭 줄"은 없다.
 */
export function detachMemo(
  memos: SessionMemo[],
  id: string,
  at: { x: number; y: number },
  bounds: MemoBounds,
  now: number = Date.now(),
): SessionMemo[] {
  const memo = memos.find((m) => m.id === id);
  if (!memo || !memo.groupId) return memos;
  const solo: SessionMemo = clampMemoRect(
    { ...memo, x: Math.round(at.x), y: Math.round(at.y), updatedAt: now },
    bounds,
  );
  delete solo.groupId;
  delete solo.groupActive;
  // 떼어낸 장이 맨 앞 — 손에 들려 있던 것이 놓자마자 밑으로 들어가면 안 된다.
  return repairMemoGroups([...memos.filter((m) => m.id !== id), solo]);
}

/** 탭 전환 — 그 묶음에서 이 장을 보이게 한다. 자리·순서는 그대로다. */
export function activateMemoTab(memos: SessionMemo[], id: string, now: number = Date.now()): SessionMemo[] {
  const memo = memos.find((m) => m.id === id);
  if (!memo || !memo.groupId || memo.groupActive === true) return memos;
  const gid = memo.groupId;
  return memos.map((m) => {
    if (m.groupId !== gid) return m;
    const active = m.id === id;
    if ((m.groupActive === true) === active) return m;
    const next: SessionMemo = { ...m, updatedAt: now };
    if (active) next.groupActive = true;
    else delete next.groupActive;
    return next;
  });
}

/** 이동 — 시작 위치 + 델타를 판 안으로. */
export function moveMemo(memo: SessionMemo, start: { x: number; y: number }, dx: number, dy: number, bounds: MemoBounds): SessionMemo {
  return clampMemoRect({ ...memo, x: start.x + dx, y: start.y + dy }, bounds);
}

/** 크기 조절 — 시작 크기 + 델타를 하한/상한과 판 안으로. 왼쪽 위 모서리는 고정. */
export function resizeMemo(memo: SessionMemo, start: { w: number; h: number }, dx: number, dy: number, bounds: MemoBounds): SessionMemo {
  const maxW = Math.min(SESSION_MEMO.MAX_W, Math.max(SESSION_MEMO.MIN_W, Math.round(bounds.w) - memo.x));
  const maxH = Math.min(SESSION_MEMO.MAX_H, Math.max(SESSION_MEMO.MIN_H, Math.round(bounds.h) - memo.y));
  return {
    ...memo,
    w: clamp(start.w + dx, SESSION_MEMO.MIN_W, maxW),
    h: clamp(start.h + dy, SESSION_MEMO.MIN_H, maxH),
  };
}

// ─── 겹침 (§5.5 #17-36 ⑨) ───

/**
 * 카드 하나를 **대표하는** 장 — 혼자인 장, 그리고 묶음의 활성 탭. 배열 순서를 그대로 지킨다.
 *
 * 겹침은 장끼리가 아니라 **카드끼리** 재는 것이다. 합쳐진 멤버들은 같은 자리에 포개져 있으므로,
 * 대표를 고르지 않고 재면 한 카드가 자기 자신을 "N장 덮고 있다"고 신고한다.
 */
export function memoCardAnchors(memos: SessionMemo[]): SessionMemo[] {
  const seen = new Set<string>();
  const out: SessionMemo[] = [];
  for (const m of memos) {
    if (!m.groupId) { out.push(m); continue; }
    if (seen.has(m.groupId)) continue;
    seen.add(m.groupId);
    out.push(memos.find((x) => x.groupId === m.groupId && x.groupActive === true) ?? m);
  }
  return out;
}

/**
 * 이 장이 **화면에서 차지하는** 사각형. 접은 장은 제목줄 높이만 차지한다 — 펼침 높이(`h`)로 재면
 * 접어 둔 카드가 자기 아래의 멀쩡한 카드를 "가리고 있다"고 거짓 신고한다.
 */
export function memoShownRect(memo: SessionMemo): MemoRect {
  return { x: memo.x, y: memo.y, w: memo.w, h: memo.collapsed ? SESSION_MEMO.HEADER_H : memo.h };
}

/** 이 장의 **제목줄**만의 사각형 — "이름이 읽히는가"를 재는 자. */
export function memoHeaderRect(memo: SessionMemo): MemoRect {
  return { x: memo.x, y: memo.y, w: memo.w, h: SESSION_MEMO.HEADER_H };
}

/** 두 사각형이 실제로 겹치나(변끼리 맞닿은 것은 겹친 것이 아니다). */
export function rectsOverlap(a: MemoRect, b: MemoRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * `top` 이 `bottom` 의 **이름을 가리는가**. 겹침 판정의 기준을 넓이가 아니라 **제목줄**로 삼은 것이
 * 이 기능의 핵심 결정이다 — 사용자가 잃는 것은 "본문 몇 픽셀"이 아니라 **그 메모가 거기 있다는 사실**
 * 이기 때문이다. 모서리가 2px 스친 것까지 "겹쳤다"고 배지를 띄우면 배지가 소음이 된다.
 */
export function hidesMemoHeader(top: SessionMemo, bottom: SessionMemo): boolean {
  return rectsOverlap(memoShownRect(top), memoHeaderRect(bottom));
}

/**
 * 각 장이 **자기 밑에 깔아 놓은** 장수(= 이름이 안 보이게 만든 장수). 배열 순서가 곧 z-order 라
 * 뒤에 있는 장이 앞의 장을 덮는다. 배지는 **덮은 쪽**이 단다 — 덮인 쪽은 손이 닿지 않으므로
 * (완전히 가려지면 hover 도 클릭도 못 한다) 그쪽에 손잡이를 달면 영영 못 누른다.
 */
export function stackedUnderCounts(memos: SessionMemo[]): Map<string, number> {
  const anchors = memoCardAnchors(memos);
  const out = new Map<string, number>();
  for (let i = 0; i < anchors.length; i += 1) {
    const top = anchors[i];
    if (!top) continue;
    let n = 0;
    for (let j = 0; j < i; j += 1) {
      const bottom = anchors[j];
      if (bottom && hidesMemoHeader(top, bottom)) n += 1;
    }
    out.set(top.id, n);
  }
  return out;
}

/** 판에 겹친 **카드**가 하나라도 있나 — 우클릭 메뉴가 [펼치기]를 보일지 정하는 값(판 크기 불필요). */
export function hasHiddenMemoHeaders(memos: SessionMemo[]): boolean {
  const anchors = memoCardAnchors(memos);
  for (let i = 0; i < anchors.length; i += 1) {
    const top = anchors[i];
    if (!top) continue;
    for (let j = 0; j < i; j += 1) {
      const bottom = anchors[j];
      if (bottom && hidesMemoHeader(top, bottom)) return true;
    }
  }
  return false;
}

/**
 * 이 장이 덮고 있는 것 중 **바로 밑장**을 맨 앞으로. 한 번 누를 때마다 한 겹씩 벗겨 내는 열람이라,
 * 쌓아 둔 뭉치를 흩지 않고도 안쪽을 볼 수 있다(자리 이동 ❌ — 순서만 바뀐다).
 */
export function raiseNextUnder(memos: SessionMemo[], id: string): SessionMemo[] {
  const idx = memos.findIndex((m) => m.id === id);
  const top = idx >= 0 ? memos[idx] : undefined;
  if (!top) return memos;
  for (let j = idx - 1; j >= 0; j -= 1) {
    const bottom = memos[j];
    if (bottom && hidesMemoHeader(top, bottom)) return raiseMemo(memos, bottom.id);
  }
  return memos;
}

/** 이 자리에 놓으면 이미 놓인 것들과 부딪히나. `strict` 면 넓이 전체, 아니면 제목줄만 본다. */
function collides(rect: MemoRect, placed: MemoRect[], strict: boolean): boolean {
  return placed.some((p) => (
    strict
      ? rectsOverlap(rect, p)
      : rectsOverlap(p, { ...rect, h: SESSION_MEMO.HEADER_H }) || rectsOverlap(rect, { ...p, h: SESSION_MEMO.HEADER_H })
  ));
}

/**
 * 제자리에서 고리를 넓혀 가며 **가장 가까운 빈자리**를 찾는다. 좌상단으로 몰아 다시 쌓는 대신
 * 원래 자리 근처에 두는 것이 의도다 — 사용자가 "왼쪽 위에 둔 것"과 "오른쪽 아래에 둔 것"의
 * 뜻을 [펼치기] 한 번이 지워 버리면 안 된다.
 */
function findFreeSpot(
  memo: SessionMemo,
  placed: MemoRect[],
  bounds: MemoBounds,
  strict: boolean,
): { x: number; y: number } | null {
  const step = SESSION_MEMO.CASCADE_STEP;
  const rect = memoShownRect(memo);
  const maxX = Math.max(0, Math.round(bounds.w) - memo.w);
  const maxY = Math.max(0, Math.round(bounds.h) - rect.h);
  for (let ring = 1; ring <= SESSION_MEMO.SPREAD_MAX_RING; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        // 고리의 **테두리**만 본다(안쪽은 이미 지난 고리에서 봤다).
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = memo.x + dx * step;
        const y = memo.y + dy * step;
        if (x < 0 || y < 0 || x > maxX || y > maxY) continue;
        if (!collides({ ...rect, x, y }, placed, strict)) return { x, y };
      }
    }
  }
  return null;
}

/**
 * 겹쳐 둔 것을 **떼어 놓는다**. 규칙 셋.
 *  ① **겹치지 않은 장은 손대지 않는다** — 잘 놓아둔 것까지 흩는 정리는 정리가 아니다.
 *  ② **뭉치의 맨 아래 장이 자리를 지킨다** — 위에 얹은 것이 비켜서는 것이 사람의 기대다.
 *  ③ **완전히 떼어 놓을 수 없으면 이름만이라도 보이게** — 판이 좁으면 완전 분리가 불가능하고,
 *     그때 "아무 일도 안 일어남"으로 끝나면 사용자에게는 고장이다. 2차로 제목줄 기준으로 다시 찾는다.
 *
 * 한 장도 안 움직였으면 **같은 배열**을 돌려준다(헛 저장 ❌).
 */
export function spreadOverlappingMemos(
  memos: SessionMemo[],
  bounds: MemoBounds,
  now: number = Date.now(),
): SessionMemo[] {
  if (bounds.w <= 0 || bounds.h <= 0 || memos.length < 2) return memos;
  // 자리를 다투는 것은 **카드**다 — 합쳐진 탭들은 같은 자리에 포개진 한 몸이라 대표만 센다.
  const anchors = memoCardAnchors(memos);
  if (anchors.length < 2) return memos;
  const tangled = new Set<string>();
  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    if (!a) continue;
    for (let j = 0; j < i; j += 1) {
      const b = anchors[j];
      if (!b) continue;
      if (hidesMemoHeader(a, b)) { tangled.add(a.id); tangled.add(b.id); }
    }
  }
  if (tangled.size === 0) return memos;

  // 안 엉킨 카드들은 그 자리에 못 박고 **장애물**로 쓴다.
  const placed: MemoRect[] = anchors.filter((m) => !tangled.has(m.id)).map(memoShownRect);
  /** 옮겨 갈 자리 — 카드의 대표 id(혼자면 자기 id, 묶음이면 이름표) 기준. */
  const moves = new Map<string, { x: number; y: number }>();
  for (const m of anchors) {
    if (!tangled.has(m.id)) continue;
    const rect = memoShownRect(m);
    if (!collides(rect, placed, true)) { placed.push(rect); continue; }
    const spot = findFreeSpot(m, placed, bounds, true) ?? findFreeSpot(m, placed, bounds, false);
    if (!spot) { placed.push(rect); continue; } // 판이 꽉 찼다 — 제자리에 둔다(잃는 것 ❌).
    placed.push({ ...rect, x: spot.x, y: spot.y });
    moves.set(m.groupId ?? m.id, spot);
  }
  if (moves.size === 0) return memos;
  // 카드가 움직이면 **그 카드의 탭 전원**이 함께 간다(멤버끼리 좌표가 갈리면 안 된다).
  return memos.map((m) => {
    const spot = moves.get(m.groupId ?? m.id);
    return spot ? { ...m, x: spot.x, y: spot.y, updatedAt: now } : m;
  });
}

/**
 * 배경색에 맞는 글자색 — 밝은 종이면 검정, 어두우면 흰색.
 * `pickReadableTextColor`(코멘트 박스)와 같은 YIQ 근사지만, 이 파일은 클라 IDE 전용이라
 * 그쪽 유틸을 그대로 가져다 쓴다(중복 구현 ❌ — `utils/commentBoxStyle.ts`).
 */
export { pickReadableTextColor };


// ─── 종이의 겉모습 (색 × 불투명도) ───

/**
 * 메모가 놓인 바닥색 — IDE 본문(`bg-gray-950`). 합성 결과를 계산할 기준이라 상수로 박아 둔다.
 *
 * 왜 필요한가: 메모는 이제 **반투명 유리판**이라, 사용자가 고른 `color` 는 화면에 그대로 나오지
 * 않는다. 알파 0.3 짜리 밝은 종이는 실제로는 어두운 회색으로 보이는데, 글자색을 `color` 로
 * 판정하면 그 위에 **검은 글씨**를 얹어 아무것도 안 읽힌다. 그래서 판정은 항상 합성 결과로 한다.
 */
export const MEMO_BASE_SURFACE = '#030712';

/** 한 장의 실제 불투명도 — 필드가 없으면 기본값(§ 저장은 기본값을 생략한다). */
export function memoAlpha(memo: Pick<SessionMemo, 'alpha'>): number {
  const a = memo.alpha;
  if (typeof a !== 'number' || !Number.isFinite(a)) return SESSION_MEMO.DEFAULT_ALPHA;
  return Math.max(SESSION_MEMO.MIN_ALPHA, Math.min(SESSION_MEMO.MAX_ALPHA, a));
}

/** `#RRGGBB` → [r,g,b]. 모양이 어긋나면 기본색으로 떨어진다(style 로 새는 값 ❌). */
export function hexToRgbTriple(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  const body = m?.[1] ?? SESSION_MEMO_DEFAULT_COLOR.slice(1);
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** 알파를 얹은 색을 바닥색 위에 합성한 결과(= 눈에 보이는 색). */
export function compositeOver(hex: string, alpha: number, baseHex: string = MEMO_BASE_SURFACE): string {
  const [r, g, b] = hexToRgbTriple(hex);
  const [br, bg, bb] = hexToRgbTriple(baseHex);
  const a = Math.max(0, Math.min(1, alpha));
  return toHex([r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTriple(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000})`;
}

/** 한 장의 겉모습 — 화면은 이 값만 style 로 옮겨 적는다(색 산수는 전부 여기서). */
export interface MemoSurface {
  /** 카드 배경(반투명). */
  background: string;
  /** 눈에 보이는 색 `#RRGGBB` — 글자색 판정의 기준. */
  composite: string;
  /** 본문 글자색. */
  text: string;
  /** 테두리. */
  border: string;
  /** 제목줄에 한 겹 더 얹는 색(밝은 판이면 어둡게, 어두운 판이면 밝게). */
  headerTint: string;
  /** 구분선·손잡이처럼 글자보다 옅게 그리는 선. */
  hairline: string;
  /** 위쪽 유리 하이라이트(inset shadow). */
  glassEdge: string;
  /** 뒤를 흐릴지 — 거의 불투명하면 흐릴 것이 없다(불필요한 backdrop-filter 는 합성 비용만 든다). */
  blur: boolean;
}

/** 거의 불투명하면 `backdrop-filter` 를 걸지 않는다 — 비칠 것이 없는데 합성기만 돌린다. */
const OPAQUE_ENOUGH = 0.97;

/**
 * 색 + 불투명도 → 화면에 쓸 값들. **순수 함수라 테스트로 못 박을 수 있다** — "투명하게 낮췄더니
 * 글씨가 안 보인다"는 눈으로 잡기 어려운 종류의 실패다.
 */
export function memoSurface(color: string, alpha: number, baseHex: string = MEMO_BASE_SURFACE): MemoSurface {
  const composite = compositeOver(color, alpha, baseHex);
  const text = pickReadableTextColor(composite);
  const light = text === '#0F172A'; // 밝은 판 = 어두운 글자
  return {
    background: rgba(color, alpha),
    composite,
    text,
    border: light ? 'rgba(15, 23, 42, 0.28)' : 'rgba(255, 255, 255, 0.14)',
    headerTint: light ? 'rgba(15, 23, 42, 0.07)' : 'rgba(255, 255, 255, 0.07)',
    hairline: light ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.12)',
    glassEdge: light ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.10)',
    blur: alpha < OPAQUE_ENOUGH,
  };
}
