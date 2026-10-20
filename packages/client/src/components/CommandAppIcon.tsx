import { memo, useEffect, useRef, useState } from 'react';
import { getCommandAppIcon } from '../utils/commandAppIcon.js';

/** Request the native icon only when this instance is on screen. */
export const CommandAppIcon = memo(function CommandAppIcon({ executable, px = 24 }: {
  executable?: string;
  px?: number;
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ executable: string; url: string } | null>(null);
  useEffect(() => {
    if (!executable) return;
    let cancelled = false;
    let requested = false;
    const request = (): void => {
      if (requested) return;
      requested = true;
      void getCommandAppIcon(executable).then((url) => {
        if (!cancelled && url) setImage({ executable, url });
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
  }, [executable]);

  return (
    <span ref={ref} className="inline-flex shrink-0 items-center justify-center" style={{ width: px, height: px }} aria-hidden="true">
      {image && image.executable === executable ? (
        <img src={image.url} alt="" draggable={false} width={px} height={px} className="h-full w-full object-contain" onError={() => setImage(null)} />
      ) : (
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 17l6-5-6-5m8 10h8" />
        </svg>
      )}
    </span>
  );
});
