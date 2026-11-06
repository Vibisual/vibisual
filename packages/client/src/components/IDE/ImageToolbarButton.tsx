import { holdFocus } from './ImageEditBars.js';

// §5.5 #17-25 도구 막대의 글리프 단추 한 벌 — Vibimage 보기 막대(§5.13 (R-9))도 이것을 써서 두 화면의 단추가 같다.

export function ImageToolbarDivider(): React.JSX.Element {
  return <span className="mx-0.5 h-5 w-px flex-shrink-0 bg-gray-700" />;
}

interface ImageToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

export function ImageToolbarButton({ active, disabled, label, onClick, children }: ImageToolbarButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled ?? false}
      // 초점을 가져가지 않는다 — 초점 받은 버튼 위의 Enter 는 그 버튼을 다시 누를 뿐이라 ⑦ 적용이 닿지 않는다.
      onMouseDown={holdFocus}
      onClick={onClick}
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors pointer-coarse:h-9 pointer-coarse:w-9 ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
      } disabled:cursor-not-allowed disabled:text-gray-700 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}
