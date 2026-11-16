import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { BUBBLE_STYLES, DEDICATED_BUBBLE, FILE_FACE } from '@vibisual/shared';

import { getInternalApp } from '../../apps/registry.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import type { DedicatedHubMarks } from '../../utils/dedicatedBubbleInfo.js';
import { useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { BUNDLE_GLYPH_PATH } from './bundleGlyph.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';

/**
 * §5.4 #36 (K) — 말풍선 전용 버블. 활동 버블이 종류별로 접혀 든 자리 — 앱에 이어졌으면 그 앱의 색·아이콘으로 선다.
 * 노드 타입은 `bubble`(물리·선·배치 한 벌). 고르면 디테일창에 보일 종류의 체크 목록이 뜬다. 더블클릭 동작은 없다.
 */

const HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

export const DedicatedHubNode = memo(function DedicatedHubNode({ id, data }: NodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const bubble = data as unknown as BubbleData & DedicatedHubMarks & Record<string, unknown>;
  const selectedId = id.startsWith('sat-') ? id.slice(4) : id;
  const selected = useGraphStore((s) => s.selectedNodeId === selectedId);
  const canvasSelection = useCanvasNodeSelection(id);
  const gesture = useBubbleSelectGesture({
    doubleClickable: false,
    select: () => {
      canvasSelection.replace();
      useGraphStore.getState().selectNode(selectedId);
    },
    toggle: canvasSelection.toggle,
    setIntent: (active) => useGraphStore.getState().setSelectIntent(active ? selectedId : null),
  });

  const size = DEDICATED_BUBBLE.size;
  const style = BUBBLE_STYLES.bundle;
  const color = bubble._dedicatedColor ?? style.color;
  const ring = bubble._dedicatedGlow ?? style.glow;
  const count = bubble._dedicatedCount;
  const active = bubble.status === 'active';
  const despawning = bubble['_despawning'] === true;
  const AppIcon = bubble._dedicatedAppId ? getInternalApp(bubble._dedicatedAppId)?.icon : undefined;
  const glyphPx = Math.round(size * 0.4);
  const line = t('canvas.dedicated.line', { count });

  return (
    <div className={`group relative ${despawning ? 'bubble-despawn' : 'bubble-spawn'}`} style={{ width: size, height: size }}>
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} />

      <div
        className="bubble-body bubble-press absolute inset-0 flex flex-col items-center justify-center rounded-full"
        {...DARK_THEME_LOCK}
        {...gesture.handlers}
        data-dedicated-hub={bubble._dedicatedAppId ?? 'general'}
        title={t('canvas.dedicated.title', { name: bubble.label, count })}
        aria-label={`${bubble.label} · ${line}`}
        style={{
          background: `radial-gradient(circle at 50% 38%, ${ring}30, ${color}E6 62%, ${color})`,
          borderWidth: 2,
          borderStyle: 'solid',
          borderColor: selected ? '#FFFFFF' : ring,
          boxShadow: active ? `0 0 16px ${ring}99` : `0 0 8px ${color}80`,
          color: ring,
        }}
      >
        {AppIcon ? (
          <span className="flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full" style={{ width: glyphPx, height: glyphPx }} aria-hidden="true">
            <AppIcon />
          </span>
        ) : (
          <svg width={glyphPx} height={glyphPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d={BUNDLE_GLYPH_PATH} />
          </svg>
        )}
        <span className="mt-0.5 text-[12px] font-semibold leading-none tabular-nums text-white/85">{count}</span>
      </div>

      {/* 원 아래 — 이름과 작은 줄. 손짓은 본체가 받는다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center whitespace-nowrap text-center leading-[14px]"
        style={{ top: size + FILE_FACE.captionGap, maxWidth: Math.max(size * 2, 140) }}
      >
        <span className="max-w-full truncate text-[12px] font-medium text-gray-200">{bubble.label}</span>
        <span className="max-w-full truncate text-[12px] text-gray-400">{line}</span>
      </div>
    </div>
  );
});
