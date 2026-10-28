import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STREAM_COMPACT_SUMMARY_CHARS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/** §5.5 #17-12 — 신고·검수 카드 공용 조각: 행동 구획만 기본 노출, 나머지는 [자세히]로. */

interface CardSectionProps {
  title: string;
  /** 항목 앞 글리프 — 각 카드가 자기 아이콘을 넘긴다. */
  icon: React.JSX.Element;
  items: string[];
  /** 목록 텍스트 색(강조 정도). */
  textClass: string;
  /** 글리프 색. */
  glyphClass: string;
  /** 제목 색. */
  titleClass: string;
  /** 강조 패널(행동 구획)로 감쌀지 — 테두리/배경 클래스. 없으면 평범한 목록. */
  panelClass?: string;
}

/** 카드 안의 한 구획(제목 + 글머리 목록). 항목이 없으면 아무것도 그리지 않는다. */
export const CardSection = memo(function CardSection({
  title, icon, items, textClass, glyphClass, titleClass, panelClass,
}: CardSectionProps): React.JSX.Element | null {
  if (items.length === 0) return null;
  const body = (
    <>
      <div className={`mb-1 text-[12px] font-semibold uppercase tracking-wide ${titleClass}`}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-[13px] leading-relaxed ${textClass}`}>
            <span className={glyphClass}>{icon}</span>
            <span className="min-w-0 flex-1 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </>
  );
  return panelClass
    ? <div className={`mb-2 rounded border px-2.5 py-1.5 ${panelClass}`}>{body}</div>
    : <div className="mb-2">{body}</div>;
});

interface CardDetailsProps {
  /** 접혀 있을 때 요약으로 보여줄 개수(0 이면 토글 자체를 숨긴다). */
  count: number;
  children: React.ReactNode;
}

/** 카드 맥락 구획 묶음 — 기본 접힘 + [자세히 (N)] 토글. 사용자가 원할 때만 읽게 한다. */
export function CardDetails({ count, children }: CardDetailsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (count <= 0) return null;
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/det mb-1 flex items-center gap-1 text-[12px] text-gray-500 transition-colors hover:text-gray-300"
      >
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span>{open ? t('ide.card.hideDetails') : t('ide.card.showDetails', { count })}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

/** §5.5 #17-21 ④ — prop 대신 store 를 직접 읽어 Sub·메인 탭이 같은 규칙을 따른다(#17-12 ⑦). */
export function useCompactCards(): boolean {
  return useGraphStore((s) => s.ideStreamDensity) === 'compact';
}

/** 접힌 한 줄에 실을 요약 — 비어 있지 않은 첫 조각을 상한 길이로 자른다. */
export function compactSummary(parts: (string | undefined)[]): string {
  const first = parts.find((p) => p !== undefined && p.trim() !== '')?.trim() ?? '';
  return first.length > STREAM_COMPACT_SUMMARY_CHARS ? `${first.slice(0, STREAM_COMPACT_SUMMARY_CHARS)}…` : first;
}

/** §5.5 #17-18 ⑦-2 — 턴이 아직 도는 중인 카드 배지. 카드가 신고된 자리(⑦-1)에 앉아 화면 가운데일 수 있어, 없으면 "끝났다"로 읽힌다. */
export function CardLiveBadge(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      title={t('ide.card.inProgressHint')}
      className="flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] text-[12px] font-semibold uppercase tracking-wide text-amber-300"
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />
      {t('ide.card.inProgress')}
    </span>
  );
}

interface CompactCardLineProps {
  icon: React.JSX.Element;
  label: string;
  /** 라벨·글리프 색(카드 종류별 액센트). */
  labelClass: string;
  summary: string;
  onExpand: () => void;
  /** §5.5 #17-18 ⑦-2 — 접힌 한 줄에서도 "아직 도는 중"은 보여야 한다(간결 밀도에서 배지가 사라지지 않게). */
  live?: boolean;
}

/** §5.5 #17-21 ④ — 행동 구획 없는 카드의 간결 한 줄(라벨 + 요약). 누르면 원래 카드가 펼쳐진다(내용을 버리지 않는다). */
export function CompactCardLine({ icon, label, labelClass, summary, onExpand, live }: CompactCardLineProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onExpand}
      title={t('ide.streamRenderer.clickToExpand')}
      className="group/cmp mx-2 my-0.5 flex w-[calc(100%-1rem)] items-center gap-2 rounded px-2.5 py-1 text-left transition-colors hover:bg-gray-800/40 max-md:mx-1 max-md:w-[calc(100%-0.5rem)]"
    >
      <svg className="h-3 w-3 flex-shrink-0 text-gray-600 transition-colors group-hover/cmp:text-gray-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
      <span className={`flex-shrink-0 ${labelClass}`}>{icon}</span>
      <span className={`flex-shrink-0 text-[12px] font-semibold uppercase tracking-wide ${labelClass}`}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500">{summary}</span>
      {live && <CardLiveBadge />}
    </button>
  );
}

/** 호버·포커스 때만 드러난다. 터치엔 hover 가 없어 늘 보인다 — 숨기면 투명한 단추가 손가락에 눌린다. */
export function CardHoverControls({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-1.5 border-t border-gray-800/60 pt-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100">
      {children}
    </div>
  );
}
