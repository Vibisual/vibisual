import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS, EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT } from '@vibisual/shared';
import { SatelliteMaxPopup } from './SatelliteMaxPopup.js';

interface Props {
  /** 외부 폴더 노드 id — 서버가 이 노드로 소속 프로젝트를 찾는다. */
  nodeId: string;
  /** 서버가 실은 지금 깊이(`BubbleData.externalMergeDepth`). 옛 스냅샷이라 없으면 기본값으로 읽는다. */
  depth: number | undefined;
  /** 프로젝트 전용 값인가(`BubbleData.externalMergeDepthCustom`). */
  custom: boolean;
}

/** §7.5 — 외부 폴더 경로 통합 깊이. 바꾸면 그 프로젝트의 외부 폴더 전체가 다시 묶인다(서버가 SSOT, 방송으로 돌아온다). */
export function ExternalMergeDepthRow({ nodeId, depth, custom }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const value = depth ?? EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT;
  const [editorAt, setEditorAt] = useState<{ x: number; y: number } | null>(null);

  const save = useCallback((mergeDepth: number | null) => {
    fetch('/api/external-folder/merge-depth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId, mergeDepth }),
    }).catch(() => {});
  }, [nodeId]);

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]" data-testid="external-merge-depth">
      <span className="text-gray-400">{t('panel.externalMergeDepth.label')}</span>
      <span className="font-semibold text-emerald-400">
        {value === 0 ? t('panel.externalMergeDepth.off') : t('panel.externalMergeDepth.levels', { depth: value })}
      </span>
      <span aria-hidden="true" className="text-gray-600">·</span>
      <span className={custom ? 'text-emerald-300/80' : 'text-gray-500'}>
        {custom ? t('panel.externalMergeDepth.projectValue') : t('panel.externalMergeDepth.defaultValue')}
      </span>
      <button
        type="button"
        title={t('panel.externalMergeDepth.edit')}
        aria-label={t('panel.externalMergeDepth.edit')}
        onClick={(e) => setEditorAt({ x: e.clientX, y: e.clientY })}
        className="inline-flex items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-emerald-400 pointer-coarse:p-2"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      {custom && (
        <button
          type="button"
          onClick={() => save(null)}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:px-2 pointer-coarse:py-1.5"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          {t('panel.externalMergeDepth.reset')}
        </button>
      )}

      {editorAt && (
        <SatelliteMaxPopup
          value={value}
          screenX={editorAt.x}
          screenY={editorAt.y}
          onClose={() => setEditorAt(null)}
          onCommit={(next) => save(next)}
          bounds={EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS}
          titleKey="panel.externalMergeDepth.title"
          hintKey="panel.externalMergeDepth.hint"
          noteKey="panel.externalMergeDepth.note"
        />
      )}
    </div>
  );
}
