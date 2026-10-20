import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUBBLE_SKINS, BUBBLE_EDGE_STYLES,
  resolveBubbleSkin, resolveBubbleEdgeStyle,
  type BubbleSkin, type BubbleEdgeStyle,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { bubbleSurface } from '../BubbleMap/bubbleSurface.js';
import { BubbleSurfaceDetail } from '../BubbleMap/BubbleSurfaceDetail.js';
import { bubbleEdgeAppearance } from '../BubbleMap/bubbleEdgeAppearance.js';

const BUBBLE_NUMBERS: Record<BubbleSkin, string> = {
  outline: '03', signal: '05', twin: '06', frost: '07', halo: '08',
};
const EDGE_NUMBERS: Record<BubbleEdgeStyle, string> = {
  wire: 'E1', dash: 'E2', beads: 'E3', glow: 'E4', rail: 'E5',
};
const SELECT_CLASS = 'w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 disabled:cursor-wait disabled:opacity-60';

/** Immediate appearance controls stay separate from the Options window's Apply draft. */
export function BubbleAppearanceSection(): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const bubbleSkin = useGraphStore((s) => resolveBubbleSkin(s.bubbleAppearancePending?.bubbleSkin ?? s.userDefaults?.appearance?.bubbleSkin));
  const edgeStyle = useGraphStore((s) => resolveBubbleEdgeStyle(s.bubbleAppearancePending?.edgeStyle ?? s.userDefaults?.appearance?.edgeStyle));
  const saving = useGraphStore((s) => s.bubbleAppearanceSaving);
  const save = useGraphStore((s) => s.setBubbleAppearance);
  const inFlight = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const surface = bubbleSurface(bubbleSkin, '#d6a238', '#d6a238', 'idle');
  const edgeLayers = bubbleEdgeAppearance(edgeStyle, { semantic: 'activity', base: { stroke: '#d6a238', strokeWidth: 2.5 }, active: true });

  async function pick(patch: Partial<{ bubbleSkin: BubbleSkin; edgeStyle: BubbleEdgeStyle }>): Promise<void> {
    if (inFlight.current || saving) return;
    inFlight.current = true;
    setSaveFailed(false);
    try {
      if (!(await save(patch))) setSaveFailed(true);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <section aria-labelledby={headingId} aria-busy={saving} className="flex flex-col gap-3 border-t border-gray-700/50 pt-4">
      <div>
        <h4 id={headingId} className="text-sm font-semibold text-gray-200">{t('options.appearance.title')}</h4>
        <p className="mt-1 text-[12px] text-gray-500">{t('options.appearance.intro')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <label className="flex flex-col gap-1.5 text-[12px] text-gray-300">
          {t('options.appearance.bubbleStyle')}
          <span aria-hidden="true" className="flex h-24 items-center justify-center">
            <span {...DARK_THEME_LOCK} className="relative flex h-20 w-20 items-center justify-center rounded-full border" style={surface.body}>
              <BubbleSurfaceDetail surface={surface} />
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 7v12h18V7h-8l-2-3H3z" /></svg>
            </span>
          </span>
          <select
            value={bubbleSkin}
            disabled={saving}
            className={SELECT_CLASS}
            onChange={(event) => {
              const value = resolveBubbleSkin(event.target.value);
              if (value !== bubbleSkin) void pick({ bubbleSkin: value });
            }}
          >
            {BUBBLE_SKINS.map((skin) => <option key={skin.id} value={skin.id}>{BUBBLE_NUMBERS[skin.id]} · {t(skin.i18nKey, { defaultValue: skin.name })}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-gray-300">
          {t('options.appearance.edgeStyle')}
          <svg aria-hidden="true" className="h-24 w-full rounded" viewBox="0 0 210 80">
            <rect width="210" height="80" rx="4" fill="var(--color-vb-canvas, #0b0b0b)" />
            {edgeLayers.map((layer) => <path key={layer.role} d="M16 58 C64 14 122 92 184 38" style={{ ...layer.style, animation: 'none' }} />)}
            <path d="M184 38 l-9 2 5 6 Z" fill="#d6a238" />
          </svg>
          <select
            value={edgeStyle}
            disabled={saving}
            className={SELECT_CLASS}
            onChange={(event) => {
              const value = resolveBubbleEdgeStyle(event.target.value);
              if (value !== edgeStyle) void pick({ edgeStyle: value });
            }}
          >
            {BUBBLE_EDGE_STYLES.map((style) => <option key={style.id} value={style.id}>{EDGE_NUMBERS[style.id]} · {t(style.i18nKey, { defaultValue: style.name })}</option>)}
          </select>
        </label>
      </div>
      {saving && <p role="status" className="text-[12px] text-gray-500">{t('panel.options.saving')}</p>}
      {saveFailed && <p role="alert" className="text-[12px] text-red-400">{t('options.appearance.saveFailed')}</p>}
    </section>
  );
}
