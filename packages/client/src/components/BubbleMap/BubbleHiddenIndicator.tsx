import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

interface BubbleHiddenIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  bubblesHidden?: boolean;
  linksHidden?: boolean;
  size?: number;
}

/** One quiet mark for explicit Hide preferences; automatic folding has its own count. */
export function BubbleHiddenIndicator({
  bubblesHidden, linksHidden, size = 16, style, className = '', ...props
}: BubbleHiddenIndicatorProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (bubblesHidden !== true && linksHidden !== true) return null;

  const label = t(bubblesHidden === true
    ? linksHidden === true ? 'canvas.bubbleMenu.hiddenBubblesAndLinksBadge' : 'canvas.bubbleMenu.hiddenBubblesBadge'
    : 'canvas.bubbleMenu.hiddenLinksBadge');
  const description = `${label}\n${t('canvas.bubbleMenu.hiddenBadgeHint')}`;

  return (
    <span
      {...props}
      role="img"
      aria-label={description}
      title={description}
      className={`bubble-body absolute z-20 flex items-center justify-center rounded-full border border-gray-500/70 bg-gray-900 text-gray-300 shadow-sm ${className}`}
      style={{ ...style, width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" className="h-[70%] w-[70%]" aria-hidden="true"
      >
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <path d="M2 2l20 20" />
      </svg>
    </span>
  );
}
