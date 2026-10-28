/** 폴더 목록 창 자르기 + 이어 받기(§7.5, 두 패널 공용). 바닥 감지는 윈도잉이 아는 보이는 행에서 `more` 를 찾는다(`IntersectionObserver` 따로 ❌). */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollFade, type ScrollViewport } from '../ScrollFade.js';
import {
  FOLDER_ROW_HEIGHT,
  folderRowWindow,
  type FolderTreeRow,
} from './folderFileRows.js';

interface PagedRowListProps {
  rows: FolderTreeRow[];
  maxHeight: number;
  /** 이 겹의 다음 장이 필요하다 — 훅이 중복·끝을 걸러 준다. */
  onNeedMore: (subPath: string) => void;
  renderEntry: (row: Extract<FolderTreeRow, { kind: 'entry' }>) => React.ReactNode;
}

export function PagedRowList({ rows, maxHeight, onNeedMore, renderEntry }: PagedRowListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [viewport, setViewport] = useState<ScrollViewport>({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 });

  const win = useMemo(
    () => folderRowWindow(rows.length, viewport.scrollTop, viewport.clientHeight),
    [rows.length, viewport.scrollTop, viewport.clientHeight],
  );
  const visible = useMemo(() => rows.slice(win.start, win.end), [rows, win.start, win.end]);

  // 시야에 들어온 `more` 행 = 다음 장을 부를 때. 문자열로 접어 두면 같은 상태에서 다시 부르지 않는다.
  const pending = useMemo(
    () => JSON.stringify(
      visible.filter((r) => r.kind === 'more' && !r.loading && !r.failed).map((r) => r.subPath),
    ),
    [visible],
  );
  useEffect(() => {
    const subPaths = JSON.parse(pending) as string[];
    for (const subPath of subPaths) onNeedMore(subPath);
  }, [pending, onNeedMore]);

  return (
    <ScrollFade maxHeight={maxHeight} className="px-2 py-1" onViewport={setViewport}>
      {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
      {visible.map((row) => {
        if (row.kind === 'entry') {
          return (
            <div key={row.key} style={{ height: FOLDER_ROW_HEIGHT }}>
              {renderEntry(row)}
            </div>
          );
        }
        return (
          <div
            key={row.key}
            style={{ height: FOLDER_ROW_HEIGHT, paddingLeft: row.depth * 12 + 4 }}
            className="flex items-center text-[12px] text-gray-600"
          >
            {row.failed ? (
              <button
                type="button"
                className="rounded px-1 text-[12px] text-amber-500 hover:bg-gray-800/50 hover:text-amber-400"
                onClick={() => onNeedMore(row.subPath)}
              >
                {t('panel.folderList.retry', { defaultValue: '불러오지 못했습니다 — 다시 시도' })}
              </button>
            ) : (
              <span className="truncate">
                {t('panel.folderList.loadingMore', {
                  defaultValue: '더 불러오는 중… ({{loaded}} / {{total}})',
                  loaded: row.loaded,
                  total: row.total,
                })}
              </span>
            )}
          </div>
        );
      })}
      {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
    </ScrollFade>
  );
}
