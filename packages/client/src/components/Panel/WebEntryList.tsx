import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MAX_WEB_ENTRIES, WEB_ENTRY_MAX_BOUNDS, type WebEntry } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { SatelliteMaxPopup } from './SatelliteMaxPopup.js';
import { KindGlyph, TrashGlyph, WebEntryDetailPopup } from './WebEntryDetailPopup.js';

interface Props {
  /** 도메인 버블의 노드 ID — 서버 API 가 이걸로 버블을 찾는다. */
  nodeId: string;
  /** 이 버블의 호스트(라벨). 상세 팝업 헤더가 "어디서 일어난 일인가"를 말할 때 쓴다. */
  host?: string;
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
 * **목록은 훑는 자리, 팝업은 읽는 자리.** 줄을 누르면 `WebEntryDetailPopup` 이 열려 검색어·URL
 * 전문과 결과 본문을 다 보여 준다(260px 안에서 `pre` 를 펼치던 종전 방식은 목록을 밀어내면서도
 * 읽히지 않았다 — 훑기와 읽기를 한 칸에서 하려다 둘 다 놓쳤다).
 *
 * **지우기는 휴지통 버튼이다.** 종전의 "항상 꺼진 체크박스"는 고르는 칸으로 읽히는데 실제 행동은
 * 제거라 모양과 행동이 어긋났다. 부르는 창구는 그대로(`/api/domain-entries/check`)라 서버 계약은
 * 안 바뀌고, 되돌리기가 없다는 것도 그대로다 — 지워지는 것은 산출물이 아니라 관찰 이력이다(§5.23).
 */
export function WebEntryList({ nodeId, host, entries, maxWebEntries }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [maxEditorAt, setMaxEditorAt] = useState<{ x: number; y: number } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
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

  // 열어 둔 항목이 서버 쪽에서 사라졌으면(상한 트림 · 모두 비우기 · 버블 소멸) 창도 닫는다 —
  // 없는 항목을 보여 주는 창은 유령이다.
  const detail = detailId === null ? undefined : entries.find((e) => e.id === detailId);
  useEffect(() => {
    if (detailId !== null && detail === undefined) setDetailId(null);
  }, [detailId, detail]);

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
          <ScrollFade maxHeight={LIST_MAX_HEIGHT} className="px-1 py-1">
            {entries.map((e) => (
              <WebEntryRow
                key={e.id}
                entry={e}
                onOpen={() => setDetailId(e.id)}
                onDelete={() => check(e.id)}
              />
            ))}
          </ScrollFade>
        </div>
      )}

      {detail && (
        <WebEntryDetailPopup
          entry={detail}
          host={host}
          onClose={() => setDetailId(null)}
          onDelete={() => {
            check(detail.id);
            setDetailId(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * 한 줄 = 한 항목. **줄 전체가 여는 버튼**이고, 지우기만 그 안에서 따로 선다.
 *
 * 계층은 글자 크기가 아니라 색·굵기로 만든다 — 표제는 진한 색, 요약·메타는 흐린 색이되 셋 다
 * 12px 이다(한글은 12px 아래로 내려가면 읽히지 않는다).
 */
function WebEntryRow({
  entry,
  onOpen,
  onDelete,
}: {
  entry: WebEntry;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isSearch = entry.kind === 'search';
  const headline = isSearch ? entry.query : entry.url;
  const summary = isSearch ? undefined : entry.prompt;

  return (
    <div className="group relative rounded hover:bg-gray-900/70">
      <button
        type="button"
        onClick={onOpen}
        title={t('panel.webEntry.openDetail')}
        className="w-full cursor-pointer rounded px-1.5 py-1 text-left"
      >
        {/* 첫 줄 — 종류 칩 · 표제 · 시각 */}
        <span className="flex items-center gap-1.5">
          <span
            className={`flex flex-shrink-0 items-center gap-1 rounded px-1 py-px text-[12px] font-medium ${
              isSearch ? 'bg-sky-900/60 text-sky-300' : 'bg-gray-800 text-gray-300'
            }`}
          >
            <KindGlyph isSearch={isSearch} />
            {t(isSearch ? 'panel.webEntry.kindSearch' : 'panel.webEntry.kindFetch')}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-100" title={headline}>
            {headline ? (isSearch ? headline : middleEllipsis(headline)) : '—'}
          </span>
          <span className="flex-shrink-0 font-mono text-[12px] text-gray-600">{formatTime(entry.at)}</span>
          {/* 지우기 버튼이 겹치지 않게 자리를 비워 둔다(호버 때만 버튼이 뜬다). */}
          <span className="w-5 flex-shrink-0" />
        </span>

        {/* 둘째 줄 — 한 줄 요약. 검색은 결과 건수 + 도메인 칩, 가져오기는 물어본 내용. */}
        {isSearch && (entry.resultCount !== undefined || entry.resultHosts?.length) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1 pl-0.5">
            {entry.resultCount !== undefined && (
              <span className="text-[12px] text-gray-500">
                {t('panel.webEntry.resultCount', { count: entry.resultCount })}
              </span>
            )}
            {entry.resultHosts?.slice(0, 3).map((h) => (
              <span key={h} className="rounded bg-gray-800/80 px-1 py-px text-[12px] text-gray-400">
                {h}
              </span>
            ))}
            {(entry.resultHosts?.length ?? 0) > 3 && (
              <span className="text-[12px] text-gray-600">
                {t('panel.webEntry.moreHosts', { count: (entry.resultHosts?.length ?? 0) - 3 })}
              </span>
            )}
          </span>
        )}
        {summary && (
          <span className="mt-0.5 block truncate pl-0.5 text-[12px] text-gray-500" title={summary}>
            {summary}
          </span>
        )}

        {/* 실패는 숨기지 않는다 — "왜 못 읽었나"가 사용자에게 필요한 정보다(§5.23). */}
        {entry.error && (
          <span className="mt-0.5 block truncate pl-0.5 text-[12px] text-rose-400" title={entry.error}>
            {entry.error}
          </span>
        )}
      </button>

      {/* 지우기 — 종전의 "항상 꺼진 체크박스" 자리. 모양이 곧 행동이다(되돌리기 없음 · §5.23). */}
      <button
        type="button"
        onClick={onDelete}
        title={t('panel.webEntry.checkHint')}
        aria-label={t('panel.webEntry.checkHint')}
        className="absolute right-1 top-1 rounded p-0.5 text-gray-700 opacity-0 transition-opacity hover:bg-rose-950/50 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashGlyph />
      </button>
    </div>
  );
}
