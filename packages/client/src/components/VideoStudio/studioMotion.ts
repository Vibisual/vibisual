import { createContext } from 'react';

/**
 * §5.13 (V) 37-1 — 스튜디오의 움직임(열고 닫기 120–180ms ease-out · 바뀐 것 한 번 빛남 · 일하는 장면의 위성).
 *
 * 키프레임은 이 앱 청크가 한 번만 문서 머리에 넣는다(전역 index.css 에 앱 전용 이름을 두지 않는다). 클래스는 Tailwind 임의
 * 값(`animate-[vs-in-left_160ms_ease-out]`)으로 부른다. 움직임 줄이기 설정이면 전부 끈다. 빛남·위성 색은 셸 뿌리의
 * `--vs-accent`(레지스트리의 앱 색) 하나에서 온다 — hex 를 쓰지 않는다.
 */

const STYLE_ID = 'vs-studio-motion';

const CSS = `
@keyframes vs-in-left { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
@keyframes vs-in-right { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
@keyframes vs-in-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes vs-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes vs-glow-once {
  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--vs-accent) 0%, transparent); }
  35% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--vs-accent) 70%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--vs-accent) 0%, transparent); }
}
@keyframes vs-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes vs-breathe { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
@keyframes vs-fade-out { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  [class*="animate-[vs-"] { animation: none; }
}
`;

/** 키프레임을 한 번만 넣는다(여러 창·여러 셸이 불러도). */
export function ensureStudioMotion(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** 바뀐 것이 한 번 빛나는 시간(ms) — 빛남 클래스를 이만큼 뒤에 걷는다. */
export const GLOW_ONCE_MS = 900;

/**
 * 앱 색(레지스트리의 `glow`) — 선택 링·진행 표시에만 쓴다. 셸 뿌리가 `--vs-accent` 로 넣고, 문서 몸으로 포털하는 판(팝오버)도
 * 같은 값을 받아 자기 뿌리에 넣는다(포털은 셸의 CSS 변수를 물려받지 못한다).
 */
export const StudioAccentContext = createContext<string>('currentColor');
