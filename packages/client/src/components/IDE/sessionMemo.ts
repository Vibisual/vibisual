import { SESSION_MEMO, SESSION_MEMO_DEFAULT_COLOR, type SessionMemo } from '@vibisual/shared';
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
export type MemoPatch = Partial<Pick<SessionMemo, 'text' | 'x' | 'y' | 'w' | 'h' | 'color' | 'alpha' | 'collapsed'>>;

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

/** 맨 앞으로 — **배열 순서가 곧 z-order** 다(뒤에 있을수록 위). 없는 id 면 원본 그대로. */
export function raiseMemo(memos: SessionMemo[], id: string): SessionMemo[] {
  const idx = memos.findIndex((m) => m.id === id);
  if (idx < 0 || idx === memos.length - 1) return memos;
  const next = [...memos];
  const [hit] = next.splice(idx, 1);
  if (hit) next.push(hit);
  return next;
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
  // alpha 도 같은 규약 — 기본값이면 필드를 지운다(서버 정화본과 글자 그대로 같아야 낙관 표시가 풀린다).
  if (merged.alpha === undefined || merged.alpha === SESSION_MEMO.DEFAULT_ALPHA) delete merged.alpha;
  const same = (Object.keys(patch) as (keyof MemoPatch)[]).every((k) => cur[k] === patch[k]);
  if (same) return memos;
  const next = [...memos];
  next[idx] = merged;
  return next;
}

/** 한 장 제거. 없는 id 면 같은 배열. */
export function removeMemo(memos: SessionMemo[], id: string): SessionMemo[] {
  if (!memos.some((m) => m.id === id)) return memos;
  return memos.filter((m) => m.id !== id);
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
