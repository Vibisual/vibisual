import { forwardRef, memo } from 'react';
import type { MemoLinkInk, MemoLinkSegment } from './memoLinks.js';

/**
 * MemoLinkMirror.tsx — §5.5 #17-36 ⑫ 메모 입력칸 **뒤에 깐 거울 층**.
 *
 * textarea 는 한 색 글자만 그릴 수 있다 — 글자 한 토막에 밑줄을 그을 방법이 없다(CSS Custom Highlight 도
 * textarea 안에는 닿지 않는다). 그래서 **같은 글자를 같은 자리에 투명하게** 한 벌 더 깔고, 링크 토막에만
 * 밑줄과 옅은 바탕을 칠한다. 입력칸은 바탕이 투명하므로 그 칠이 글자 밑에서 비친다.
 *
 * 맞춰야 하는 것 셋 — 어긋나면 밑줄이 엉뚱한 글자 밑에 그어진다.
 *  ① **글자 모양** — 글꼴·크기·줄 간격·안쪽 여백을 입력칸과 같은 클래스로 받는다(글꼴은 둘 다 카드에서 물려받는다).
 *  ② **줄바꿈** — `pre-wrap` + `break-word` 는 Chromium 이 textarea 에 주는 값과 같다. 폭은 입력칸의
 *    `clientWidth`(스크롤 막대를 뺀 폭)를 카드가 그때그때 적어 준다.
 *  ③ **스크롤** — 입력칸이 스크롤되면 카드가 이 층의 안쪽을 같은 만큼 민다(직접 쓰기 — React 를 거치지 않는다).
 *
 * 마지막 줄바꿈 뒤의 빈 줄도 높이를 갖게 폭 없는 공백을 하나 붙인다(textarea 는 그 줄을 그린다).
 * 클릭은 받지 않는다 — 글자를 고치는 것은 언제나 위의 입력칸이다.
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
