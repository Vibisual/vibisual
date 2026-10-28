import { Panel } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useLinkedCount, useLinkFocusPhase } from '../../stores/linkFocus.js';
import { shortcutLabel } from '../../utils/platform.js';

/**
 * §5.4 #31 — 무리를 잡는 동안의 한 줄: 몇 개가 함께 가는지, 그리고 화면상 같은 "연결 없음"과 "강조 꺼짐"을 가른다.
 * 따로 둔 이유: 무리는 hover 마다 바뀌어 `BubbleMap` 이 구독하면 노드 조립(`displayNodes`)이 매번 다시 돈다. `pointer-events-none`.
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

  // 폭은 글자만큼(`w-max`)이되 캔버스 폭에서 양옆 여백을 뺀 만큼까지만 — 가운데 패널은 `left:50%` 라 그대로 두면
  //   남은 절반 폭에서 줄이 꺾이고, 좁은 화면에서는 알약이 여러 줄 기둥이 된다. 넘치면 가운데 정렬로 줄을 바꾼다.
  return (
    <Panel
      position="bottom-center"
      className="pointer-events-none !mb-6 w-max max-w-[calc(100%-3rem)] select-none rounded-full border border-white/15 bg-gray-900/85 px-3.5 py-1.5 text-center text-xs font-medium text-gray-200 shadow-lg backdrop-blur-sm"
      role="status"
    >
      <span className="flex items-center justify-center gap-2">
        {/* 무리를 뜻하는 글리프 — 가운데 점 하나에 세 점이 매달린 모양(lucide 톤 stroke SVG). */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 text-gray-400"
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
