import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, selectActiveBrainSummary } from '../../stores/graphStore.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/** 목록에 이름을 몇 개까지 펼칠지 — 나머지는 "외 N개" 로 접는다. */
const NAME_PREVIEW_MAX = 8;

/**
 * §5.10 v4.84 — 휴지통 영구 삭제 확인 팝업. [모두 삭제]·Delete 키(단일/Shift 다중) 세 경로 공용.
 *
 * 영구 삭제는 identity·개별 기억 카드·스트림 파일까지 지우는 되돌릴 수 없는 동작이라 SSOT 가
 * 확인 팝업을 필수로 두고 있다. 여기서는 "무엇이 몇 개, 기억 몇 장" 을 세어 보여주고, 승인되면
 * 배치 REST 한 번(`POST /api/trash/purge`)으로 보내 버블이 여러 번 나눠 사라지지 않게 한다.
 *
 * 모달 문법은 `WorktreeDeleteDialog` 와 동일(스토어에 대상이 설정되면 뜨고, 배경 클릭·Esc 로 닫힘).
 */
export const TrashPurgeDialog = memo(function TrashPurgeDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const target = useGraphStore((s) => s.trashPurgeTarget);
  const close = useGraphStore((s) => s.closeTrashPurge);
  const purgeTrashedAgents = useGraphStore((s) => s.purgeTrashedAgents);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const brainSummary = useGraphStore(selectActiveBrainSummary);
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
  const cardCount = ids.reduce((sum, id) => sum + (brainSummary?.agentCardCounts[id] ?? 0), 0);
  const names = ids.map((id) => nodeMap[id]?.label ?? id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      <div className="w-[clamp(20rem,34vw,28rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="border-b border-gray-800 px-5 py-3">
          <div className="text-sm font-semibold text-gray-100">{t('brain.purge', { defaultValue: '영구 삭제' })}</div>
        </div>
        <div className="px-5 py-4">
          <div className="mb-3 text-sm text-red-300">
            {ids.length === 1
              ? t('brain.purgeConfirm', { defaultValue: '개별 기억 {{n}}장 포함 전부 삭제됩니다.', n: cardCount })
              : t('brain.purgeConfirmMany', {
                defaultValue: '에이전트 {{count}}개와 개별 기억 {{n}}장이 전부 삭제됩니다.',
                count: ids.length,
                n: cardCount,
              })}
          </div>
          <ul className="mb-3 max-h-40 space-y-1 overflow-auto rounded border border-gray-800 bg-gray-800/40 p-2 text-xs text-gray-300">
            {names.slice(0, NAME_PREVIEW_MAX).map((name, i) => (
              <li key={`${ids[i]}`} className="truncate" title={name}>{name}</li>
            ))}
            {names.length > NAME_PREVIEW_MAX && (
              <li className="text-gray-500">
                {t('brain.trashItemsMore', { defaultValue: '외 {{n}}개', n: names.length - NAME_PREVIEW_MAX })}
              </li>
            )}
          </ul>
          <div className="mb-4 text-xs text-gray-400">
            {t('brain.purgeIrreversible', { defaultValue: '되돌릴 수 없습니다.' })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              {t('brain.cancel', { defaultValue: '취소' })}
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => { void confirm(); }}
              className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('brain.purgeYes', { defaultValue: '영구 삭제' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
