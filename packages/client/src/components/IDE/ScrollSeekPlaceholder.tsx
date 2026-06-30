/**
 * StreamScrollSeekPlaceholder — react-virtuoso 의 빠른 스크롤(scrollSeek) 중 표시할 경량 자리표시자.
 *
 * 스크롤바 thumb 을 잡고 빠르게 끌면, 그 구간의 무거운 마크다운/도구 블록을 매 프레임 렌더하느라
 * 본문이 "한참 늦게 따라오는" 체감이 생긴다. 빠른 드래그 동안에는 실제 항목 대신 이 가벼운 스켈레톤
 * (높이만 정확히 예약)을 그려 thumb 이 즉시 따라오게 하고, 손을 놓아 속도가 떨어지면(exit) 그 자리에
 * 실제 본문이 채워진다. height 는 virtuoso 가 측정/추정한 그 항목 높이라 스크롤 총량이 흔들리지 않는다.
 */
import type React from 'react';

/** virtuoso `components.ScrollSeekPlaceholder` 가 넘기는 props 중 우리가 쓰는 height 만. */
interface ScrollSeekPlaceholderProps {
  height: number;
}

export function StreamScrollSeekPlaceholder({ height }: ScrollSeekPlaceholderProps): React.JSX.Element {
  // height 는 런타임 측정 픽셀값이라 Tailwind 임의값으로 표현 불가 → 동적 style 로 정확히 예약(코드베이스 관례).
  return (
    <div className="flex items-center px-4" style={{ height }}>
      <div className="h-2 w-full max-w-[55%] animate-pulse rounded bg-gray-800/70" />
    </div>
  );
}
