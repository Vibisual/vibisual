import type { EditorPaneFileKind } from '@vibisual/shared';

/**
 * paneKinds.tsx — §5.5 #17-27 ⑱ 우측 판 갈래의 **이름표 한 벌**(문구 키 · 글리프).
 *
 * 같은 갈래가 네 자리에 선다 — 탭 줄 [우측 판] 목록 · 빈 탭의 라벨 · 빈 탭 머리 · 보기의 [파일 열기].
 * 자리마다 그림과 이름을 따로 들면 같은 것을 여는 손잡이가 서로 다른 그림이 된다(무대 탭 ㉔ 이 세운
 * 규약 — "같은 것을 여는 손잡이는 같은 그림"). 그래서 여기 한 곳에 둔다.
 *
 * 문구는 키만 든다 — 번역은 그리는 자리의 `t()` 가 한다(모듈 레벨에서 글자를 지으면 언어를 바꿔도
 * 따라가지 않는다 — i18n 규칙 「모듈 레벨 상수 패턴」).
 */

export interface PaneKindText {
  /** 목록 · 빈 탭 라벨에 서는 이름 */
  readonly label: string;
  /** 목록 줄의 한 줄 설명 */
  readonly desc: string;
  /** 빈 탭 머리 제목("웹 페이지 열기") */
  readonly open: string;
  /** 그 갈래의 파일이 하나도 없을 때 */
  readonly empty: string;
}

export const PANE_KIND_TEXT: Readonly<Record<EditorPaneFileKind, PaneKindText>> = {
  code: {
    label: 'ide.paneLauncher.kinds.code.label',
    desc: 'ide.paneLauncher.kinds.code.desc',
    open: 'ide.paneLauncher.kinds.code.open',
    empty: 'ide.paneLauncher.kinds.code.empty',
  },
  html: {
    label: 'ide.paneLauncher.kinds.html.label',
    desc: 'ide.paneLauncher.kinds.html.desc',
    open: 'ide.paneLauncher.kinds.html.open',
    empty: 'ide.paneLauncher.kinds.html.empty',
  },
  image: {
    label: 'ide.paneLauncher.kinds.image.label',
    desc: 'ide.paneLauncher.kinds.image.desc',
    open: 'ide.paneLauncher.kinds.image.open',
    empty: 'ide.paneLauncher.kinds.image.empty',
  },
  pdf: {
    label: 'ide.paneLauncher.kinds.pdf.label',
    desc: 'ide.paneLauncher.kinds.pdf.desc',
    open: 'ide.paneLauncher.kinds.pdf.open',
    empty: 'ide.paneLauncher.kinds.pdf.empty',
  },
};

/**
 * 갈래 글리프(lucide 톤 stroke path). 웹 페이지 = 지구본 · 코드 = 꺾쇠 — 판 손잡이 줄의 [페이지]/[소스]
 * 토글(⑮)이 이미 쓰는 그 그림이다(같은 뜻은 같은 그림).
 */
const PANE_KIND_GLYPH: Readonly<Record<EditorPaneFileKind, readonly string[]>> = {
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  html: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21',
  ],
  pdf: [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ],
};

/** 실행 출력(#17-20 ④) — 터미널 상자. 목록의 실행 줄이 쓴다. */
const RUN_OUTPUT_GLYPH: readonly string[] = [
  'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  'M7 11l2-2-2-2',
  'M11 13h4',
];

/** 탭 줄 [우측 판] 손잡이 — 오른쪽에 판이 붙은 창(lucide `panel-right`). */
const PANE_LAUNCHER_GLYPH: readonly string[] = [
  'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  'M15 3v18',
];

/** 보기의 [파일 열기] — 펼친 폴더(lucide `folder-open`). */
const OPEN_FILE_GLYPH: readonly string[] = [
  'M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2',
];

function StrokeGlyph({ paths, className }: { paths: readonly string[]; className: string }): React.JSX.Element {
  return (
    <svg
      className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function PaneKindGlyph({ kind, className = 'h-3.5 w-3.5 flex-shrink-0' }: {
  kind: EditorPaneFileKind;
  className?: string;
}): React.JSX.Element {
  return <StrokeGlyph paths={PANE_KIND_GLYPH[kind]} className={className} />;
}

export function RunOutputGlyph({ className = 'h-3.5 w-3.5 flex-shrink-0' }: { className?: string }): React.JSX.Element {
  return <StrokeGlyph paths={RUN_OUTPUT_GLYPH} className={className} />;
}

export function PaneLauncherGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }): React.JSX.Element {
  return <StrokeGlyph paths={PANE_LAUNCHER_GLYPH} className={className} />;
}

export function OpenFileGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }): React.JSX.Element {
  return <StrokeGlyph paths={OPEN_FILE_GLYPH} className={className} />;
}
