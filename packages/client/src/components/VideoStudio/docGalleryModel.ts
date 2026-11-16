import { formatOfSize, formatRatioLabel, type VideoFormatId } from '@vibisual/video';

import type { BoxTier } from '../../utils/boxTier.js';
import { formatCheckedAgo } from '../Panel/modelSectionView.js';
import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-1 — 문서 갤러리의 순수 판단(검색·정렬·배치·글자). 화면은 이 값을 그대로 그린다.
 */

/** 처음 그리는 카드 수 — 목록 끝에 닿을 때마다 이만큼 더 그린다(수백 개여도 첫 열림이 가볍다). */
export const GALLERY_PAGE = 48;

/** 이보다 오래된 문서는 상대 표기("120일 전") 대신 날짜로 쓴다. */
const RELATIVE_UNTIL_MS = 14 * 24 * 60 * 60 * 1000;

export interface GalleryLayout {
  readonly columns: number;
  /** 목록 격자 클래스(Tailwind 는 클래스를 글자 그대로 찾는다 — 열 수로 이어 붙이지 않는다). */
  readonly gridClass: string;
  /** 판 폭 — 화면 폭에 clamp 한 값(고정 폭 ❌). */
  readonly panelClass: string;
  /** 한 열이면 포스터가 왼쪽에 서는 가로 줄이다. */
  readonly row: boolean;
}

/** 창 폭 등급 → 열 수와 판 폭. 판이 포털이라 `box-*` 변형이 안 닿으므로 JS 로 고른다. 못 쟀으면 넓은 배치. */
export function galleryLayout(tier: BoxTier): GalleryLayout {
  switch (tier) {
    case 'narrow': return { columns: 1, gridClass: 'grid-cols-1', row: true, panelClass: 'w-[min(26rem,calc(100vw-1rem))]' };
    case 'compact': return { columns: 2, gridClass: 'grid-cols-2', row: false, panelClass: 'w-[min(38rem,calc(100vw-1rem))]' };
    case 'wide': return { columns: 4, gridClass: 'grid-cols-4', row: false, panelClass: 'w-[min(64rem,calc(100vw-1rem))]' };
    default: return { columns: 3, gridClass: 'grid-cols-3', row: false, panelClass: 'w-[min(52rem,calc(100vw-1rem))]' };
  }
}

/** 검색용 글자 — 합쳐 쓴 한글(NFC)·대소문자·앞뒤 공백을 맞춘다. 입력 중인 자모도 그대로 부분 일치한다. */
export function searchKey(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().trim();
}

/** 보이는 이름 — 제목이 비었으면 id. */
export function docLabel(doc: Pick<DocSummary, 'id' | 'title'>): string {
  return doc.title.trim() === '' ? doc.id : doc.title;
}

/** 고친 시각 최근순(같으면 이름순) 위에 제목 부분 일치를 건다. 원본은 건드리지 않는다. */
export function galleryRows(docs: readonly DocSummary[], query: string): DocSummary[] {
  const needle = searchKey(query);
  const rows = needle === '' ? [...docs] : docs.filter((d) => searchKey(docLabel(d)).includes(needle));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || docLabel(a).localeCompare(docLabel(b)));
}

/** 판형 — 크기를 모르는 옛 서버 응답이면 `null`. */
export function docFormat(doc: Pick<DocSummary, 'width' | 'height'>): VideoFormatId | null {
  return doc.width && doc.height ? formatOfSize({ width: doc.width, height: doc.height }) : null;
}

export function docRatioLabel(doc: Pick<DocSummary, 'width' | 'height'>): string | null {
  const format = docFormat(doc);
  return format ? formatRatioLabel(format) : null;
}

/** 길이 — `m:ss`(한 시간 넘으면 `h:mm:ss`). 모르면 `null`. */
export function formatDocLength(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 고친 시각 — 2주 안이면 상대 표기(`Intl.RelativeTimeFormat`), 아니면 날짜. */
export function formatEditedAt(updatedAt: number, now: number, locale: string): string {
  if (now - updatedAt <= RELATIVE_UNTIL_MS) {
    const ago = formatCheckedAgo(updatedAt, now, locale);
    if (ago) return ago;
  }
  try { return new Date(updatedAt).toLocaleDateString(locale); } catch { return new Date(updatedAt).toLocaleDateString(); }
}

export type GalleryKeyAction =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'close' }
  | { readonly kind: 'none' };

/**
 * 검색 칸 키 → 동작. 한글 조합 중(`composing`)에는 어떤 키도 가로채지 않는다(조합 확정용 Enter·방향키가 목록을 움직이면 안 된다).
 * 위·아래는 목록 순서로 한 칸씩(격자에서도 — 열 수를 몰라도 되게), 가장자리에서 돌지 않는다. 좌우·Home·End 는 입력 칸의 커서 몫이다.
 */
export function galleryKeyAction(key: string, state: { readonly composing: boolean; readonly count: number; readonly active: number }): GalleryKeyAction {
  if (state.composing) return { kind: 'none' };
  const last = state.count - 1;
  switch (key) {
    case 'ArrowDown': return last < 0 ? { kind: 'none' } : { kind: 'move', index: Math.min(last, state.active + 1) };
    case 'ArrowUp': return last < 0 ? { kind: 'none' } : { kind: 'move', index: Math.max(0, state.active - 1) };
    case 'Enter': return state.active >= 0 && state.active <= last ? { kind: 'open' } : { kind: 'none' };
    case 'Escape': return { kind: 'close' };
    default: return { kind: 'none' };
  }
}
