import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COMMANDS,
  commandDef,
  COMMAND_IDS,
  COMMAND_SCOPES,
  findKeymapConflicts,
  type CommandId,
  type CommandScope,
} from '@vibisual/shared';
import { useKeymapStore, isRemapped, exportKeymap, parseKeymapImport } from '../../stores/keymap.js';
import { KeyHint } from '../Shortcuts/KeyHint.js';
import {
  COMMAND_LABEL_EN,
  COMMAND_HINT_EN,
  SCOPE_LABEL_EN,
  SCOPE_DESC_EN,
  scopeLabelKey,
  scopeDescKey,
} from '../Shortcuts/commandLabels.js';
import { clientKeyPlatform } from '../../utils/platform.js';

/**
 * KeyboardTab.tsx — §6 **단축키 설정.**
 *
 * 표는 `COMMANDS` 하나에서 나오므로 여기 목록을 손으로 적을 일이 없다 — 새 단축키를 만들면
 * 이 화면에 저절로 나타난다(그래서 다시는 도움말과 구현이 어긋나지 않는다).
 *
 * 저장은 즉시다(옵션창의 다른 탭처럼 [저장]을 누를 필요 없음) — 키 하나를 바꾸는 일은
 * 되돌리기가 쉬운 조작이라, 확정 단계를 하나 더 두면 오히려 손이 무거워진다.
 */

type Filter = 'all' | 'conflicts' | 'changed';

export function KeyboardTab(): React.JSX.Element {
  const { t } = useTranslation();
  const overrides = useKeymapStore((s) => s.overrides);
  const resolved = useKeymapStore((s) => s.resolved);
  const loaded = useKeymapStore((s) => s.loaded);
  const fetchKeymap = useKeymapStore((s) => s.fetchKeymap);
  const resetBinding = useKeymapStore((s) => s.resetBinding);
  const resetAll = useKeymapStore((s) => s.resetAll);
  const applyOverrides = useKeymapStore((s) => s.applyOverrides);
  const setBinding = useKeymapStore((s) => s.setBinding);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!loaded) void fetchKeymap(); }, [loaded, fetchKeymap]);

  const platform = clientKeyPlatform();
  const conflicts = useMemo(
    () => new Set(findKeymapConflicts(resolved, platform).map((c) => c.id)),
    [resolved, platform],
  );

  const nameOf = (id: CommandId): string =>
    t(COMMANDS[id].labelKey, { defaultValue: COMMAND_LABEL_EN[id] });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMAND_IDS.filter((id) => {
      if (filter === 'conflicts' && !conflicts.has(id)) return false;
      if (filter === 'changed' && !isRemapped(overrides, id)) return false;
      if (!q) return true;
      // 이름·식별자·현재 바인딩 셋 다로 찾는다 — "ctrl+s 가 무엇이었지"로도 찾을 수 있게.
      const binding = resolved[id] ?? '';
      return nameOf(id).toLowerCase().includes(q)
        || id.toLowerCase().includes(q)
        || binding.toLowerCase().includes(q);
    });
    // `nameOf` 는 `t` 에만 의존한다(렌더마다 새 함수라 의존성에 넣으면 매번 다시 계산된다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, conflicts, overrides, resolved, t]);

  const grouped = useMemo(() => {
    const out: Array<{ scope: CommandScope; ids: CommandId[] }> = [];
    for (const scope of COMMAND_SCOPES) {
      const ids = visible.filter((id) => COMMANDS[id].scope === scope);
      if (ids.length > 0) out.push({ scope, ids });
    }
    return out;
  }, [visible]);

  async function onImportFile(file: File): Promise<void> {
    const text = await file.text();
    const parsed = parseKeymapImport(text);
    if (!parsed) {
      setNotice(t('panel.options.keyboard.importFailed', { defaultValue: 'Could not read that file.' }));
      return;
    }
    // 서버가 정본이라 한 건씩 밀어 넣는다 — 화면만 바꾸면 다음 새로고침에 되돌아간다.
    applyOverrides(parsed);
    for (const [id, binding] of Object.entries(parsed)) {
      await setBinding(id as CommandId, binding);
    }
    setNotice(t('panel.options.keyboard.imported', {
      count: Object.keys(parsed).length,
      defaultValue: 'Imported {{count}} shortcuts.',
    }));
  }

  function onExport(): void {
    const blob = new Blob([exportKeymap(overrides)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vibisual-keymap.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs leading-relaxed text-gray-400">
        {t('panel.options.keyboard.intro', {
          defaultValue: 'Every shortcut in the app is listed here. Click the pencil next to a shortcut to change it — conflicts are checked as you press.',
        })}
      </p>

      {/* 검색 + 필터 */}
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('panel.options.keyboard.search', { defaultValue: 'Search commands or keys' })}
            className="w-full rounded border border-gray-700 bg-gray-800 py-1 pl-7 pr-2 text-xs text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        {([
          ['all', t('panel.options.keyboard.filterAll', { defaultValue: 'All' })],
          ['conflicts', t('panel.options.keyboard.filterConflicts', { defaultValue: 'Conflicts' })],
          ['changed', t('panel.options.keyboard.filterChanged', { defaultValue: 'Changed' })],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded px-2 py-1 text-xs ${filter === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
          >
            {label}
            {key === 'conflicts' && conflicts.size > 0 && (
              <span className="ml-1 text-rose-300">{conflicts.size}</span>
            )}
          </button>
        ))}
      </div>

      {/* 표 */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-gray-800">
        {grouped.length === 0 && (
          <p className="py-8 text-center text-xs text-gray-500">
            {t('panel.options.keyboard.empty', { defaultValue: 'Nothing matches.' })}
          </p>
        )}
        {grouped.map(({ scope, ids }) => (
          <section key={scope}>
            <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-800 bg-gray-900/95 px-3 py-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                {t(scopeLabelKey(scope), { defaultValue: SCOPE_LABEL_EN[scope] })}
              </h4>
              <span className="truncate text-xs text-gray-500">
                {t(scopeDescKey(scope), { defaultValue: SCOPE_DESC_EN[scope] })}
              </span>
            </div>
            <ul className="divide-y divide-gray-800/70">
              {ids.map((id) => (
                <li
                  key={id}
                  className={`flex items-center justify-between gap-3 px-3 py-2 ${conflicts.has(id) ? 'bg-rose-950/30' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-gray-200">{nameOf(id)}</span>
                      {isRemapped(overrides, id) && (
                        <span className="shrink-0 rounded bg-blue-900/60 px-1 text-xs text-blue-200">
                          {t('panel.options.keyboard.changed', { defaultValue: 'changed' })}
                        </span>
                      )}
                      {conflicts.has(id) && (
                        <span className="shrink-0 rounded bg-rose-900/60 px-1 text-xs text-rose-200">
                          {t('panel.options.keyboard.conflict', { defaultValue: 'conflict' })}
                        </span>
                      )}
                    </div>
                    {COMMAND_HINT_EN[id] && (
                      <div className="truncate text-xs text-gray-500">
                        {t(commandDef(id).hintKey ?? `${COMMANDS[id].labelKey}Hint`, { defaultValue: COMMAND_HINT_EN[id] as string })}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <KeyHint cmd={id} tone="strong" />
                    <button
                      type="button"
                      disabled={!isRemapped(overrides, id)}
                      onClick={() => void resetBinding(id)}
                      title={t('panel.options.keyboard.resetOne', { defaultValue: 'Restore default' })}
                      aria-label={t('panel.options.keyboard.resetOne', { defaultValue: 'Restore default' })}
                      className="flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* 아래 줄 — 되돌리기 · 내보내기/가져오기 */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-gray-500">{notice ?? ''}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onExport}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {t('panel.options.keyboard.export', { defaultValue: 'Export' })}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {t('panel.options.keyboard.import', { defaultValue: 'Import' })}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onImportFile(file);
            }}
          />
          <button
            type="button"
            disabled={Object.keys(overrides).length === 0}
            onClick={() => { void resetAll(); setNotice(t('panel.options.keyboard.resetDone', { defaultValue: 'Restored all defaults.' })); }}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('panel.options.keyboard.resetAll', { defaultValue: 'Restore all defaults' })}
          </button>
        </div>
      </div>
    </div>
  );
}
