/** 옵션·가이드·원격 접속 창의 「왼쪽 목록 + 본문」 클래스 한 벌(§4). 폰(767px 이하)에선 목록을 위쪽 가로 띠로 올린다(옆이면 본문이 200px 남짓). */

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
