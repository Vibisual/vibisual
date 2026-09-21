import { describe, it, expect } from 'vitest';

/**
 * §6(조합 입력 보호) 규약의 **집행** — 앞으로 만들 "Enter 로 보내는 칸"도 자동으로 이 규칙에 들어온다.
 *
 * 전역 IME 가드(`inputComposition.ts`)는 조합 중 Enter 를 붙들어 앱 명령이 도는 것을 막는다.
 * 후보를 고르는 한 줄짜리 칸에서는 그게 맞다 — Enter 가 아무 일도 안 하고 글자만 확정된다.
 * 그러나 **여러 줄 칸에서 Enter 가 보내기**면 얘기가 반대가 된다: 명령만 막히고 브라우저 기본
 * 동작(줄바꿈)은 그대로 돌아, 한글·일본어·중국어 사용자에게는 **첫 Enter 가 늘 줄바꿈**이 된다
 * (마지막 글자는 거의 언제나 조합 중이므로). 실제 사용자 신고 지점이다.
 *
 * 그래서 그런 칸은 스스로 Enter 의 주인임을 밝히고(`IME_ENTER_OWNER`) 판정을 한 곳에 맡긴다
 * (`decideEnterKey` — 직접 `useEnterSubmit`). 규약 둘:
 *  ① `e.key === 'Enter' && !e.shiftKey` 를 손으로 다시 적지 않는다 — 판정은 `decideEnterKey` 하나다.
 *  ② `useEnterSubmit` 을 쓰는 파일은 그 입력칸에 `IME_ENTER_OWNER` 를 반드시 편다. 빠뜨리면
 *     가드가 Enter 를 먼저 붙들어 핸들러가 **아예 불리지 않고**, 증상은 고치기 전과 똑같다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없다
 * (`canvasControlsContract.test.ts` 와 같은 이유·같은 방식).
 */

const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** glob 키(이 파일=`src/utils/` 기준 상대 경로)를 src 기준 경로로 편다. */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `utils/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function sources(): { path: string; text: string }[] {
  return Object.entries(tsxSources as Record<string, string>)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('Enter 로 보내는 칸은 Enter 의 주인임을 밝힌다', () => {
  it('손으로 적은 `Enter && !shiftKey` 가 남아 있지 않다 — 판정은 decideEnterKey 하나', () => {
    const offenders = sources()
      .filter(({ text }) => /key\s*===\s*'Enter'\s*&&\s*!\w+\.shiftKey/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('useEnterSubmit 을 쓰면 그 입력칸에 IME_ENTER_OWNER 를 편다', () => {
    const missing = sources()
      .filter(({ text }) => text.includes('useEnterSubmit(') && !text.includes('{...IME_ENTER_OWNER}'))
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('IME_ENTER_OWNER 를 편 칸은 Enter 판정을 스스로 집행한다', () => {
    const missing = sources()
      .filter(({ text }) => text.includes('{...IME_ENTER_OWNER}'))
      .filter(({ text }) => !text.includes('useEnterSubmit(') && !text.includes('decideEnterKey('))
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('신고 지점(IDE 입력칸·댓글박스·명령센터·인라인 프롬프트)이 모두 규약 안에 있다', () => {
    const owners = sources()
      .filter(({ text }) => text.includes('{...IME_ENTER_OWNER}'))
      .map(({ path }) => path);
    expect(owners).toEqual(expect.arrayContaining([
      'components/BubbleMap/CommentBoxNode.tsx',
      'components/CommandCenter/CommandCenterCard.tsx',
      'components/CommandCenter/CommandCenterDetail.tsx',
      'components/IDE/IDEMainArea.tsx',
      'components/Panel/InlinePromptPopup.tsx',
    ]));
  });
});
