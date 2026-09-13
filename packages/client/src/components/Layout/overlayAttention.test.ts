/**
 * overlayAttention.test.ts — §5.5 #17-6 (H-16) **밖의 창을 불렀을 때의 대답.**
 *
 * (H-13) 이 "앱 안에서 IDE 를 여는 손짓 = 밖에 이미 서 있는 그 창을 앞으로 세우기" 로 길을 정한
 * 뒤에도, 그 창이 다른 프로그램 뒤에서 나오지 않는 경우가 있었다(사용자 보고). 앞세우기 자체는
 * main 이 고쳤고(`overlaySlot.test.ts`), 여기서는 **렌더러 쪽 계약** 둘을 못 박는다:
 *
 *   ① 이 창은 상시-위라 이미 보이고 있는 경우가 많다 — 그때 앞으로 오기만 하면 화면이 그대로여서
 *      누른 사람은 안 먹은 줄 안다. 그래서 그 손짓이 여기 닿았다고 **한 번 비춘다**.
 *   ② 그 기척은 클릭통과라야 한다 — 비추는 동안 창을 못 쓰면 부른 보람이 없다.
 *
 * 창을 띄우지 않고 소스로만 확인한다(클라 테스트에는 DOM 이 없다 — `vitest.config.ts`).
 */
import { describe, expect, it } from 'vitest';
import indexCss from 'virtual:vibisual-css-source/index';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const transport = import.meta.glob('../../transport/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(map: Record<string, string>, key: string): string {
  const found = map[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key}`);
  return found;
}

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

const shell = source(tsx, './OverlayShell.tsx');

describe('불렸다는 기척은 그 창이 스스로 비춘다', () => {
  it('main 이 밀어 주는 신호를 구독한다 — 없는 판(구버전 preload)에서는 조용히 지나간다', () => {
    const sub = block(shell, 'const [attention, setAttention] = useState(0);', 'const rfRef =');
    expect(sub).toContain('ov?.onAttention');
    // 선택 속성이라 없을 수 있다 — 없으면 앞세우기만 되고 기척은 빠진다(앞세우기가 본체다).
    expect(sub).toContain('if (!ov?.onAttention');
  });

  it('남의 기척을 대신 비추지 않는다 — 신호의 `agentId` 를 확인한다', () => {
    const sub = block(shell, 'const [attention, setAttention] = useState(0);', 'const rfRef =');
    expect(sub).toContain('if (payload.agentId !== agentId) return;');
  });

  it('연달아 불러도 매번 대답한다 — 번호를 올려 **새 원소**로 만든다', () => {
    // 같은 원소를 그대로 두면 React 가 갈아 끼우지 않아 CSS 애니메이션이 다시 돌지 않는다.
    const sub = block(shell, 'const [attention, setAttention] = useState(0);', 'const rfRef =');
    expect(sub).toContain('setAttention((n) => n + 1);');
    expect(shell).toContain('key={attention}');
  });

  it('IDE 로 서 있을 때만 비춘다 — 접힌 버블 창은 투명해서 두를 테두리가 없다', () => {
    const sub = block(shell, 'const [attention, setAttention] = useState(0);', 'const rfRef =');
    expect(sub).toContain('!expanded) return;');
    // 접히는 순간 정리가 함께 돌아 비추다 만 번호가 남지 않는다.
    expect(sub).toContain('setAttention(0);');
    expect(sub).toContain('}, [agentId, expanded]);');
  });

  it('클릭통과라 비추는 동안에도 창을 그대로 쓴다 — 그리고 끝나면 스스로 빠진다', () => {
    // `)}` 로 끊으면 `setAttention(0)}` 에서 먼저 잡힌다 — 원소가 닫히는 `/>` 까지 본다.
    const paint = block(shell, '{attention > 0 && (', '/>');
    expect(paint).toContain('pointer-events-none');
    expect(paint).toContain('animate-overlay-attention');
    // 남겨 두면 끝난 애니메이션을 단 원소가 창 위에 영영 얹혀 있다.
    expect(paint).toContain('onAnimationEnd={() => setAttention(0)}');
  });
});

describe('그 기척을 그리는 규칙은 CSS 에 있다', () => {
  it('`overlay-attention` 키프레임과 그것을 쓰는 utility 가 함께 있다', () => {
    expect(indexCss).toContain('@keyframes overlay-attention');
    expect(indexCss).toContain('@utility animate-overlay-attention');
  });

  it('0.5초 안에 끝난다 — 부른 창 위에 오래 얹혀 있으면 그 자체가 가림막이 된다', () => {
    const util = block(indexCss, '@utility animate-overlay-attention', '}');
    const dur = /animation:\s*overlay-attention\s+([\d.]+)s/.exec(util);
    expect(dur, '지속 시간을 못 찾음').not.toBeNull();
    expect(Number(dur?.[1])).toBeGreaterThan(0);
    expect(Number(dur?.[1])).toBeLessThanOrEqual(0.5);
  });

  it('transform/opacity 만 움직인다 — 레이아웃을 건드리면 IDE 전체가 다시 그려진다(§9)', () => {
    const frames = block(indexCss, '@keyframes overlay-attention', '\n}');
    for (const banned of ['width:', 'height:', 'top:', 'left:', 'margin', 'padding']) {
      expect(frames, banned).not.toContain(banned);
    }
  });
});

describe('통로는 선택 속성이다 — 구버전 preload 에서도 앱이 서야 한다', () => {
  it('`onAttention` 은 있어도 되고 없어도 되는 손잡이로 적혀 있다', () => {
    const api = source(transport, '../../transport/install-packaged-transport.ts');
    expect(api).toContain('onAttention?(cb: (payload: { agentId: string }) => void): () => void;');
  });
});
