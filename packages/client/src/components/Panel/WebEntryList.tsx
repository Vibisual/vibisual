import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MAX_WEB_ENTRIES, WEB_ENTRY_MAX_BOUNDS, type WebEntry } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { SatelliteMaxPopup } from './SatelliteMaxPopup.js';

interface Props {
  /** 도메인 버블의 노드 ID — 서버 API 가 이걸로 버블을 찾는다. */
  nodeId: string;
  /** 이 도메인의 항목들(서버 값 그대로 · 최신 우선). */
  entries: WebEntry[];
  /** 이 버블에 저장된 상한. 없으면 기본값. */
  maxWebEntries?: number;
}

const LIST_MAX_HEIGHT = 260;

/** 화면 폭을 넘지 않게 URL 을 가운데에서 줄인다 — 꼬리(경로 끝)가 정체를 말하므로 살린다. */
function middleEllipsis(text: string, max = 56): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function post(path: string, body: unknown): void {
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/**
 * §7.22 — 도메인 버블의 웹 이력 목록.
 *
 * **체크 = 제거.** 체크 상태를 저장하지 않으므로 "반쯤 체크된 목록"이라는 상태가 없다
 * (저장하면 읽었지만 남아 있는 줄이 상한을 먹고, 결국 사용자가 두 번 지워야 한다 — §5.23).
 */
export function WebEntryList({ nodeId, entries, maxWebEntries }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [maxEditorAt, setMaxEditorAt] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const effectiveMax = maxWebEntries ?? DEFAULT_MAX_WEB_ENTRIES;

  const commitMax = useCallback(
    (next: number) => post('/api/domain-entries/max', { nodeId, max: next }),
    [nodeId],
  );
  const check = useCallback(
    (entryId: string) => post('/api/domain-entries/check', { nodeId, entryId }),
    [nodeId],
  );
  const clearAll = useCallback(() => {
    post('/api/domain-entries/clear', { nodeId });
    setConfirmClear(false);
  }, [nodeId]);

  return (
    <div className="flex flex-col">
      {/* 헤더: 항목 N / M (M = 이 버블의 상한, 편집 가능) + 모두 비우기 */}
      <div className="mb-1 flex items-center gap-1 text-[12px]">
        <span className="font-semibold text-sky-400">
          {t('panel.webEntry.count', { count: entries.length })}
        </span>
        <span className="text-gray-600">/</span>
        <span className="font-semibold text-gray-500">{effectiveMax}</span>
        <button
          type="button"
          title={t('panel.webEntry.maxTitle')}
          aria-label={t('panel.webEntry.maxTitle')}
          onClick={(e) => setMaxEditorAt({ x: e.clientX, y: e.clientY })}
          className="ml-0.5 inline-flex items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-sky-400"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <div className="flex-1" />
        {entries.length > 0 && (
          confirmClear ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearAll}
                className="rounded bg-rose-600 px-1.5 py-0.5 text-[12px] font-medium text-white hover:bg-rose-500"
              >
                {t('panel.webEntry.clearConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded px-1.5 py-0.5 text-[12px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              >
                {t('panel.webEntry.clearCancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="rounded px-1.5 py-0.5 text-[12px] text-gray-500 hover:bg-gray-800 hover:text-rose-300"
            >
              {t('panel.webEntry.clearAll')}
            </button>
          )
        )}
      </div>

      {maxEditorAt && (
        <SatelliteMaxPopup
          value={effectiveMax}
          screenX={maxEditorAt.x}
          screenY={maxEditorAt.y}
          bounds={WEB_ENTRY_MAX_BOUNDS}
          titleKey="panel.webEntry.maxTitle"
          hintKey="panel.webEntry.maxHint"
          onClose={() => setMaxEditorAt(null)}
          onCommit={commitMax}
        />
      )}

      {entries.length === 0 ? (
        <span className="text-[12px] text-gray-600">{t('panel.webEntry.empty')}</span>
      ) : (
        <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/50">
          <ScrollFade maxHeight={LIST_MAX_HEIGHT} className="px-2 py-1">
            {entries.map((e) => (
              <WebEntryRow
                key={e.id}
                entry={e}
                expanded={expanded === e.id}
                onToggleExpand={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
                onCheck={() => check(e.id)}
              />
            ))}
          </ScrollFade>
        </div>
      )}
    </div>
  );
}

function WebEntryRow({
  entry,
  expanded,
  onToggleExpand,
  onCheck,
}: {
  entry: WebEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onCheck: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isSearch = entry.kind === 'search';
  const headline = isSearch ? entry.query : entry.url;

  return (
    <div className="border-b border-gray-800/60 py-1 last:border-b-0">
      <div className="flex items-start gap-1.5">
        {/* 체크 = 제거. 되돌리기는 없다 — 지워지는 것은 산출물이 아니라 관찰 이력이다(§5.23). */}
        <input
          type="checkbox"
          checked={false}
          onChange={onCheck}
          title={t('panel.webEntry.checkHint')}
          aria-label={t('panel.webEntry.checkHint')}
          className="mt-0.5 h-3 w-3 flex-shrink-0 cursor-pointer accent-sky-500"
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-1.5">
            <span
              className={`flex-shrink-0 rounded px-1 py-px text-[12px] font-medium ${
                isSearch ? 'bg-sky-900/60 text-sky-300' : 'bg-gray-800 text-gray-300'
              }`}
            >
              {t(isSearch ? 'panel.webEntry.kindSearch' : 'panel.webEntry.kindFetch')}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200" title={headline}>
              {headline ? (isSearch ? headline : middleEllipsis(headline)) : '—'}
            </span>
            <span className="flex-shrink-0 text-[12px] text-gray-600">{formatTime(entry.at)}</span>
          </span>
        </button>
        {!isSearch && entry.url && (
          <button
            type="button"
            title={t('panel.webEntry.openExternal')}
            aria-label={t('panel.webEntry.openExternal')}
            // 링크를 여는 길은 앱 전체에 하나다 — `window.open` → main `setWindowOpenHandler`
            // → `shell.openExternal`. 실패 안내는 `ExternalOpenNotice` 가 맡는다(§3.7).
            onClick={() => { window.open(entry.url, '_blank', 'noopener'); }}
            className="mt-0.5 flex-shrink-0 rounded p-0.5 text-gray-600 hover:bg-gray-800 hover:text-sky-400"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
            </svg>
          </button>
        )}
      </div>

      {/* 부가 정보 한 줄 — 검색은 결과 건수·결과 도메인, 가져오기는 물어본 내용 */}
      {isSearch && (entry.resultCount !== undefined || entry.resultHosts?.length) && (
        <div className="ml-[18px] mt-0.5 flex flex-wrap items-center gap-1">
          {entry.resultCount !== undefined && (
            <span className="text-[12px] text-gray-500">
              {t('panel.webEntry.resultCount', { count: entry.resultCount })}
            </span>
          )}
          {entry.resultHosts?.map((h) => (
            <span key={h} className="rounded bg-gray-800/80 px-1 py-px text-[12px] text-gray-400">
              {h}
            </span>
          ))}
        </div>
      )}
      {!isSearch && entry.prompt && (
        <div className="ml-[18px] mt-0.5 truncate text-[12px] text-gray-500" title={entry.prompt}>
          {entry.prompt}
        </div>
      )}

      {/* 실패는 숨기지 않는다 — "왜 못 읽었나"가 사용자에게 필요한 정보다(§5.23). */}
      {entry.error && (
        <div className="ml-[18px] mt-0.5 text-[12px] text-rose-400">{entry.error}</div>
      )}

      {/* 결과 요약 꼬리 — 줄을 누르면 펼쳐진다. 못 읽었으면 `—`(0 으로 채우지 않는다). */}
      {expanded && (
        <pre className="ml-[18px] mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-900/80 p-1.5 text-[12px] leading-snug text-gray-400">
          {entry.result ?? '—'}
          {entry.resultTruncated ? `\n${t('panel.webEntry.truncated')}` : ''}
        </pre>
      )}
    </div>
  );
}
