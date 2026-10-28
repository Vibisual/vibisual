import { forwardRef, memo } from 'react';
import type { MemoLinkInk, MemoLinkSegment } from './memoLinks.js';

/**
 * §5.5 #17-36 ⑫ — 입력칸 뒤 거울 층. textarea 는 토막 밑줄이 안 돼 같은 글자를 투명하게 깔고 링크만 칠한다.
 * 글자 모양·줄바꿈(`pre-wrap`+`break-word`, 폭은 `clientWidth`)·스크롤이 입력칸과 같아야 한다 — 어긋나면 밑줄이 엉뚱한 글자 밑에 간다. 마지막 빈 줄에도 높이가 있게 폭 없는 공백을 붙인다.
 */

interface MemoLinkMirrorProps {
  segments: MemoLinkSegment[];
  ink: MemoLinkInk;
  /** 캐럿이 들어가 있는 링크 — 바탕을 조금 더 짙게(링크 상자가 가리키는 그 토막). */
  activeLinkId: string | null;
}

/** 밑줄의 모양(두께·간격)은 고정값이라 클래스로 — 색만 종이를 따라 style 로 간다. */
const UNDERLINE = 'rounded-[3px] underline decoration-[1.5px] underline-offset-[3px]';

export const MemoLinkMirror = memo(forwardRef<HTMLDivElement, MemoLinkMirrorProps>(function MemoLinkMirror(
  { segments, ink, activeLinkId },
  ref,
) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={ref} className="whitespace-pre-wrap break-words px-2.5 py-2 text-[13px] leading-relaxed text-transparent">
        {segments.map((seg, i) => {
          if (seg.linkId) {
            return (
              <span
                key={`l-${seg.linkId}`}
                data-memo-link={seg.linkId}
                className={UNDERLINE}
                // 링크 색은 종이(사용자가 고른 데이터 색) 밝기를 따르므로 클래스로 표현할 수 없다.
                style={{
                  textDecorationColor: ink.line,
                  background: seg.linkId === activeLinkId ? ink.activeFill : ink.fill,
                }}
              >
                {seg.text}
              </span>
            );
          }
          if (seg.pending) {
            return (
              <span
                key="pending"
                data-memo-link-pending=""
                className={`${UNDERLINE} decoration-dashed`}
                style={{ textDecorationColor: ink.pending, background: ink.fill }}
              >
                {seg.text}
              </span>
            );
          }
          return <span key={`t-${String(i)}`}>{seg.text}</span>;
        })}
        {'​'}
      </div>
    </div>
  );
}));
