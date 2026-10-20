import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { exitImmersionLayer, selectShellImmersive, useProjectImmersionStore } from '../../stores/projectImmersion.js';

function ExitControl(): React.JSX.Element {
  const { t } = useTranslation();
  const region = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touchRevealed, setTouchRevealed] = useState(false);
  const revealed = hovered || focused || touchRevealed;
  const label = t('canvas.controls.exitImmersiveMode');

  useOutsidePressDismiss({
    enabled: touchRevealed,
    onDismiss: () => setTouchRevealed(false),
    refs: [region],
    events: ['pointerdown'],
  });

  return <div ref={region} data-immersive-exit-control="" data-revealed={revealed}
    className="app-nodrag fixed left-1/2 top-0 flex w-48 -translate-x-1/2 justify-center"
    style={{ zIndex: 1_900_000_000, height: revealed ? 80 : 12, touchAction: 'manipulation' }}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onPointerDown={(event) => {
      event.stopPropagation();
      // A touch has no persistent hover: the first tap reveals, the next tap on X exits.
      if (event.pointerType === 'touch') setTouchRevealed(true);
    }}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}>
    <button type="button" aria-label={label} title={label}
      className="app-nodrag mt-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-gray-900/95 text-gray-100 shadow-lg shadow-black/40 transition-[transform,opacity] duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 motion-reduce:transition-none"
      style={{ opacity: revealed ? 1 : 0, transform: revealed ? 'translateY(0)' : 'translateY(-72px)', pointerEvents: revealed ? 'auto' : 'none' }}
      onClick={(event) => { event.stopPropagation(); exitImmersionLayer(); }}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  </div>;
}

/** A window-local escape hatch, above immersive panes but below application dialogs. */
export function ImmersiveExitControl(): React.JSX.Element | null {
  const immersive = useProjectImmersionStore(selectShellImmersive);
  // Unmount the reveal state too, so reentering immersion never leaves a visible X behind.
  return immersive ? createPortal(<ExitControl />, document.body) : null;
}
