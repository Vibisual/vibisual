import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

/** 좋아요/싫어요 등 보조 컨트롤 — 호버(또는 포커스) 때만 드러나 상시 잡음을 없앤다. */
export function CardHoverControls({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-1.5 border-t border-gray-800/60 pt-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
      {children}
    </div>
  );
}
