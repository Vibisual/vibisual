/**
 * 옵션·가이드·원격 접속 창이 함께 쓰는 「왼쪽 목록 + 오른쪽 본문」 뼈대의 클래스(§4 v3.16 폰 반응형).
 *
 * 데스크톱은 종전 그대로 왼쪽 세로 목록(176px)이다. 폰(767px 이하)에서는 세 창 모두 전체 시트가 되는데,
 * 목록을 112px 로 좁혀 옆에 두던 종전 배치로는 본문이 200px 남짓만 남아 글이 몇 자씩 꺾였다. 그래서 폰에서는
 * 목록을 **위쪽 가로 띠**로 올리고(가로로 밀어 본다) 본문이 폭을 다 쓰게 한다 — 목록을 지우지 않고 접는다.
 *
 * 세 창이 같은 값을 따로 들고 있으면 한 곳만 고쳐져 창마다 생김새가 갈린다. 그래서 여기 한 벌만 둔다.
 */

/** 목록 + 본문을 담는 몸통. 폰에서는 위아래로 쌓는다. */
export const WINDOW_NAV_BODY = 'flex flex-1 overflow-hidden max-md:flex-col';

/** 왼쪽 목록. 폰에서는 본문 위의 가로 띠 — 넘치면 가로로 민다. */
export const WINDOW_NAV_LIST =
  'w-44 shrink-0 overflow-y-auto border-r border-gray-700/50 bg-gray-900/40 py-2 '
  + 'max-md:flex max-md:w-full max-md:overflow-x-auto max-md:overflow-y-hidden max-md:border-b max-md:border-r-0 max-md:py-0';

/** 목록 한 칸. 데스크톱은 왼쪽 선, 폰 가로 띠에서는 아래 선이 고른 칸을 표시한다. */
export function windowNavItemClass(active: boolean): string {
  return `flex w-full items-center gap-2 px-3 py-2 text-left text-xs max-md:w-auto max-md:shrink-0 max-md:whitespace-nowrap max-md:border-l-0 max-md:border-b-2 max-md:py-2.5 ${
    active
      ? 'border-l-2 border-blue-500 bg-blue-500/10 text-white'
      : 'border-l-2 border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
  }`;
}

/** 오른쪽 본문. 폰에서는 여백을 조금 줄여 글 폭을 돌려준다. */
export const WINDOW_NAV_PANE = 'min-h-0 flex-1 overflow-y-auto p-5 max-md:p-4';
