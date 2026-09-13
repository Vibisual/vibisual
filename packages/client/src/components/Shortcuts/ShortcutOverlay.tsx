import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import {
  COMMANDS,
  commandDef,
  COMMAND_SCOPES,
  type CommandId,
  type CommandScope,
} from '@vibisual/shared';
import { useKeymapStore } from '../../stores/keymap.js';
import { useCommand, liveCommandIds } from '../../hooks/useCommand.js';
import { KeyHint } from './KeyHint.js';
import {
  COMMAND_LABEL_EN,
  COMMAND_HINT_EN,
  SCOPE_LABEL_EN,
  SCOPE_DESC_EN,
  scopeLabelKey,
  scopeDescKey,
} from './commandLabels.js';

/**
 * ShortcutOverlay.tsx — **요청했을 때만 뜨는 단축키 판.**
 *
 * "불친절"의 실제 해소 지점이다. 화면에 키캡을 상시로 박으면 디자인이 무너지므로(그게 침범이다),
 * Gmail·Slack·Linear 가 하는 대로 **사용자가 물어볼 때만** 답한다.
 *
 * 보여 주는 것은 `COMMANDS` 표 전체가 아니라 **지금 이 화면에서 실제로 등록돼 있는 것**이다
 * (`liveCommandIds`). 지금 누를 수 없는 키까지 알려 주면 그건 더 불친절하다.
 *
 * 여기서 바로 재매핑도 된다 — 각 줄의 키캡이 `KeyHint` 라 그 자리에서 바꿀 수 있다.
 */

export function ShortcutOverlay(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 열 때 한 번 찍는다 — 열려 있는 동안 등록이 오가도 목록이 눈앞에서 흔들리지 않게.
  const [live, setLive] = useState<CommandId[]>([]);
  const fetchKeymap = useKeymapStore((s) => s.fetchKeymap);
  const loaded = useKeymapStore((s) => s.loaded);

  // 처리기는 매 렌더 갱신되는 ref 를 타므로 여기서 `open` 을 그대로 읽어도 최신이다.
  //   상태 갱신 함수 **안에서** 다른 상태를 건드리지 않는다(갱신 함수는 순수해야 한다).
  useCommand('global.shortcutOverlay', () => {
    if (open) { setOpen(false); return; }
    setLive(liveCommandIds());
    setOpen(true);
  });

  // 처음 열 때 서버 키맵을 확인한다 — 다른 창에서 바꾼 값이 있을 수 있다.
  useEffect(() => {
    if (open && !loaded) void fetchKeymap();
  }, [open, loaded, fetchKeymap]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // §6 팝업 닫기 공통 규약 — 안에서 시작한 드래그(글자 선택)로는 닫히지 않는다.
  //   직접 `onClick={onClose}` 백드롭은 `popupDismissContract` 테스트가 막는다.
  const backdrop = useBackdropDismiss(() => setOpen(false));

  const grouped = useMemo(() => {
    const out: Array<{ scope: CommandScope; ids: CommandId[] }> = [];
    for (const scope of COMMAND_SCOPES) {
      const ids = live.filter((id) => COMMANDS[id].scope === scope);
      if (ids.length > 0) out.push({ scope, ids });
    }
    return out;
  }, [live]);

  if (!open) return null;

  return createPortal(
    <div
      data-shortcut-scope="dialog"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      <div className="flex max-h-[80dvh] w-[720px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
            {t('common.shortcuts.overlayTitle', { defaultValue: 'Keyboard shortcuts' })}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {grouped.length === 0 && (
            <p className="py-8 text-center text-xs text-gray-500">
              {t('common.shortcuts.overlayEmpty', { defaultValue: 'No shortcuts are active on this screen.' })}
            </p>
          )}
          {grouped.map(({ scope, ids }) => (
            <section key={scope} className="mb-4 last:mb-0">
              <div className="mb-1.5 flex items-baseline gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300">
                  {t(scopeLabelKey(scope), { defaultValue: SCOPE_LABEL_EN[scope] })}
                </h4>
                <span className="truncate text-xs text-gray-500">
                  {t(scopeDescKey(scope), { defaultValue: SCOPE_DESC_EN[scope] })}
                </span>
              </div>
              <ul className="divide-y divide-gray-800/70 rounded border border-gray-800">
                {ids.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs text-gray-200">
                        {t(COMMANDS[id].labelKey, { defaultValue: COMMAND_LABEL_EN[id] })}
                      </div>
                      {COMMAND_HINT_EN[id] && (
                        <div className="truncate text-xs text-gray-500">
                          {t(commandDef(id).hintKey ?? `${COMMANDS[id].labelKey}Hint`, { defaultValue: COMMAND_HINT_EN[id] as string })}
                        </div>
                      )}
                    </div>
                    <KeyHint cmd={id} tone="strong" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-gray-700 px-4 py-2 text-xs text-gray-500">
          {/* 다른 화면 이름은 **박지 않고 받아 적는다** — 그 라벨도 12개 로케일에서 각자 번역되므로,
              글자로 박으면 화면에 없는 항목을 찾아가라고 말하게 된다(§i18n 라벨 참조 규칙). */}
          {t('common.shortcuts.overlayFooter', {
            options: t('panel.options.title'),
            keyboard: t('panel.options.categories.keyboard'),
            defaultValue: 'Hover a shortcut and click the pencil to change it. {{options}} › {{keyboard}} has the full list.',
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
