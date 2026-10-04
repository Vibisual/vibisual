import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentEngineKind } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { EngineIcon } from './engineIcons.js';
export const ENGINES: AgentEngineKind[] = ['claude', 'codex', 'local'];
/**
 * 제공자 탭 줄. 탭은 **보기만 바꾼다**(§5.25 (C)) — 메인 제공자를 바꾸는 것은 `showSetMain` 을 켠 자리의
 * [기본으로 설정] 하나다. tablist 안에는 tab 만 두므로 그 버튼은 바깥, 같은 줄 오른쪽 끝에 선다.
 */
export function ProviderTabs({ value, onChange, disabled = false, showSetMain = false }: { value: AgentEngineKind; onChange: (engine: AgentEngineKind) => void; disabled?: boolean; showSetMain?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return <div className="mb-4 flex flex-wrap items-center gap-2">
    <div role="tablist" aria-label={t('providers.provider')} className="flex gap-2">{ENGINES.map(engine => <button type="button" role="tab" aria-selected={engine === value} key={engine} disabled={disabled} onClick={() => onChange(engine)} className={`flex items-center gap-2 rounded border px-3 py-2 text-xs disabled:opacity-40 ${engine === value ? 'border-blue-500 bg-blue-500/15 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}><EngineIcon kind={engine} className="h-4 w-4" />{t(`providers.${engine}`)}</button>)}</div>
    {showSetMain && <SetMainProvider engine={value} />}
  </div>;
}

/**
 * §5.25 (C) — 보고 있는 제공자를 메인 제공자로 남긴다. 저장은 옵션창 [적용]·첫 실행 관문과 같은
 * `chooseEngine` 한 벌이다(새 저장 길 ❌). 이미 메인이면 누를 것이 없으니 버튼 대신 "기본" 표시만 둔다.
 */
function SetMainProvider({ engine }: { engine: AgentEngineKind }): React.JSX.Element {
  const { t } = useTranslation();
  const main = useGraphStore(s => s.userDefaults?.engineChoice?.kind ?? 'claude');
  const chooseEngine = useGraphStore(s => s.chooseEngine);
  // 같은 렌더 안의 연타는 disabled 가 DOM 에 닿기 전이라 ref 로 막는다(EngineChooserGate 와 같은 이유).
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  // 실패 안내는 그때 누른 제공자의 것이다 — 저장 중에 다른 탭으로 옮겨 가도 그 탭에 붙지 않게 제공자로 기억한다.
  const [failedFor, setFailedFor] = useState<AgentEngineKind | null>(null);

  if (engine === main) {
    return <span title={t('providers.mainHint')} className="ml-auto flex items-center gap-1 text-[12px] text-gray-500">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      {t('providers.isMain')}
    </span>;
  }

  const save = async (): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailedFor(null);
    try { await chooseEngine(engine); } catch { setFailedFor(engine); } finally { savingRef.current = false; setSaving(false); }
  };
  return <>
    <button type="button" disabled={saving} onClick={() => { void save(); }} title={t('providers.mainHint')} className="ml-auto flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[12px] text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
      {t('providers.setMain')}
    </button>
    {failedFor === engine && <p role="alert" className="basis-full text-[12px] text-red-300">{t('providers.saveFailed')}</p>}
  </>;
}
