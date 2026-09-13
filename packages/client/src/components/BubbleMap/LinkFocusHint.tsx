import { Panel } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useLinkedCount, useLinkFocusPhase } from '../../stores/linkFocus.js';
import { shortcutLabel } from '../../utils/platform.js';

/**
 * §5.4 #31 — 무리를 잡고 있는 동안 캔버스 아래에 뜨는 한 줄.
 *
 * 강조만으로는 **몇 개가 함께 가는지**를 셀 수 없고(파일 점이 수십 개면 눈으로 못 센다), 특히
 * "연결된 게 하나도 없다"와 "강조가 안 켜졌다"는 화면에서 똑같아 보인다 — 그 둘을 이 줄이 가른다.
 *
 * **별도 컴포넌트인 이유**: 무리는 마우스를 옮길 때마다 바뀌는데, `BubbleMap` 본체가 그걸
 * 구독하면 노드 목록 조립(`displayNodes` 등)이 hover 마다 통째로 다시 돈다. 여기만 깨어난다.
 *
 * 표시 전용 · `pointer-events-none` — 이 줄이 떠 있는 동안에도 팬·줌·드래그는 그대로다.
 */
export function LinkFocusHint(): React.JSX.Element | null {
  const { t } = useTranslation();
  const phase = useLinkFocusPhase();
  const count = useLinkedCount();

  if (phase === 'off') return null;

  // 표기는 플랫폼을 따른다 — mac 은 `⌘`, 그 외는 `Ctrl`(번역문에 키 이름을 박지 않는다).
  const key = shortcutLabel('Ctrl');
  const text = count === 0
    ? t('canvas.linkFocus.none', { defaultValue: 'Nothing is linked to this agent' })
    : phase === 'grab'
      ? t('canvas.linkFocus.moving', { count, defaultValue: 'Moving {{count}} linked bubble(s) together' })
      : t('canvas.linkFocus.hover', { count, key, defaultValue: 'Drag with {{key}} to move {{count}} linked bubble(s) together' });

  return (
    <Panel
      position="bottom-center"
      className="pointer-events-none !mb-6 select-none rounded-full border border-white/15 bg-gray-900/85 px-3.5 py-1.5 text-xs font-medium text-gray-200 shadow-lg backdrop-blur-sm"
      role="status"
    >
      <span className="flex items-center gap-2">
        {/* 무리를 뜻하는 글리프 — 가운데 점 하나에 세 점이 매달린 모양(lucide 톤 stroke SVG). */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 text-gray-400"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="m14.2 9.8 3.4-3.4" />
          <path d="m9.8 14.2-3.4 3.4" />
          <path d="m14.2 14.2 3.4 3.4" />
        </svg>
        {text}
      </span>
    </Panel>
  );
}
