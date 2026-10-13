/**
 * §5.13 (V) 37-1 — 스튜디오 아이콘(lucide 톤 stroke SVG — 이모지·글자 아이콘 ❌).
 *
 * 색은 `currentColor` — 부모의 `text-*` 가 정한다(다크/라이트·켬/끔 자동). 크기는 부르는 쪽 `className`(기본 h-4 w-4).
 */
import type { ReactNode } from 'react';

export type StudioIconName =
  | 'play' | 'pause' | 'prev' | 'next' | 'loop' | 'safe' | 'fit' | 'point' | 'note' | 'history' | 'export'
  | 'chevronDown' | 'close' | 'send' | 'attach' | 'ide' | 'undoPass' | 'checkpoint' | 'undo' | 'redo' | 'split'
  | 'duplicate' | 'eye' | 'trash' | 'media' | 'parts' | 'style' | 'notes' | 'transcript' | 'precision' | 'plus'
  | 'check' | 'compare' | 'restore' | 'warn' | 'info' | 'film' | 'image' | 'music' | 'text' | 'code'
  | 'appIntro' | 'changelog' | 'dataStory' | 'captions' | 'kinetic' | 'slideshow' | 'logo' | 'blank'
  | 'grip' | 'more' | 'magnet' | 'sparkle' | 'upload' | 'link' | 'folder' | 'cue' | 'unlink'
  // §5.13 (W) 38-4·38-5 — 강조 줌 · 천천히 밀기 · 색·효과.
  | 'zoomIn' | 'push' | 'palette';

const PATHS: Readonly<Record<StudioIconName, ReactNode>> = {
  play: <path d="M7 5.5v13l11-6.5z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  prev: <><path d="M6 5v14" /><path d="m18 6-8 6 8 6z" /></>,
  next: <><path d="M18 5v14" /><path d="m6 6 8 6-8 6z" /></>,
  loop: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
  safe: <><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  fit: <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></>,
  point: <><path d="m9 9 5 12 1.8-5.2L21 14z" /><path d="M7.2 2.2 8 5.1" /><path d="m5.1 8-2.9-.8" /><path d="M14 4.1 12 6" /><path d="m6 12-1.9 2" /></>,
  note: <><circle cx="12" cy="10" r="6" /><path d="M12 16v6" /><path d="M10 10h4" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
  export: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  send: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  attach: <path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  ide: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  undoPass: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  checkpoint: <><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /><path d="M12 7v6" /><path d="M9 10h6" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-2" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h2" /></>,
  split: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9" /><path d="M14.5 14.5 20 20" /><path d="M8.1 8.1 12 12" /></>,
  duplicate: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>,
  media: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
  parts: <><circle cx="7" cy="7" r="3.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><circle cx="17" cy="17" r="3.5" /></>,
  style: <><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1.5A4.5 4.5 0 0 0 22 13.5C22 7.2 17.5 2 12 2z" /></>,
  notes: <><circle cx="8" cy="8" r="4" /><circle cx="16" cy="16" r="4" /><path d="M8 7.2v1.6" /><path d="M15.2 16h1.6" /></>,
  transcript: <><path d="M4 6h16" /><path d="M4 10h12" /><path d="M4 14h16" /><path d="M4 18h9" /></>,
  precision: <><path d="M3 7h18" /><path d="M3 12h18" /><path d="M3 17h18" /><rect x="6" y="5" width="6" height="4" rx="1" /><rect x="11" y="15" width="7" height="4" rx="1" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  compare: <><rect x="3" y="4" width="8" height="16" rx="1.5" /><rect x="13" y="4" width="8" height="16" rx="1.5" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  warn: <><path d="M12 3 2 20h20z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16" /><path d="M17 4v16" /><path d="M3 9h4" /><path d="M3 15h4" /><path d="M17 9h4" /><path d="M17 15h4" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  text: <><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></>,
  code: <><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></>,
  appIntro: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 8h6" /></>,
  changelog: <><circle cx="12" cy="12" r="3" /><path d="M3 12h6" /><path d="M15 12h6" /></>,
  dataStory: <><path d="M3 3v18h18" /><path d="M8 17V11" /><path d="M13 17V7" /><path d="M18 17v-4" /></>,
  captions: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15h4" /><path d="M14 15h3" /><path d="M7 11h10" /></>,
  kinetic: <><path d="M4 7V5h11v2" /><path d="M9.5 5v14" /><path d="M14 13h6" /><path d="M17 13v6" /></>,
  slideshow: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M20 8v8" /><path d="M23 10v4" /><path d="m6 15 3-3 4 3" /></>,
  logo: <><path d="M12 2 21 7v10l-9 5-9-5V7z" /><path d="m12 8 3.5 2v4L12 16l-3.5-2v-4z" /></>,
  blank: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M12 12v6" /><path d="M9 15h6" /></>,
  grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  magnet: <><path d="m6 15-4-4 6.8-6.8a5.7 5.7 0 0 1 8 8L10 19l-4-4" /><path d="m5 8 4 4" /><path d="m12 15 4 4" /></>,
  sparkle: <><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m12 8 1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5z" /></>,
  upload: <><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  folder: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />,
  // §5.13 (T-8) — 표지 = 줄기에 달린 구슬(버블 언어).
  cue: <><circle cx="12" cy="7" r="3.5" /><path d="M12 10.5V21" /></>,
  unlink: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /><path d="m3 3 18 18" /></>,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></>,
  push: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="7.5" y="8.5" width="9" height="7" rx="1" /><path d="m3 5 4.5 3.5" /><path d="m21 19-4.5-3.5" /></>,
  palette: <><path d="M12 21a9 9 0 1 1 9-9c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.4 3.4A1.6 1.6 0 0 1 12 21z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
};

export function StudioIcon({ name, className }: { readonly name: StudioIconName; readonly className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={className ?? 'h-4 w-4 shrink-0'} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
