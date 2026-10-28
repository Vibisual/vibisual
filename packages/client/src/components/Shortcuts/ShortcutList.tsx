import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COMMANDS,
  commandDef,
  COMMAND_IDS,
  COMMAND_SCOPES,
  type CommandId,
  type CommandScope,
} from '@vibisual/shared';
import { useKeymapStore } from '../../stores/keymap.js';
import { KeyHint } from './KeyHint.js';
import {
  COMMAND_LABEL_EN,
  COMMAND_HINT_EN,
  SCOPE_LABEL_EN,
  scopeLabelKey,
} from './commandLabels.js';

/** 레지스트리에서 나오는 단축키 목록(읽기 + 재매핑) — 도움말에 키를 손으로 적지 마라(재매핑·mac 에서 틀린다). 관리 화면 `KeyboardTab` 과 같은 표에서 나온다. */

interface ShortcutListProps {
  /** 연필을 달아 그 자리에서 바꾸게 할지. 기본 `true`. */
  editable?: boolean;
  /** 이 스코프들만 보인다. 없으면 전부. */
  scopes?: readonly CommandScope[];
  className?: string;
}

export function ShortcutList({
  editable = true,
  scopes,
  className = '',
}: ShortcutListProps): React.JSX.Element {
  const { t } = useTranslation();
  const loaded = useKeymapStore((s) => s.loaded);
  const fetchKeymap = useKeymapStore((s) => s.fetchKeymap);

  // 부팅 때 `ShortcutsHost` 가 이미 한 번 받아 오지만, 이 목록만 따로 쓰이는 화면(별창 등)
  //   에서도 빈 키가 보이지 않도록 여기서도 확인한다(`loaded` 가드라 중복 요청은 안 난다).
  useEffect(() => { if (!loaded) void fetchKeymap(); }, [loaded, fetchKeymap]);

  const grouped = useMemo(() => {
    const wanted = scopes ?? COMMAND_SCOPES;
    const out: Array<{ scope: CommandScope; ids: CommandId[] }> = [];
    for (const scope of COMMAND_SCOPES) {
      if (!wanted.includes(scope)) continue;
      const ids = COMMAND_IDS.filter((id) => COMMANDS[id].scope === scope);
      if (ids.length > 0) out.push({ scope, ids });
    }
    return out;
  }, [scopes]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {grouped.map(({ scope, ids }) => (
        <section key={scope} className="rounded-md border border-gray-700/60 bg-gray-900/40">
          <h5 className="border-b border-gray-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t(scopeLabelKey(scope), { defaultValue: SCOPE_LABEL_EN[scope] })}
          </h5>
          <ul className="divide-y divide-gray-800/70">
            {ids.map((id) => {
              const hint = COMMAND_HINT_EN[id];
              return (
                <li key={id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200">
                      {t(COMMANDS[id].labelKey, { defaultValue: COMMAND_LABEL_EN[id] })}
                    </div>
                    {hint && (
                      <div className="mt-0.5 text-xs leading-relaxed text-gray-500">
                        {t(commandDef(id).hintKey ?? `${COMMANDS[id].labelKey}Hint`, { defaultValue: hint })}
                      </div>
                    )}
                  </div>
                  <KeyHint cmd={id} editable={editable} tone="strong" className="mt-0.5 shrink-0" />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
