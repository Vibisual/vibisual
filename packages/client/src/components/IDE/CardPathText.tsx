import { memo, useMemo } from 'react';
import { splitCardTextPaths, type CardTextSegment } from './cardTextPaths.js';
import { PathLinkHandle, isPathLinkLive } from './PathLinkHandle.js';
import { usePathLinkRails } from './usePathLinkRails.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';

type CardPathSegment = Extract<CardTextSegment, { kind: 'path' }>;

/** 후보 하나 — 통째로 먼저, 없으면 조사를 뗀 경로로 판정한다. 디스크가 답하기 전·없으면 원래 글자 그대로다(⑬ (b)). */
const CardPathToken = memo(function CardPathToken({ segment, rootPath }: { segment: CardPathSegment; rootPath: string | null }): React.JSX.Element {
  const whole = usePathLinkRails(segment.candidate, rootPath);
  const trimmed = usePathLinkRails(segment.core?.candidate ?? null, rootPath);

  if (isPathLinkLive(whole)) {
    return <PathLinkHandle rails={whole} lines={segment.candidate?.lines ?? null} className="break-all">{segment.text}</PathLinkHandle>;
  }
  if (segment.core && isPathLinkLive(trimmed)) {
    return (
      <>
        <PathLinkHandle rails={trimmed} lines={segment.core.candidate.lines} className="break-all">{segment.core.text}</PathLinkHandle>
        {segment.core.tail}
      </>
    );
  }
  return <>{segment.text}</>;
});

/** §5.5 #17-27 ⑬ (l) — 카드 글자. 안에 적힌 파일·폴더 경로만 본문과 같은 손잡이가 되고 나머지는 평문 그대로다. */
export const CardPathText = memo(function CardPathText({ text }: { text: string }): React.JSX.Element {
  const rootPath = useIDEProjectRoot();
  const segments = useMemo(() => splitCardTextPaths(text, rootPath), [text, rootPath]);
  return (
    <span className="ide-card-path">
      {segments.map((segment, i) => (segment.kind === 'text'
        ? segment.text
        : <CardPathToken key={i} segment={segment} rootPath={rootPath} />))}
    </span>
  );
});
