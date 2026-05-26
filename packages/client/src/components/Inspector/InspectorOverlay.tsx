import { useTranslation } from 'react-i18next';
import { INSPECTOR_OVERLAY_ID } from '../../utils/inspector.js';
import { useInspector } from '../../hooks/useInspector.js';

const TOOLTIP_HEIGHT_ESTIMATE = 40;

export function InspectorOverlay(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { active, shiftHeld, info, region, copied, copiedSummary } = useInspector();

  if (!active) return null;

  const modeLabel = region
    ? t('inspector.modeRegion', { width: Math.round(region.width), height: Math.round(region.height) })
    : shiftHeld
      ? t('inspector.modeShiftDrag')
      : t('inspector.modeInspector');

  return (
    <div id={INSPECTOR_OVERLAY_ID} className="pointer-events-none fixed inset-0 z-[99999]">
      {/* 영역 드래그 중이면 region 박스만 표시 */}
      {region && (
        <div
          className="absolute border-2 border-amber-400 bg-amber-400/20"
          style={{
            top: region.y,
            left: region.x,
            width: region.width,
            height: region.height,
          }}
        />
      )}

      {/* 요소 hover (드래그 중이 아닐 때만) */}
      {!region && info && (
        <>
          <div
            className={`absolute border-2 transition-colors duration-150 ${copied ? 'border-emerald-400 bg-emerald-400/30' : 'border-sky-400 bg-sky-400/20'}`}
            style={{
              top: info.rect.top,
              left: info.rect.left,
              width: info.rect.width,
              height: info.rect.height,
            }}
          />

          <div
            className="absolute max-w-[320px] rounded bg-gray-900/95 px-2 py-1 font-mono text-[11px] leading-tight text-sky-300 shadow-lg"
            style={{
              top:
                info.rect.bottom + 8 + TOOLTIP_HEIGHT_ESTIMATE < window.innerHeight
                  ? info.rect.bottom + 8
                  : info.rect.top - TOOLTIP_HEIGHT_ESTIMATE - 8,
              left: Math.min(info.rect.left, window.innerWidth - 330),
            }}
          >
            <TooltipLabel tag={info.tag} id={info.id} classStr={info.classStr} size={info.size} />
            {info.text && (
              <div className="truncate text-gray-400">&quot;{info.text}&quot;</div>
            )}
          </div>
        </>
      )}

      {/* Copied toast */}
      {copied && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 animate-fade-in rounded-lg bg-emerald-600 px-4 py-2 font-mono text-sm font-medium text-white shadow-lg">
          {t('inspector.copied', { summary: copiedSummary })}
        </div>
      )}

      {/* 모드 인디케이터 */}
      <div
        className={`fixed bottom-4 right-4 rounded px-3 py-1.5 text-xs font-medium text-white shadow-lg ${region ? 'bg-amber-600/90' : shiftHeld ? 'bg-amber-500/80' : 'bg-sky-600/90'}`}
      >
        {modeLabel}
      </div>
    </div>
  );
}

function TooltipLabel({
  tag,
  id,
  classStr,
  size,
}: {
  tag: string;
  id: string;
  classStr: string;
  size: string;
}): React.JSX.Element {
  let label = tag;
  if (id) {
    label += `#${id}`;
  } else {
    const firstCls = classStr.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (firstCls) label += `.${firstCls}`;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sky-200">{label}</span>
      <span className="text-gray-500">{size}</span>
    </div>
  );
}
