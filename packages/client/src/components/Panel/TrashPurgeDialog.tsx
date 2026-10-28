import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/** 목록에 이름을 몇 개까지 펼칠지 — 나머지는 "외 N개" 로 접는다. */
const NAME_PREVIEW_MAX = 8;

/** §5.10 — 휴지통 영구 삭제 확인(세 경로 공용, 되돌릴 수 없어 필수). 승인되면 `POST /api/trash/purge` 한 번으로 보낸다(버블이 나눠 사라지지 않게). */
export const TrashPurgeDialog = memo(function TrashPurgeDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const target = useGraphStore((s) => s.trashPurgeTarget);
  const close = useGraphStore((s) => s.closeTrashPurge);
  const purgeTrashedAgents = useGraphStore((s) => s.purgeTrashedAgents);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!target) { setRunning(false); return; }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, close]);

  const confirm = useCallback(async () => {
    if (!target || running) return;
    setRunning(true);
    await purgeTrashedAgents(target.ids);
    close();
  }, [target, running, purgeTrashedAgents, close]);

  const backdrop = useBackdropDismiss(close);

  if (!target) return null;

  const ids = target.ids;
  const names = ids.map((id) => nodeMap[id]?.label ?? id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      {/* 하한 20rem(320px)은 폰 폭에서 화면 양끝에 닿는다 — 화면 폭에서 여백만큼은 늘 남긴다. */}
      <div className="max-h-[calc(100dvh-2rem)] w-[clamp(20rem,34vw,28rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="border-b border-gray-800 px-5 py-3">
          <div className="text-sm font-semibold text-gray-100">{t('trash.purge', { defaultValue: '영구 삭제' })}</div>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3 text-sm text-red-300">
            {ids.length === 1
              ? t('trash.purgeConfirm', { defaultValue: '되돌릴 수 없습니다 — 이 에이전트가 통째로 지워집니다.' })
              : t('trash.purgeConfirmMany', {
                defaultValue: '에이전트 {{count}}개가 통째로 지워집니다.',
                count: ids.length,
              })}
          </div>
          <ul className="mb-3 max-h-40 space-y-1 overflow-auto rounded border border-gray-800 bg-gray-800/40 p-2 text-xs text-gray-300">
            {names.slice(0, NAME_PREVIEW_MAX).map((name, i) => (
              <li key={`${ids[i]}`} className="truncate" title={name}>{name}</li>
            ))}
            {names.length > NAME_PREVIEW_MAX && (
              <li className="text-gray-500">
                {t('trash.trashItemsMore', { defaultValue: '외 {{n}}개', n: names.length - NAME_PREVIEW_MAX })}
              </li>
            )}
          </ul>
          <div className="mb-4 text-xs text-gray-400">
            {t('trash.purgeIrreversible', { defaultValue: '되돌릴 수 없습니다.' })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              {t('trash.cancel', { defaultValue: '취소' })}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => { void confirm(); }}
              className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('trash.purgeYes', { defaultValue: '영구 삭제' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
