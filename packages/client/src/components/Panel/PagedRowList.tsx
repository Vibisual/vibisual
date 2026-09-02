/**
 * 폴더 목록의 **창 자르기 + 이어 받기** 한 벌(§7.5) — `FolderFileTree`/`RootFileList` 가 함께 쓴다.
 *
 * 행의 생김새는 두 패널이 다르므로(한쪽은 펼침 버튼, 다른 쪽은 독립 버블 체크) `renderEntry` 로 받고,
 * 이 컴포넌트는 **공통인 것만** 맡는다:
 *  ① 보이는 구간만 DOM 으로 만든다(나머지는 위아래 여백 두 칸).
 *  ② 목록 바닥의 `more` 행이 시야에 들어오면 그 겹의 다음 장을 부른다.
 *
 * 바닥 감지에 `IntersectionObserver` 를 따로 걸지 않는다 — 어차피 윈도잉이 "지금 보이는 행"을
 * 알고 있으므로, 그 안에 `more` 행이 있는지 보면 그것이 곧 바닥 감지다(관측자 두 벌 ❌).
 */

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
