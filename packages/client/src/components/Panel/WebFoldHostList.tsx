import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebEntry, WebFoldHost, WebFoldInfo } from '@vibisual/shared';
import { WebEntryList } from './WebEntryList.js';

interface Props {
  /** 접힌 웹 버블의 내역(서버 값 그대로 · 최근 호스트가 앞). */
  fold: WebFoldInfo;
  /** 스냅샷의 `domainEntries` 그대로 — 접힌 호스트도 제 노드 id 로 실려 온다. */
  domainEntries: Record<string, WebEntry[]>;
}

/** §7.22 — 접힌 웹 버블 패널: 호스트마다 접었다 펴는 칸. 칸 본문은 `WebEntryList` 에 진짜 호스트 id 를 넘긴다(접힌 id 는 서버에 없어 404). */
export function WebFoldHostList({ fold, domainEntries }: Props): React.JSX.Element {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(fold.hosts[0] ? [fold.hosts[0].id] : []),
  );

  const toggle = useCallback((hostId: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      {fold.hosts.map((h) => (
        <WebFoldHostRow
          key={h.id}
          host={h}
          open={openIds.has(h.id)}
          entries={domainEntries[h.id] ?? []}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

/** 고정 = 그 호스트의 `preserve-pin` — 고정한 호스트는 접히지 않아 다음 스냅샷에서 제 버블로 선다. */
function WebFoldHostRow({
  host,
  open,
  entries,
  onToggle,
}: {
  host: WebFoldHost;
  open: boolean;
  entries: WebEntry[];
  onToggle: (hostId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const handlePin = useCallback(() => {
    fetch(`/api/bubble/${host.id}/preserve-pin`, { method: 'PATCH' }).catch(() => {});
  }, [host.id]);

  return (
    <div className="overflow-hidden rounded border border-gray-800">
      <div className="flex items-center gap-1 pr-1 hover:bg-gray-900/60">
        <button
          type="button"
          onClick={() => onToggle(host.id)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
        >
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-100" title={host.host}>
            {host.host}
          </span>
          <span className="flex-shrink-0 text-[12px] font-semibold text-sky-400">
            {t('panel.webEntry.count', { count: host.entryCount })}
          </span>
        </button>
        <button
          type="button"
          onClick={handlePin}
          title={t('panel.webFold.pinDomain')}
          aria-label={t('panel.webFold.pinDomain')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-amber-400 pointer-coarse:h-9 pointer-coarse:w-9"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-gray-800 px-1.5 py-1.5">
          <WebEntryList
            nodeId={host.id}
            host={host.host}
            entries={entries}
            maxWebEntries={host.maxWebEntries}
          />
        </div>
      )}
    </div>
  );
}
