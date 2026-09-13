/**
 * §7.22 — 도메인 버블 웹 이력 **한 건**을 통째로 보는 창.
 *
 * 목록(`WebEntryList`)은 260px 안에서 훑어보는 자리다. 종전에는 그 안에서 결과 본문을 `pre` 로
 * 펼쳤는데, 그 블록은 목록을 아래로 밀어내면서도 정작 읽힐 만큼은 담지 못했다 — 훑기와 읽기를
 * 한 칸에서 하려다 둘 다 놓친 모양이다. 그래서 **읽는 일은 이 창으로 옮긴다**: 목록이 줄여 놓은
 * 것(검색어·URL·결과 도메인)을 여기서는 **줄임 없이** 풀어 보여 주는 것이 이 창의 존재 이유다.
 *
 * 닫기 배선은 새로 만들지 않는다 — 백드롭은 `useBackdropDismiss`(팝업 안에서 시작한 드래그로는
 * 안 닫힌다는 공통 규약), Esc 는 window keydown. 밖으로 여는 길도 앱에 하나뿐인
 * `window.open` → main `setWindowOpenHandler` → `shell.openExternal` 을 그대로 쓴다(§5.23 경계 —
 * 앱 안에서 페이지를 열지 않는다).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebEntry } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

interface Props {
  entry: WebEntry;
  /** 이 항목이 속한 도메인(버블 라벨). 검색은 의사 호스트라 헤더가 종류 칩으로 대신 말한다. */
  host?: string;
  onClose: () => void;
  /** 이 항목을 지운다(목록과 **같은 창구**를 부른다). 지우면 부르는 쪽이 창을 닫는다. */
  onDelete: () => void;
}

/** 팝업은 전체 시각을 적는다 — 목록의 `HH:MM` 은 훑기용이고, "언제였나"는 여기서 답한다. */
function formatFullTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 밖 브라우저로 넘긴다. 창이 막히면 조용히 넘어간다(오류창이 더 나쁘다 — `webSearchUrl` 과 같은 판단). */
function openExternal(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore */
  }
}

export function WebEntryDetailPopup({ entry, host, onClose, onDelete }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'headline' | 'result' | null>(null);
  const isSearch = entry.kind === 'search';
  const headline = isSearch ? entry.query : entry.url;

  const backdrop = useBackdropDismiss(onClose);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = useCallback((text: string, which: 'headline' | 'result') => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(which);
        setTimeout(() => setCopied((cur) => (cur === which ? null : cur)), 1500);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" {...backdrop}>
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50">
        {/* ① 헤더 — 무엇을(종류) · 어디서(호스트) · 언제(전체 시각) */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-2.5">
          <span
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium ${
              isSearch ? 'bg-sky-900/60 text-sky-300' : 'bg-gray-800 text-gray-300'
            }`}
          >
            <KindGlyph isSearch={isSearch} />
            {t(isSearch ? 'panel.webEntry.kindSearch' : 'panel.webEntry.kindFetch')}
          </span>
          {host && <span className="truncate text-[12px] text-gray-400">{host}</span>}
          <div className="flex-1" />
          <span className="shrink-0 font-mono text-[12px] text-gray-500">{formatFullTime(entry.at)}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('panel.webEntry.detailClose')}
            title={t('panel.webEntry.detailClose')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-800 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* ② 표제 — 목록이 줄인 것을 여기서는 **줄임 없이** 다 보여 준다. */}
          <div className="mb-2">
            <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
              {t(isSearch ? 'panel.webEntry.detailQueryLabel' : 'panel.webEntry.detailUrlLabel')}
            </div>
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1 break-words rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5 text-[13px] leading-relaxed text-gray-100">
                {headline ?? '—'}
              </div>
              {headline && (
                <button
                  type="button"
                  onClick={() => copy(headline, 'headline')}
                  title={t('panel.webEntry.copy')}
                  aria-label={t('panel.webEntry.copy')}
                  className="mt-0.5 shrink-0 rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-sky-300"
                >
                  <CopyGlyph done={copied === 'headline'} />
                </button>
              )}
            </div>
          </div>

          {/* ③ 메타 — 검색은 건수 + 결과 도메인 전부, 가져오기는 물어본 내용 */}
          {isSearch && (entry.resultCount !== undefined || entry.resultHosts?.length) && (
            <div className="mb-2">
              {entry.resultCount !== undefined && (
                <div className="mb-1 text-[12px] text-gray-400">
                  {t('panel.webEntry.resultCount', { count: entry.resultCount })}
                </div>
              )}
              {!!entry.resultHosts?.length && (
                <div className="flex flex-wrap gap-1">
                  {entry.resultHosts.map((h) => (
                    <button
                      key={h}
                      type="button"
                      // 결과 도메인은 밖에서 연다 — 캔버스에 버블을 만들지 않는다(§5.23:
                      // 에이전트는 이 도메인들을 **읽지 않았다**).
                      onClick={() => openExternal(`https://${h}`)}
                      title={t('panel.webEntry.openExternal')}
                      className="rounded bg-gray-800/80 px-1.5 py-0.5 text-[12px] text-gray-300 hover:bg-gray-700 hover:text-sky-300"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isSearch && entry.prompt && (
            <div className="mb-2">
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-gray-500">
                {t('panel.webEntry.detailPromptLabel')}
              </div>
              <div className="break-words rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5 text-[12px] leading-relaxed text-gray-300">
                {entry.prompt}
              </div>
            </div>
          )}

          {/* ④ 실패는 숨기지 않는다 — "왜 못 읽었나"가 정보다(§5.23). */}
          {entry.error && (
            <div className="mb-2 rounded border border-rose-800/60 bg-rose-950/30 px-2 py-1.5 text-[12px] leading-relaxed text-rose-300">
              {entry.error}
            </div>
          )}

          {/* ⑤ 결과 본문 — 못 읽었으면 0 으로 채우지 않고 빈 상태 문구를 적는다(§5.23). */}
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-gray-500">
                {t('panel.webEntry.detailResultLabel')}
              </span>
              {entry.resultTruncated && (
                <span className="rounded bg-amber-900/40 px-1 py-px text-[12px] text-amber-300">
                  {t('panel.webEntry.truncated')}
                </span>
              )}
            </div>
            {entry.result ? (
              <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-800 bg-gray-950/60 px-2 py-1.5 text-[12px] leading-relaxed text-gray-300">
                {entry.result}
              </pre>
            ) : (
              <div className="rounded border border-dashed border-gray-800 px-2 py-3 text-center text-[12px] text-gray-600">
                {t('panel.webEntry.detailNoResult')}
              </div>
            )}
          </div>
        </div>

        {/* 바닥 행동 — 복사 · (fetch 만) 밖에서 열기 · 지우기 */}
        <div className="flex items-center gap-1.5 border-t border-gray-800 px-4 py-2">
          {entry.result && (
            <button
              type="button"
              onClick={() => copy(entry.result ?? '', 'result')}
              className="rounded px-2 py-1 text-[12px] text-gray-300 hover:bg-gray-800 hover:text-sky-300"
            >
              {copied === 'result' ? t('panel.webEntry.copied') : t('panel.webEntry.copyResult')}
            </button>
          )}
          {!isSearch && entry.url && (
            <button
              type="button"
              onClick={() => openExternal(entry.url ?? '')}
              className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-gray-300 hover:bg-gray-800 hover:text-sky-300"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
              </svg>
              {t('panel.webEntry.openExternal')}
            </button>
          )}
          <div className="flex-1" />
          {/* 지우면 창을 닫는다 — 없는 항목을 보고 있는 창은 유령이다. */}
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-gray-400 hover:bg-rose-950/40 hover:text-rose-300"
          >
            <TrashGlyph />
            {t('panel.webEntry.deleteEntry')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 종류 글리프 — 검색은 돋보기, 가져오기는 문서. 칩의 낱말만으로는 훑을 때 눈에 안 걸린다. */
export function KindGlyph({ isSearch }: { isSearch: boolean }): React.JSX.Element {
  return isSearch ? (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ) : (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** 휴지통 — 목록·팝업이 같은 글리프를 쓴다(같은 행동에 모양이 두 벌이면 하나만 고쳐진다). */
export function TrashGlyph(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

/** 복사 — 누른 뒤 잠깐 체크로 바뀐다(눌렸는지 알 길이 그것뿐이다). */
function CopyGlyph({ done }: { done: boolean }): React.JSX.Element {
  return done ? (
    <svg className="h-3.5 w-3.5 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m20 6-11 11-5-5" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
