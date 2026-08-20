/**
 * §5.10 v3.75 — 기억 라이브러리 "문서 뷰" 안의 카드 한 편.
 *
 * v3.77 에서 오버레이가 창(이동·리사이즈·최대화·최소화)이 되며 파일이 커져 분리했다(coding.md 200줄 규칙).
 * 카드 타입 글리프·라벨 키는 오버레이 헤더의 타입 필터도 함께 쓰므로 여기서 단일 출처로 내보낸다.
 */
import { useTranslation } from 'react-i18next';
import type { BrainCard, BrainCardType } from '@vibisual/shared';
import { BUBBLE_STYLES } from '@vibisual/shared';
import { BRAIN_TYPE_COLORS } from '../../hooks/useBubbleLayout.js';
import { BrainCardDetail } from './BrainCardDetail.js';

/** Brain 액센트(v3.75 indigo). 버블 색과 한 곳에서 나온다. */
export const BRAIN_ACCENT = BUBBLE_STYLES.brain.color;

export const CARD_TYPES: BrainCardType[] = ['decision', 'mistake', 'lesson', 'rule', 'fact'];

/** 타입별 stroke SVG glyph(lucide 톤). */
export const TYPE_ICON_D: Record<BrainCardType, string> = {
  decision: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  mistake: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  lesson: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z',
  rule: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  fact: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
};

export const TYPE_LABEL_KEY: Record<BrainCardType, { key: string; fallback: string }> = {
  decision: { key: 'brain.type.decision', fallback: '결정' },
  mistake: { key: 'brain.type.mistake', fallback: '실수' },
  lesson: { key: 'brain.type.lesson', fallback: '교훈' },
  rule: { key: 'brain.type.rule', fallback: '규칙' },
  fact: { key: 'brain.type.fact', fallback: '사실' },
};

export function formatAgo(ts: number | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!ts) return '';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return t('brain.feed.agoNow', { defaultValue: '방금' });
  const min = Math.round(sec / 60);
  if (min < 60) return t('brain.feed.agoMin', { defaultValue: '{{n}}분 전', n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('brain.feed.agoHour', { defaultValue: '{{n}}시간 전', n: hr });
  const day = Math.round(hr / 24);
  if (day < 30) return t('brain.feed.agoDay', { defaultValue: '{{n}}일 전', n: day });
  return t('brain.feed.agoMonth', { defaultValue: '{{n}}개월 전', n: Math.round(day / 30) });
}

/** §5.10 v3.78 — 확인 필요 뱃지·버튼의 주의색(amber). 액센트 indigo 와 섞지 않는다. */
const WARN_COLOR = '#D97706';

/**
 * §5.10 v3.78 — "이 파일이 그 뒤 N회 수정됨" 한 줄. 서버 `staleHint` 와 같은 정보를 UI 어투로 만든다
 * (서버 문자열을 그대로 쓰면 다국어가 안 된다 — 서버 문구는 모델용, 이건 사람용).
 */
function editedSummary(card: BrainCard): { files: string[]; total: number } {
  const edited = (card.anchors ?? []).filter((a) => (a.editedSince ?? 0) > 0);
  return {
    files: edited.map((a) => a.path.split(/[\\/]/).pop() ?? a.path),
    total: edited.reduce((n, a) => n + (a.editedSince ?? 0), 0),
  };
}

export interface DocEntryProps {
  card: BrainCard;
  helpfulOverride: number | undefined;
  expanded: boolean;
  onToggle: (id: string) => void;
  onHelpful: (card: BrainCard) => void;
  /** §5.10 v3.78 — "지금도 맞음"(앵커 재고정). 확인 필요 카드에만 뜬다. */
  onVerify?: (card: BrainCard) => void;
  /** §5.10 v3.78 — "낡음"(대체 후보 적립). 확인 필요 카드에만 뜬다. */
  onStale?: (card: BrainCard) => void;
  /** §5.10 v3.78 — "되돌리기". 보관(정리됨) 카드에만 뜬다. */
  onRestore?: (card: BrainCard) => void;
  /** §5.10 v3.81 — "현재 진실로 확인". 키가 있는 후보·충돌 카드에만 뜬다. */
  onConfirm?: (card: BrainCard) => void;
  /** §5.10 v3.81 — "아니오". 사용자 거부(파일은 남고 주입에서 빠진다). */
  onReject?: (card: BrainCard) => void;
}

export function DocEntry({ card, helpfulOverride, expanded, onToggle, onHelpful, onVerify, onStale, onRestore, onConfirm, onReject }: DocEntryProps): React.JSX.Element {
  const { t } = useTranslation();
  const accent = BRAIN_TYPE_COLORS[card.type];
  const helpful = helpfulOverride ?? card.helpfulCount ?? 0;
  const label = TYPE_LABEL_KEY[card.type];
  const fresh = formatAgo(Math.max(card.updatedAt ?? 0, card.lastHelpfulAt ?? 0) || card.createdAt, t);
  const needsCheck = card.verifyState === 'needs-check';
  const edited = needsCheck ? editedSummary(card) : null;
  // §5.10 v3.81 — 검증축 배지. 저장고에 있다는 것과 현재 진실이라는 것은 다르다.
  const verifyState = card.verifyState ?? 'candidate';
  const isCurrent = verifyState === 'verified' && card.status === 'active' && card.validUntil == null;
  const isContested = verifyState === 'contested';
  // 키가 있는데 아직 진실이 아닌 카드만 승인 대상(키 없는 증거 카드는 SSOT 밖이다).
  const awaitingReview = !!card.canonicalKey && !isCurrent && verifyState !== 'rejected';

  return (
    <article className="relative border-b border-zinc-800/70 py-4 pl-4 last:border-b-0">
      {/* 타입 액센트 바 — 색은 여기와 글리프에만(본체·배경엔 쓰지 않는다). */}
      <span className="absolute inset-y-4 left-0 w-[2px] rounded-full" style={{ backgroundColor: accent }} />

      <header className="flex items-start gap-2.5">
        <svg className="mt-[3px] h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={TYPE_ICON_D[card.type]} />
        </svg>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-zinc-100">{card.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-zinc-500">
            <span style={{ color: accent }}>{t(label.key, { defaultValue: label.fallback })}</span>
            {card.always && (
              <span className="rounded px-1.5 py-px text-[12px]" style={{ backgroundColor: `${BRAIN_ACCENT}1F`, color: '#A5B4FC' }}>
                {t('brain.alwaysBadge', { defaultValue: '상시' })}
              </span>
            )}
            {needsCheck && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[12px]" style={{ backgroundColor: `${WARN_COLOR}1F`, color: WARN_COLOR }}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
                {t('brain.needsCheckBadge', { defaultValue: '확인 필요' })}
              </span>
            )}
            {card.status === 'archived' && (
              <span className="rounded bg-zinc-800 px-1.5 py-px text-[12px] text-zinc-400">
                {t('brain.archivedBadge', { defaultValue: '정리됨' })}
              </span>
            )}
            {isCurrent && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[12px]" style={{ backgroundColor: '#10B9811F', color: '#34D399' }}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {t('brain.currentBadge', { defaultValue: '현재 진실' })}
              </span>
            )}
            {isContested && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[12px]" style={{ backgroundColor: '#F871711F', color: '#F87171' }}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4M12 17h.01M12 3 2 21h20L12 3z" />
                </svg>
                {t('brain.contestedBadge', { defaultValue: '값 충돌' })}
              </span>
            )}
            {!isCurrent && !isContested && verifyState === 'candidate' && card.canonicalKey && (
              <span className="rounded px-1.5 py-px text-[12px] text-zinc-400 ring-1 ring-inset ring-zinc-700">
                {t('brain.candidateBadge', { defaultValue: '검토 대기' })}
              </span>
            )}
            {verifyState === 'rejected' && (
              <span className="rounded bg-zinc-800 px-1.5 py-px text-[12px] text-zinc-500">
                {t('brain.rejectedBadge', { defaultValue: '거부됨' })}
              </span>
            )}
            {card.canonicalKey && (
              <span className="font-mono text-[12px] text-zinc-600" title={t('brain.canonicalKeyTip', { defaultValue: '이 지식의 고정 주소 — 같은 주소에는 현재 진실이 하나만 존재합니다.' })}>
                {card.canonicalKey}
              </span>
            )}
            {card.pinned && <span className="text-amber-500/80">{t('brain.pin', { defaultValue: '고정' })}</span>}
            {fresh && <span>{fresh}</span>}
            {helpful > 0 && <span>{t('brain.feed.helpfulCount', { defaultValue: '도움 {{n}}', n: helpful })}</span>}
            {card.seen === false && (
              <span className="inline-flex items-center gap-1" style={{ color: '#A5B4FC' }}>
                <span className="h-1 w-1 rounded-full" style={{ backgroundColor: BRAIN_ACCENT }} />
                {t('brain.feed.unseen', { defaultValue: '새 기억' })}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onHelpful(card)}
          title={t('brain.feed.helpful', { defaultValue: '도움이 됐어요' })}
          className="mt-0.5 shrink-0 rounded p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />
          </svg>
        </button>
      </header>

      {/* §5.10 v3.81 — 승인 관문. 여기를 지나야 AI 브리핑에 나간다(저장됐다 ≠ 진실이다). */}
      {awaitingReview && (onConfirm || onReject) && (
        <div className="mt-2 ml-[26px] flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
          <p className="mr-1 text-[12px] text-zinc-400">
            {isContested
              ? t('brain.confirmPromptContested', { defaultValue: '같은 주소에 값이 갈렸습니다 — 맞는 쪽을 골라야 AI 에게 전달됩니다.' })
              : t('brain.confirmPrompt', { defaultValue: '아직 AI 에게 전달되지 않는 후보입니다.' })}
          </p>
          {onConfirm && (
            <button
              type="button"
              onClick={() => onConfirm(card)}
              className="rounded px-2 py-1 text-[12px] font-semibold transition-colors"
              style={{ backgroundColor: `${BRAIN_ACCENT}26`, color: '#A5B4FC' }}
            >
              {t('brain.confirmCurrent', { defaultValue: '현재 진실로 확인' })}
            </button>
          )}
          {onReject && (
            <button
              type="button"
              onClick={() => onReject(card)}
              title={t('brain.rejectTip', { defaultValue: '삭제되지 않습니다 — 기록으로 남고 주입에서만 빠집니다.' })}
              className="rounded bg-zinc-800 px-2 py-1 text-[12px] text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              {t('brain.reject', { defaultValue: '아니오' })}
            </button>
          )}
        </div>
      )}

      {/* §5.10 v3.78 — 무효화 신호 + 재검증 1비트. 카드를 감추지 않고 "대조하라"고 말한다. */}
      {needsCheck && (
        <div className="mt-2 ml-[26px] rounded-lg border px-2.5 py-2" style={{ borderColor: `${WARN_COLOR}40`, backgroundColor: `${WARN_COLOR}0F` }}>
          <p className="text-[12px] leading-relaxed" style={{ color: WARN_COLOR }}>
            {edited && edited.total > 0
              ? t('brain.needsCheckEdited', {
                  defaultValue: '{{files}} 이(가) 이 기억을 적은 뒤 {{n}}회 수정됐습니다 — 지금 코드와 맞는지 확인해 주세요.',
                  files: edited.files.slice(0, 3).join(', '),
                  n: edited.total,
                })
              : t('brain.needsCheckReported', { defaultValue: '이 기억이 낡았다는 신고가 있었습니다 — 지금 코드와 맞는지 확인해 주세요.' })}
          </p>
          {(onVerify || onStale) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {onVerify && (
                <button
                  type="button"
                  onClick={() => onVerify(card)}
                  className="rounded px-2 py-1 text-[12px] font-semibold transition-colors"
                  style={{ backgroundColor: `${WARN_COLOR}26`, color: WARN_COLOR }}
                >
                  {t('brain.stillValid', { defaultValue: '지금도 맞음' })}
                </button>
              )}
              {onStale && (
                <button
                  type="button"
                  onClick={() => onStale(card)}
                  title={t('brain.markStaleTip', { defaultValue: '반복 신고되면 자동으로 정리됩니다(삭제되지 않고 되돌릴 수 있습니다).' })}
                  className="rounded bg-zinc-800 px-2 py-1 text-[12px] text-zinc-300 transition-colors hover:bg-zinc-700"
                >
                  {t('brain.markStale', { defaultValue: '낡았음' })}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {card.status === 'archived' && onRestore && (
        <div className="mt-2 ml-[26px]">
          <button
            type="button"
            onClick={() => onRestore(card)}
            className="rounded bg-zinc-800 px-2 py-1 text-[12px] text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            {t('brain.restoreCard', { defaultValue: '되돌리기' })}
          </button>
        </div>
      )}

      {card.body.trim() && (
        <p className="mt-2 whitespace-pre-wrap pl-[26px] text-[13px] leading-relaxed text-zinc-400">{card.body.trim()}</p>
      )}

      {card.files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-[26px]">
          {card.files.map((f) => (
            <span key={f} className="truncate rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-500" title={f}>{f}</span>
          ))}
        </div>
      )}

      <div className="mt-2 pl-[26px]">
        <button
          type="button"
          onClick={() => onToggle(card.id)}
          className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {expanded
            ? t('brain.library.closeDetail', { defaultValue: '닫기' })
            : t('brain.library.openDetail', { defaultValue: '편집 · 승격 · 삭제' })}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60">
          <BrainCardDetail card={card} />
        </div>
      )}
    </article>
  );
}
