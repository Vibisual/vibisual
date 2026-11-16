import { useCallback, useEffect, useRef, useState } from 'react';
import { MEMO } from '../config.js';

export interface CopyText { available: boolean; copied: boolean; copy: (text: string) => void }
export function useCopyText(): CopyText {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback((text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), MEMO.copiedMs);
    }, () => undefined);
  }, []);
  return { available: typeof navigator !== 'undefined' && !!navigator.clipboard, copied, copy };
}
