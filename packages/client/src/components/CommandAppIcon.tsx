import { memo, useEffect, useRef, useState } from 'react';
import { commandAppBrandOf } from '@vibisual/shared';
import { getCommandAppIcon, peekCommandAppIcon } from '../utils/commandAppIcon.js';
import { COMMAND_APP_BRAND_ICONS } from './commandAppBrandIcons.js';

/**
 * The icon of an app detected from a command (SSOT §5.1): a bundled official mark for commands whose
 * executable carries none (git, curl …), otherwise the icon read from the installed executable —
 * requested only while this instance is on screen — and the terminal glyph until then or without one.
 * `tone` is the background it sits on: bubbles are always dark, the detail panel follows the theme.
 */
export const CommandAppIcon = memo(function CommandAppIcon({ executable, px = 24, tone = 'dark' }: {
  executable?: string;
  px?: number;
  tone?: 'dark' | 'light';
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const brand = commandAppBrandOf(executable);
  const [answer, setAnswer] = useState<{ executable: string; url: string | null } | null>(null);
  const [brokenMark, setBrokenMark] = useState<string | null>(null);
  useEffect(() => {
    // A bundled mark needs no native icon, and a cached answer is read synchronously while rendering.
    if (!executable || brand || peekCommandAppIcon(executable) !== undefined) return;
    let cancelled = false;
    let requested = false;
    const request = (): void => {
      if (requested) return;
      requested = true;
      void getCommandAppIcon(executable).then((url) => {
        if (!cancelled) setAnswer({ executable, url });
      });
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      request();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        request();
      }
    });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [executable, brand]);

  const mark = brand ? COMMAND_APP_BRAND_ICONS[brand][tone] : null;
  // Remounting (off-screen bubbles unmount) must not flash the glyph over an icon already fetched.
  const native = brand || !executable ? null
    : answer?.executable === executable ? answer.url : peekCommandAppIcon(executable) ?? null;
  const src = mark && mark !== brokenMark ? mark : native;

  return (
    <span ref={ref} className="inline-flex shrink-0 items-center justify-center" style={{ width: px, height: px }} aria-hidden="true">
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          width={px}
          height={px}
          className="h-full w-full object-contain"
          onError={() => {
            if (src === mark) setBrokenMark(src);
            else if (executable) setAnswer({ executable, url: null });
          }}
        />
      ) : (
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 17l6-5-6-5m8 10h8" />
        </svg>
      )}
    </span>
  );
});
