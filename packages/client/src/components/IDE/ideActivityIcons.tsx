import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * §5.5 #16-1 — 활동바 항목의 **글리프 한 벌**.
 *
 * 정본 표(`ideActivityItems.ts`)에서 아이콘만 떼어 온 곳이다 — 저쪽은 순수 데이터라 JSX 를
 * 들지 않는다(그래야 순서·제외 로직이 렌더 없이 테스트된다). 여기 모아 둔 덕에 활동바와
 * 구성 패널이 **같은 글리프**를 그린다: 패널에서 고르는 그림과 활동바에 서는 그림이 다르면
 * 무엇을 내려놓는지 알 수 없다.
 *
 * 전부 lucide 톤 stroke SVG 다(이모지 ❌ — CLAUDE.md 아이콘 규약). 색은 `currentColor` 로 받아
 * 부모 `text-*` 가 정한다(점등/회색 자동 추종).
 */

/** 뷰별 SVG 자식. `<svg>` 껍데기는 아래 `ActivityIcon` 이 씌운다(속성이 한 벌이어야 한다). */
function glyphOf(view: IDEViewType): React.JSX.Element | null {
  switch (view) {
    // 꽂는 것(lucide plug 톤).
    case 'mcp':
      return <path d="M12 22v-5 M9 8V2 M15 8V2 M6 8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />;
    case 'files':
      return <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />;
    // 쌓여 들어가는 층(lucide layers 톤) — 이 프롬프트 앞에 무엇이 겹쳐 실리는가.
    case 'context':
      return <path d="M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5" />;
    // lucide sparkles 톤.
    case 'skills':
      return <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />;
    // lucide webhook 톤.
    case 'hooks':
      return (
        <>
          <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
          <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
          <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
        </>
      );
    // lucide puzzle 톤.
    case 'plugins':
      return <path d="M15.5 3.5a2.5 2.5 0 0 0-5 0V5H7a2 2 0 0 0-2 2v3.5H3.5a2.5 2.5 0 0 0 0 5H5V19a2 2 0 0 0 2 2h3.5v-1.5a2.5 2.5 0 0 1 5 0V21H19a2 2 0 0 0 2-2v-3.5h-1.5a2.5 2.5 0 0 1 0-5H21V7a2 2 0 0 0-2-2h-3.5z" />;
    case 'goal':
      return (
        <>
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
        </>
      );
    // §5.10 (P) 절차 감지 — **훑는 테두리 안에 절차(줄) 셋.** 목표(동심원 과녁)와 루프(되풀이 화살표)
    //   둘 다와 멀어야 해서 모양을 통째로 달리 잡았다: 네 귀퉁이는 "훑고 있다", 안의 세 줄은
    //   "그렇게 알아낸 절차". 20px 에서도 귀퉁이와 줄이 서로 먹지 않는 간격으로 뒀다.
    case 'autoGoal':
      return (
        <>
          <path d="M3 8V6a2 2 0 0 1 2-2h2M16 4h3a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-3M8 20H5a2 2 0 0 1-2-2v-2" />
          <path d="M8 9.5h8M8 12.5h8M8 15.5h4.5" />
        </>
      );
    case 'loop':
      return (
        <>
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </>
      );
    // 재생 + 벌레(VS Code 의 Run and Debug 와 같은 뜻).
    case 'debug':
      return (
        <>
          <path d="M4 4l7 4-7 4z" />
          <rect x="10" y="11" width="8" height="8" rx="4" />
          <path d="M10 15H7M18 15h3M11.5 11.5L10 9M16.5 11.5L18 9M11.5 19l-1.5 2M16.5 19l1.5 2" />
        </>
      );
    case 'verify':
      return (
        <>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </>
      );
    // 펼친 책 + 확인 표시(lucide book-open-check 톤) — "끝까지 읽고 확인했다".
    case 'specReading':
      return (
        <>
          <path d="M12 7a3 3 0 0 0-3-3H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h5a3 3 0 0 1 3 3z" />
          <path d="M12 21V7a3 3 0 0 1 3-3h5a1 1 0 0 1 1 1v5" />
          <path d="m16 17 2 2 4-5" />
        </>
      );
    case 'subagents':
      return (
        <>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </>
      );
    case 'bookmarks':
      return <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />;
    default:
      return null;
  }
}

/** 활동바·구성 패널이 함께 쓰는 글리프. `className` 으로 크기·색·애니메이션을 준다. */
export function ActivityIcon({ view, className }: {
  view: IDEViewType;
  className?: string;
}): React.JSX.Element | null {
  const glyph = glyphOf(view);
  if (!glyph) return null;
  return (
    <svg
      className={className ?? 'h-5 w-5'}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {glyph}
    </svg>
  );
}
