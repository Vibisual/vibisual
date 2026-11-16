import { useTranslation } from 'react-i18next';
import { normalizeDedicatedHidden } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import type { DedicatedHubPanel } from '../../utils/dedicatedBubbleView.js';

/** §5.4 #36 (K) — 전용 버블의 체크 목록. 체크를 풀면 그 종류 버블이 캔버스에서 숨는다(데이터는 그대로). */
export function DedicatedHubSection({ hub }: { readonly hub: DedicatedHubPanel }): React.JSX.Element {
  const { t } = useTranslation();
  const setAgentLinkView = useGraphStore((s) => s.setAgentLinkView);

  const toggle = (key: string, show: boolean): void => {
    const agent = useGraphStore.getState().agents.find((a) => a.id === hub.agentId);
    const current = new Set(agent?.dedicatedHidden ?? []);
    if (show) current.delete(key);
    else current.add(key);
    setAgentLinkView(hub.agentId, { dedicatedHidden: normalizeDedicatedHidden([...current]) });
  };

  return (
    <section className="flex flex-col gap-1.5" aria-label={t('panel.dedicated.title')}>
      <span className="text-xs text-gray-500">{t('panel.dedicated.title')}</span>
      <p className="text-xs text-gray-500">{t('panel.dedicated.hint')}</p>
      <ul className="flex flex-col gap-0.5">
        {hub.rows.map((row) => (
          <li key={row.key}>
            <label className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-800/60 pointer-coarse:py-2.5 ${row.count === 0 ? 'text-gray-500' : 'text-gray-200'}`}>
              <input
                type="checkbox"
                checked={!row.hidden}
                onChange={(e) => toggle(row.key, e.target.checked)}
                className="h-3.5 w-3.5 flex-shrink-0 accent-blue-500"
              />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">{row.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
