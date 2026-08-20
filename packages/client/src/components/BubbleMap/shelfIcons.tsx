import type { ShelfIconName } from '@vibisual/shared';

/**
 * §5.20 — 선반 항목 글리프.
 *
 * 저장되는 것은 **이름 하나**(`SHELF_ICONS` 안의 값)이고 모양은 여기서만 나온다 — 이모지를
 * 저장하지 않는 이유가 이것이다(OS·폰트마다 다른 모양으로 새어 나오고, 남이 준 선반 파일이
 * 우리 화면에 아무 글리프나 그리게 된다). 전부 lucide 톤 인라인 stroke SVG.
 */
const PATHS: Record<ShelfIconName, React.JSX.Element> = {
  terminal: (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>
  ),
  play: <path d="M6 4l14 8-14 8z" />,
  rocket: (
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    </>
  ),
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  bug: (
    <>
      <path d="M8 2l1.88 1.88M14.12 3.88 16 2" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
      <path d="M18 9a6 6 0 0 1-12 0V8h12z" />
      <path d="M3 13h3m12 0h3M4 20l3-2m10 2 3-2M12 15v5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>
  ),
  package: (
    <>
      <path d="M12 2 3 7v10l9 5 9-5V7z" />
      <path d="m3 7 9 5 9-5M12 12v10" />
    </>
  ),
  database: (
    <>
      <path d="M12 3c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3z" />
      <path d="M21 6v12c0 1.66-4.03 3-9 3s-9-1.34-9-3V6" />
      <path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export function ShelfItemGlyph({
  name,
  className = 'h-3.5 w-3.5',
}: {
  name: ShelfIconName;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name] ?? PATHS.terminal}
    </svg>
  );
}

/** 선반 자체를 가리키는 글리프(캔버스 버블 머리·우클릭 메뉴 공용). */
export function ShelfGlyph({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 4h18M3 12h18M3 20h18" />
      <path d="M6 4v8M18 12v8" />
    </svg>
  );
}
