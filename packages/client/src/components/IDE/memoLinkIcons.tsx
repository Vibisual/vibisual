import type { SessionMemoLinkKind } from '@vibisual/shared';

/**
 * memoLinkIcons.tsx — §5.5 #17-36 ⑫ 메모 링크가 쓰는 글리프 한 벌(lucide 톤 인라인 stroke SVG).
 *
 * 메뉴(종류 목록)·링크 상자·입력 창이 **같은 그림**을 써야 "이 줄이 저 종류"가 눈으로 이어진다 —
 * 자리마다 따로 그리면 하나만 바뀌는 날이 온다. 색은 `currentColor` 라 부모 글자색을 따른다.
 */

export type MemoLinkIconName =
  | 'link' | 'unlink' | 'follow' | 'repick' | 'pick' | 'prompt'
  | SessionMemoLinkKind;

const PATHS: Record<MemoLinkIconName, React.JSX.Element> = {
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  unlink: (
    <>
      <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M8 2v3" />
      <path d="M2 8h3" />
      <path d="M16 19v3" />
      <path d="M19 16h3" />
    </>
  ),
  follow: (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  ),
  repick: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  pick: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M22 12h-4" />
      <path d="M6 12H2" />
      <path d="M12 6V2" />
      <path d="M12 22v-4" />
    </>
  ),
  prompt: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // 세션 글 위치 — 대화 속 한 대목(인용 줄).
  stream: (
    <>
      <path d="M17 6H3" />
      <path d="M21 12H8" />
      <path d="M21 18H8" />
      <path d="M3 12v6" />
    </>
  ),
  // 다른 세션 — 탭 하나.
  session: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 8h20" />
      <path d="M8 4v4" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </>
  ),
  url: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  ),
};

export function MemoLinkIcon({ name, className = 'h-3.5 w-3.5' }: { name: MemoLinkIconName; className?: string }): React.JSX.Element {
  return (
    <svg
      className={`flex-shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
