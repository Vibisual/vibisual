/**
 * §5.5 #17-6 (H-28) — 떼어 낸 IDE 창 제목줄의 **[항상 위에 고정]** 버튼.
 *
 * 사용자 지시: "IDE창이 밖으로 나왔을 때 다른 앱을 선택하면 뒤로 가려지는데 안가려지고 다른 앱
 * 위에 있는거야". 층은 main 이 정하고(`overlayTopMostFor` — desktop 쪽 시험이 본다), 이 파일은
 * 렌더 쪽 약속만 못 박는다.
 *
 *  ① 버튼은 **떼어 낸 창(`fullWindow`)에만** 서고, preload 통로가 없으면(구버전) 서지 않는다.
 *     자리는 (H-18) [오버레이 버블로 바꾸기] 바로 뒤, [읽기 설정] 앞.
 *  ② 켜짐은 `aria-pressed` 로 말하고, 툴팁은 켜짐·꺼짐에 따라 누르면 일어날 일을 말한다.
 *  ③ 칠은 main 이 돌려준 값으로 맞춘다 — 누르는 즉시 바꾸되, 답이 오면 그 값을 믿고 실패하면
 *     되돌린다. 창이 IDE 로 설 때 한 번 물어, 접었다 편 창도 켜진 칠로 선다.
 *  ④ 문구 3키가 12 로케일에 다 있다.
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 컴포넌트는 소스 스캔으로 본다
 *   — `overlayCloseIntent.test.ts` 와 같은 계열의 집행이다.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob<string>(
  [
    '/src/components/IDE/AgentIDEOverlay.tsx',
    '/src/transport/install-packaged-transport.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const LOCALES = import.meta.glob<Record<string, unknown>>(
  '/src/i18n/locales/*.json',
  { import: 'default', eager: true },
);

function readSource(path: string): string {
  const src = SOURCES[path];
  expect(typeof src, path + ' 를 원문으로 못 읽었다 — 이 스캔의 전제가 깨졌다').toBe('string');
  expect((src ?? '').length, path + ' 가 빈 문자열로 왔다').toBeGreaterThan(0);
  return (src ?? '').replace(/\r\n/g, '\n');
}

function slice(text: string, startMarker: string, endMarker: string): string {
  const from = text.indexOf(startMarker);
  expect(from, '시작점을 못 찾았다: ' + startMarker).toBeGreaterThan(-1);
  const to = text.indexOf(endMarker, from);
  expect(to, '끝점을 못 찾았다: ' + endMarker).toBeGreaterThan(from);
  return text.slice(from, to + endMarker.length);
}

const OVERLAY = '/src/components/IDE/AgentIDEOverlay.tsx';
const BUTTON_OPEN = '{fullWindow && canPinOnTop && (';

describe('① 떼어 낸 창에만, 통로가 있을 때만 선다', () => {
  it('조건이 fullWindow 와 canPinOnTop 둘 다다 — 앱 안 창에는 "다른 앱 위"라는 뜻이 없다', () => {
    const src = readSource(OVERLAY);
    expect(src.split(BUTTON_OPEN)).toHaveLength(2);
    // 조건을 빼고 버튼만 따로 그리는 자리가 생기면 앱 안 창에도 선다.
    expect(src.match(/onClick=\{togglePinnedOnTop\}/g)).toHaveLength(1);
  });

  it('통로 유무는 preload 의 setPinnedSelf 로 가린다 — 구버전 preload 면 누를 것이 없다', () => {
    const src = readSource(OVERLAY);
    expect(src).toContain('const canPinOnTop = !!window.api?.overlay?.setPinnedSelf;');
  });

  it('자리는 (H-18) [오버레이 버블로 바꾸기] 바로 뒤, [읽기 설정] 앞', () => {
    const src = readSource(OVERLAY);
    const toBubble = src.indexOf('{fullWindow && !!onCollapseToBubble && (');
    const pin = src.indexOf(BUTTON_OPEN);
    const reading = src.indexOf('§5.5 읽기 설정 — 폭 안');
    expect(toBubble, '(H-18) 버튼을 못 찾았다').toBeGreaterThan(-1);
    expect(reading, '[읽기 설정] 자리를 못 찾았다').toBeGreaterThan(-1);
    expect(pin).toBeGreaterThan(toBubble);
    expect(pin).toBeLessThan(reading);
    // 사이에 다른 손잡이가 끼지 않는다 — (H-18) 블록이 끝나면 곧바로 이 버튼의 주석이다.
    const between = src.slice(src.indexOf('</button>', toBubble), pin);
    expect(between.match(/<button\b/g)).toBeNull();
  });
});

describe('② 켜짐을 말로도 알린다', () => {
  const button = () => slice(readSource(OVERLAY), BUTTON_OPEN, '</button>');

  it('aria-pressed 가 켜짐을 싣고, 이름은 하나, 툴팁은 상태마다 다르다', () => {
    const b = button();
    expect(b).toContain('aria-pressed={pinnedOnTop}');
    expect(b).toContain("aria-label={t('ide.overlay.pinOnTop')}");
    expect(b).toContain("title={pinnedOnTop ? t('ide.overlay.pinnedOnTopHint') : t('ide.overlay.pinOnTopHint')}");
  });

  it('아이콘은 stroke SVG 다 — 이모지 ❌, 색은 부모 글자색을 따른다', () => {
    const b = button();
    expect(b).toContain('<svg');
    expect(b).toContain('stroke="currentColor"');
    expect(b).toContain('fill="none"');
    expect(b).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('제목줄 끌기에 먹히지 않는다 — app-nodrag', () => {
    expect(button()).toContain('app-nodrag');
  });
});

describe('③ 칠은 main 이 기억한 값으로 맞춘다', () => {
  it('누르면 반대값을 멱등 set 으로 보내고, 돌아온 값을 믿고, 실패하면 되돌린다', () => {
    const cb = slice(readSource(OVERLAY), 'const togglePinnedOnTop = useCallback(', '}, [pinnedOnTop]);');
    expect(cb).toContain('const next = !pinnedOnTop;');
    expect(cb).toContain('setPinned(next)');
    expect(cb).toContain('.then((v) => setPinnedOnTop(v === true))');
    expect(cb).toContain('.catch(() => setPinnedOnTop(!next))');
  });

  it('창이 IDE 로 설 때 main 에 한 번 묻는다 — 접었다 편 창이 꺼진 칠로 서지 않게', () => {
    const effect = slice(
      readSource(OVERLAY),
      'const [pinnedOnTop, setPinnedOnTop] = useState(false);',
      '}, [fullWindow]);',
    );
    expect(effect).toContain('if (!fullWindow) return;');
    expect(effect).toContain('window.api?.overlay?.getPinnedSelf');
    expect(effect).toContain('if (alive) setPinnedOnTop(v === true);');
  });

  it('transport 타입이 두 통로를 선택적으로 싣는다 — 구버전 preload 에서도 타입이 거짓말하지 않게', () => {
    const transport = readSource('/src/transport/install-packaged-transport.ts');
    expect(transport).toContain('setPinnedSelf?(pinned: boolean): Promise<boolean>;');
    expect(transport).toContain('getPinnedSelf?(): Promise<boolean>;');
  });
});

describe('④ 문구 3키가 모든 로케일에 있다', () => {
  const KEYS = ['pinOnTop', 'pinOnTopHint', 'pinnedOnTopHint'] as const;

  function overlayOf(json: Record<string, unknown>): Record<string, unknown> {
    const ide = json.ide as Record<string, unknown> | undefined;
    return (ide?.overlay as Record<string, unknown> | undefined) ?? {};
  }

  const entries = Object.entries(LOCALES);
  const en = overlayOf(LOCALES['/src/i18n/locales/en.json'] ?? {});

  it('로케일 12개를 다 읽었다', () => {
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  it('비어 있지 않고, 켜짐·꺼짐 툴팁이 서로 다르다', () => {
    for (const [path, json] of entries) {
      const ov = overlayOf(json);
      for (const k of KEYS) {
        expect(typeof ov[k], `${path} ide.overlay.${k}`).toBe('string');
        expect(String(ov[k]).trim().length, `${path} ide.overlay.${k} 가 비었다`).toBeGreaterThan(0);
      }
      expect(ov.pinOnTopHint, `${path} 켜짐·꺼짐 툴팁이 같다`).not.toBe(ov.pinnedOnTopHint);
    }
  });

  it('en 이 아닌 로케일은 영어를 그대로 들고 있지 않다', () => {
    for (const [path, json] of entries) {
      if (path.endsWith('/en.json')) continue;
      const ov = overlayOf(json);
      for (const k of KEYS) expect(ov[k], `${path} ide.overlay.${k} 가 en 과 같다`).not.toBe(en[k]);
    }
  });
});
