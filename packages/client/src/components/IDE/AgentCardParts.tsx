import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STREAM_COMPACT_SUMMARY_CHARS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * AgentCardParts — §5.5 #17-12 카드 다이어트 공용 조각.
 *
 * 작업 신고·검수 카드가 각자 5~3개 구획을 상시 펼쳐 놓아 한 턴 끝에 읽을 게 두 배로 늘던 문제를 고친다.
 * **행동 구획**(사용자가 할 일 / 검수 포인트)만 기본 노출, 나머지 맥락은 [자세히]로 펼친다.
 * 신고·검수 두 카드가 같은 규칙을 쓰도록 여기 한 곳에 둔다(DRY).
 */

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
      <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${titleClass}`}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-[12.5px] leading-relaxed ${textClass}`}>
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
        className="group/det mb-1 flex items-center gap-1 text-[11px] text-gray-500 transition-colors hover:text-gray-300"
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

/**
 * §5.5 #17-21 ④ — 지금 밀도가 `간결`인가. 카드가 "행동만 남길지"를 이걸로 정한다.
 * 카드는 Sub 탭·메인 탭 양쪽에서 같은 컴포넌트로 쓰이므로, prop 배선 대신 store 를 직접 읽어
 * 두 탭이 자동으로 같은 규칙을 따르게 한다(#17-12 ⑦).
 */
export function useCompactCards(): boolean {
  return useGraphStore((s) => s.ideStreamDensity) === 'compact';
}

/** 접힌 한 줄에 실을 요약 — 비어 있지 않은 첫 조각을 상한 길이로 자른다. */
export function compactSummary(parts: (string | undefined)[]): string {
  const first = parts.find((p) => p !== undefined && p.trim() !== '')?.trim() ?? '';
  return first.length > STREAM_COMPACT_SUMMARY_CHARS ? `${first.slice(0, STREAM_COMPACT_SUMMARY_CHARS)}…` : first;
}

/**
 * §5.5 #17-18 ⑦-2 — "이 카드가 속한 턴은 **아직 도는 중**" 배지.
 *
 * ⑦-1 로 카드가 신고된 자리에 못 박히면서 카드는 화면 한가운데에 앉을 수 있게 됐다. 그 자리에서
 * 카드가 아무 말도 안 하면 사용자는 종전처럼 "카드가 떴으니 끝났겠지"로 읽는다 — 그래서 도는 중에
 * 나온 카드는 **자신이 끝을 뜻하지 않는다는 것**을 스스로 말한다. 턴이 끝나면 이 배지는 사라진다.
 */
export function CardLiveBadge(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      title={t('ide.card.inProgressHint')}
      className="flex flex-shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide text-amber-300"
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

/**
 * §5.5 #17-21 ④ — **행동 구획이 없는 카드**가 간결에서 접히는 한 줄 모양.
 * 라벨 + 요약만 남기고, 클릭하면 원래 카드가 그대로 펼쳐진다(내용을 버리지 않는다).
 */
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
      <span className={`flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide ${labelClass}`}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500">{summary}</span>
      {live && <CardLiveBadge />}
    </button>
  );
}

/** 좋아요/싫어요 등 보조 컨트롤 — 호버(또는 포커스) 때만 드러나 상시 잡음을 없앤다. */
export function CardHoverControls({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-1.5 border-t border-gray-800/60 pt-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
      {children}
    </div>
  );
}
