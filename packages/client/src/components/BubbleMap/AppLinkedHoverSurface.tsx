import { createContext, useContext, useRef, useState } from 'react';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

interface LinkedHoverState {
  open: boolean;
  toggle: () => void;
}

const LinkedHoverContext = createContext<LinkedHoverState>({ open: false, toggle: () => undefined });

export function useLinkedHover(): LinkedHoverState {
  return useContext(LinkedHoverContext);
}

/** The card and dropdown share a hit region, including the gap between them. */
export function AppLinkedHoverSurface({ children }: { children: React.ReactNode }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (hovered || keyboard || pinned);
  const close = (): void => { setPinned(false); setKeyboard(false); setDismissed(true); };
  useOutsidePressDismiss({ enabled: open, refs: [root], onDismiss: close });
  return (
    <LinkedHoverContext.Provider value={{ open, toggle: () => {
      if (open) close();
      else { setDismissed(false); setPinned(true); }
    } }}>
      <div ref={root} className="relative"
        onPointerEnter={(e) => { if (e.pointerType !== 'touch') { setDismissed(false); setHovered(true); } }}
        onPointerLeave={() => { setHovered(false); setDismissed(false); }}
        onFocusCapture={(e) => { if (e.target.matches(':focus-visible')) { setDismissed(false); setKeyboard(true); } }}
        onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setKeyboard(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}
      >{children}</div>
    </LinkedHoverContext.Provider>
  );
}
