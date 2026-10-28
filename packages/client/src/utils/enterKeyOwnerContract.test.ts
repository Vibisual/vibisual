import { describe, it, expect } from 'vitest';

/**
 * §6(조합 입력 보호) 규약의 집행 — 앞으로 만들 "Enter 로 보내는 칸"도 자동으로 이 규칙에 들어온다.
 * 전역 IME 가드(`inputComposition.ts`)는 조합 중 Enter 를 붙드는데, 여러 줄 칸에서 Enter 가 보내기면 명령만 막히고 기본 줄바꿈은 돌아 CJK 입력자의 첫 Enter 가 늘 줄바꿈이 된다(Ctrl/Cmd+Enter 칸도 같다 — Chromium 은 textarea 안의 Ctrl+Enter 를 InsertNewline 으로 옮긴다).
 * 그래서 그런 칸은 `IME_ENTER_OWNER` 로 Enter 의 주인임을 밝히고 판정을 `decideEnterKey`(훅 `useEnterSubmit` · JSX 의 `runEnterKey`)에 맡긴다.
 * 규약: ① Enter 조건(`!e.shiftKey` · `ctrlKey || metaKey`)을 손으로 적지 않는다 ② Enter 를 집행하는 파일은 입력칸에 `IME_ENTER_OWNER` 를 편다(빠지면 핸들러가 아예 안 불린다) ③ `IME_ENTER_OWNER` 만 펴고 판정을 안 하면 기본 줄바꿈이 남는다.
 * `node:fs` ❌ — 클라 tsconfig 에 Node 타입이 없다(`canvasControlsContract.test.ts` 와 같다).
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

/** Enter 판정을 스스로 집행하는가(훅·직접 호출·순수 함수 어느 쪽이든). */
const ENFORCES = /useEnterSubmit\(|runEnterKey\(|decideEnterKey\(/;

describe('Enter 로 보내는 칸은 Enter 의 주인임을 밝힌다', () => {
  it('손으로 적은 `Enter && !shiftKey` 가 남아 있지 않다 — 판정은 decideEnterKey 하나', () => {
    const offenders = sources()
      .filter(({ text }) => /key\s*===\s*'Enter'\s*&&\s*!\w+\.shiftKey/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('손으로 적은 `Enter && (ctrlKey || metaKey)` 도 남아 있지 않다 — 같은 결함이다', () => {
    const offenders = sources()
      .filter(({ text }) => /key\s*===\s*'Enter'\s*&&\s*\(?\s*\w+\.(ctrlKey|metaKey)/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('칸의 keydown 에서 Enter 를 집행하면 그 칸에 IME_ENTER_OWNER 를 편다', () => {
    const missing = sources()
      // 창 전체 단축키(window keydown)는 임자가 될 칸이 없다 — 표시할 자리도 없다.
      .filter(({ text }) => text.includes('onKeyDown'))
      .filter(({ text }) => ENFORCES.test(text) && !text.includes('{...IME_ENTER_OWNER}'))
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('IME_ENTER_OWNER 를 편 칸은 Enter 판정을 스스로 집행한다', () => {
    const missing = sources()
      .filter(({ text }) => text.includes('{...IME_ENTER_OWNER}'))
      .filter(({ text }) => !ENFORCES.test(text))
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('신고 지점(IDE 입력칸)과 같은 부류의 칸이 모두 규약 안에 있다', () => {
    const owners = sources()
      .filter(({ text }) => text.includes('{...IME_ENTER_OWNER}'))
      .map(({ path }) => path);
    expect(owners).toEqual(expect.arrayContaining([
      // Enter = 보내기
      'components/BubbleMap/CommentBoxNode.tsx',
      'components/CommandCenter/CommandCenterCard.tsx',
      'components/CommandCenter/CommandCenterDetail.tsx',
      'components/IDE/IDEMainArea.tsx',
      'components/Panel/InlinePromptPopup.tsx',
      // Ctrl/Cmd+Enter = 보내기 (Chromium 이 textarea 안에서 줄바꿈으로 옮기는 자리)
      'components/BubbleMap/TaskEdgePopup.tsx',
      'components/IDE/DiffView.tsx',
      'components/Panel/AutoAgentPanel.tsx',
      'components/Panel/CommandQueue.tsx',
      'components/Panel/ContiBoardPanel.tsx',
      'components/Preview/PreviewControls.tsx',
    ]));
  });
});
