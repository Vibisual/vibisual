import { useCallback } from 'react';

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'warning';
}

const VARIANT_CLASSES: Record<ActionButtonProps['variant'], string> = {
  primary:
    'bg-blue-600 text-blue-50 hover:bg-blue-500 focus-visible:ring-blue-400',
  secondary:
    'bg-gray-700 text-gray-200 hover:bg-gray-600 focus-visible:ring-gray-400',
  warning:
    'bg-amber-600 text-amber-50 hover:bg-amber-500 focus-visible:ring-amber-400',
};

export function ActionButton({
  label,
  onClick,
  variant,
}: ActionButtonProps): React.JSX.Element {
  const handleClick = useCallback((): void => {
    onClick();
  }, [onClick]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 ${VARIANT_CLASSES[variant]}`}
    >
      {label}
    </button>
  );
}
