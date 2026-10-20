import type { FileFaceFamily, FileFaceKind } from '@vibisual/shared';

/**
 * §5.1 #2-1 (A) — 파일 얼굴의 **종류 글리프**. lucide 톤 stroke 한 획(이모지 ❌ — CLAUDE.md UI 아이콘 규칙).
 *
 * 경로는 lucide(ISC 라이선스) 아이콘의 획을 그대로 옮긴 것이다 — 미디어 넷은 앱 레지스트리·구슬 줄이 이미 쓰는 획과
 * **같은 그림**이라 같은 종류는 캔버스 어디서 보든 같은 모양이다(영상 = 재생 화면 · 사진 = 액자 · 소리 = 파형 · 3D = 정육면체).
 */
const KIND_GLYPH_PATHS: Readonly<Record<FileFaceKind, string>> = {
  video: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 9l5 3-5 3z',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21',
  audio: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 11v2',
  model: 'M12 2.6 21 7.3v9.4L12 21.4 3 16.7V7.3zM3 7.3 12 12l9-4.7M12 12v9.4',
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  data: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1',
  doc: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
  subtitle: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M15 15h2M7 11h2M13 11h4',
  font: 'M4 7V4h16v3M9 20h6M12 4v16',
  other: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6',
};

export interface FileKindGlyphProps {
  readonly kind: FileFaceKind;
  /** 한 변(px). 캔버스 월드 좌표라 줌을 따라간다. */
  readonly px: number;
  /** 획 색 — 버블 본체 위에서는 흰색, 배지 안에서는 테 색. */
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}

/** 종류 글리프 한 개. 장식이라 스크린 리더에서는 숨긴다(이름은 라벨·툴팁이 말한다). */
export function FileKindGlyph({ kind, px, color = 'white', strokeWidth = 2, className }: FileKindGlyphProps): React.JSX.Element {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'shrink-0'}
    >
      <path d={KIND_GLYPH_PATHS[kind]} />
    </svg>
  );
}

// ─── §5.1 #2-1 (G) ⑤ 갈래 아이콘 ───

/** 원 한 개를 path 로(두 호) — 획 하나 문법을 지키려고 `<circle>` 대신 쓴다. */
function ring(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

/**
 * §5.1 #2-1 (G) ⑤ — **갈래 아이콘**. 미리보기가 없을 때(굽지 않는 형식 · 성능 기준이 막았을 때 · 굽는 중) 그 파일이 무엇인지
 * 말한다. 우리가 그린 stroke 획이다(24 격자 · lucide 톤 · 이모지 ❌ · 남의 브랜드 로고 ❌). 기본 갈래(종류와 같은 이름)는 위의
 * 종류 글리프를 그대로 쓴다 — 같은 종류는 캔버스 어디서 보든 같은 모양이다.
 */
const FAMILY_GLYPH_PATHS: Readonly<Record<Exclude<FileFaceFamily, FileFaceKind>, string>> = {
  // 영상 — 카메라 RAW·날 스트림(영화 카메라) · 모션 그래픽(튀는 공의 궤적) · 편집 원본(슬레이트)
  videoRaw: `M3 9h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM15 12l6-3v10l-6-3${ring(5.5, 5.5, 2.5)}${ring(11.5, 5.5, 2.5)}`,
  motion: `M3 20c3-10 6-14 9-14s6 4 9 14M3 20h18${ring(12, 6, 2)}`,
  videoProject: 'M3 10h18v10H3zM3 10l1.5-5 15.5-1.5.5 5M8.5 4.5l2 5M14.5 3.8l2 5.2',
  // 그림 — 벡터(베지어와 손잡이) · 카메라 RAW(사진기) · HDR(해) · GPU 텍스처(격자) · 재질(재질 구) · 레이어 원본 · 아이콘
  vector: `M4 19C7 9 17 9 20 19M4 19l3-9M20 19l-3-9M3 18h2v2H3zM19 18h2v2h-2z${ring(7, 10, 1.3)}${ring(17, 10, 1.3)}`,
  photoRaw: `M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z${ring(12, 13, 3.5)}`,
  hdr: `${ring(12, 12, 4)}M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  texture: 'M4 4h16v16H4zM9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16',
  material: `${ring(12, 12, 8)}M4 12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5M8.5 8.5a5 5 0 0 1 3.5-1.8`,
  layered: 'M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  icon: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM9 9h6v6H9z',
  // 소리 — 시퀀스 음악(음표) · 사운드폰트(건반) · DAW 원본(믹서) · 악보(오선)
  sequence: `M9 18V5l12-2v13${ring(6, 18, 3)}${ring(18, 16, 3)}`,
  soundfont: 'M3 5h18v14H3zM8 5v14M13 5v14M18 5v14M6.5 5v8M10.5 5v8M15.5 5v8',
  daw: 'M6 3v18M12 3v18M18 3v18M4 14h4M10 8h4M16 16h4',
  score: `M3 6h18M3 9h18M3 12h18M3 15h18M3 18h18M12 15V4${ring(10, 15, 2)}`,
  // 3D — 장면(바닥·상자·구) · 저작 원본(상자와 연필) · CAD(삼각자) · 아바타(사람) · 점구름 · 스플랫 · 동작(관절)
  scene: `M3 20h18M5 10l4-2 4 2v5l-4 2-4-2zM5 10l4 2 4-2M9 12v5${ring(17, 14, 3)}`,
  modelSource: 'M10 2.5l6.5 3.5v7L10 16.5 3.5 13V6zM3.5 6 10 9.5 16.5 6M10 9.5v7M14 21l1-4 5-5 3 3-5 5z',
  cad: 'M4 20V4l16 16zM8 16v-4l4 4zM4 8h2M4 12h2M4 16h2',
  avatar: `${ring(12, 7.5, 3.5)}M5 21c0-4 3-7 7-7s7 3 7 7`,
  pointCloud: [ring(6, 8, 1.1), ring(11, 5, 1.1), ring(17, 8, 1.1), ring(8, 13, 1.1), ring(14, 12, 1.1), ring(19, 15, 1.1), ring(6, 18, 1.1), ring(12, 18, 1.1), ring(17, 20, 1.1)].join(''),
  splat: `${ring(9, 13, 5)}${ring(16, 9, 3.5)}${ring(16.5, 17, 2)}`,
  motionData: `${ring(12, 4, 2)}M12 6v7M12 13l-4 7M12 13l4 7M12 8l-5 3M12 8l5 3`,
  // 자막 — 가사(음표와 줄)
  lyrics: `M3 6h10M3 10h10M3 14h6M17 16V5l4-1${ring(15, 16, 2)}`,
  // 코드 — 셰이더(반짝임) · 셸(프롬프트) · 노트북(공책) · 웹(브라우저 창)
  shader: 'M12 3c.5 4 1.5 5 5.5 5.5-4 .5-5 1.5-5.5 5.5-.5-4-1.5-5-5.5-5.5 4-.5 5-1.5 5.5-5.5zM19 15c.2 1.5.6 1.8 2 2-1.4.2-1.8.5-2 2-.2-1.5-.6-1.8-2-2 1.4-.2 1.8-.5 2-2z',
  shell: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3-3 3M12 15h5',
  notebook: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 7h4M3 12h4M3 17h4M10 8h6M10 12h6',
  web: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 9h20M9 12l-2 2.5L9 17M15 12l2 2.5-2 2.5',
  // 데이터 — 표 · DB(원통) · 설정(밀대) · 색 보정 LUT(빛의 삼원색) · 편집 타임라인(트랙과 재생 막대) · 모델 가중치(신경망)
  table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  config: `M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1${ring(15, 6, 2)}${ring(9, 12, 2)}${ring(17, 18, 2)}`,
  lut: `${ring(9, 9.5, 5)}${ring(15, 9.5, 5)}${ring(12, 14.5, 5)}`,
  timeline: 'M3 8h7M12 8h9M3 13h8M15 13h6M3 18h5M10 18h11M13 3v19M11 3h4l-2 2z',
  weights: `${ring(5, 7, 1.8)}${ring(5, 17, 1.8)}${ring(12, 5, 1.8)}${ring(12, 12, 1.8)}${ring(12, 19, 1.8)}${ring(19, 12, 1.8)}M6.7 7.7l3.6 3.4M6.7 16.3l3.6-3.4M6.8 6.5l3.4-1M6.8 17.5l3.4 1M13.4 6.3l4.2 4.6M13.8 12h3.4M13.4 17.7l4.2-4.6`,
  // 문서 — PDF(아래 띠가 있는 장) · 슬라이드(발표 판) · 대본(가운데 줄) · 로그(줄 목록)
  pdf: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M7 14h10v4H7z',
  slides: 'M3 4h18M4 4v11h16V4M12 15v4M9 21l3-2 3 2M8 11v1M12 8v4M16 10v2',
  screenplay: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 6h4M8 9h8M10 13h4M8 16h8',
  log: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  // 기타 — 압축(뚜껑 달린 상자)
  archive: 'M4 8h16v12H4zM3 4h18v4H3zM10 12h4',
};

/** 이 갈래의 획 — 기본 갈래는 종류 글리프와 같다. */
export function familyGlyphPath(family: FileFaceFamily): string {
  return family in FAMILY_GLYPH_PATHS
    ? FAMILY_GLYPH_PATHS[family as Exclude<FileFaceFamily, FileFaceKind>]
    : KIND_GLYPH_PATHS[family as FileFaceKind];
}

export interface FileFamilyGlyphProps {
  readonly family: FileFaceFamily;
  readonly px: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}

/** 갈래 아이콘 한 개(장식 — 이름은 라벨·툴팁이 말한다). */
export function FileFamilyGlyph({ family, px, color = 'white', strokeWidth = 2, className }: FileFamilyGlyphProps): React.JSX.Element {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'shrink-0'}
      data-family={family}
    >
      <path d={familyGlyphPath(family)} />
    </svg>
  );
}
