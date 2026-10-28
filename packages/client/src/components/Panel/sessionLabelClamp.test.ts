import { describe, it, expect } from 'vitest';

/**
 * §7.2 — 세션 이름(경로일 수 있어 줄을 못 나눈다)을 그리는 태그 자신이 잘림/줄바꿈을 든다 — 부모 `min-w-0 flex-1` 만으론 옆 칸 위로 넘친다.
 * `node:fs` 대신 `import.meta.glob(?raw)` — 클라 tsconfig 에 Node 타입이 없다.
 */

const panelSources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true });

/** 넘침을 실제로 막는 클래스 — 하나라도 있으면 통과. */
const CLAMP = /\btruncate\b|\bbreak-all\b|\bbreak-words\b|\bline-clamp-\d/;

/**
 * 세션 이름 출력 자리 — `{sub.label}` · `{sub?.label ?? …}` · `{idleSubs.find(…)?.label ?? …}`.
 * `sub`/`…Subs` 를 낀 것만 본다(`opt.label` · `cat.label` 같은 짧은 고정 낱말은 대상이 아니다).
 */
const SESSION_LABEL = /\{[^{}]*[Ss]ubs?\b[^{}]*\.label\b[^{}]*\}/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('패널 세션 이름 — 잘림 없이 그리면 옆 칸을 침범한다', () => {
  it('세션 이름을 그리는 태그는 모두 잘림/줄바꿈을 갖는다', () => {
    const violations: string[] = [];

    for (const [key, raw] of Object.entries(panelSources as Record<string, string>)) {
      const path = key.replace(/^\.\//, '');
      if (/\.test\.tsx?$/.test(path)) continue;

      for (const m of raw.matchAll(SESSION_LABEL)) {
        const at = m.index ?? 0;
        // `title={sub.label}` 같은 속성값은 화면에 글자를 그리지 않는다 — 툴팁이라 넘칠 것이 없다.
        if (raw[at - 1] === '=') continue;
        // 이 출력이 들어앉은 여는 태그. 잘림은 그 태그가 직접 들고 있어야 한다.
        const tagStart = raw.lastIndexOf('<', at);
        if (tagStart < 0) continue;
        const openTag = raw.slice(tagStart, at);
        if (CLAMP.test(openTag)) continue;
        violations.push(`${path}:${lineOf(raw, at)} — ${m[0].trim()}`);
      }
    }

    expect(violations, `세션 이름에 truncate(또는 break-words)가 없다:\n${violations.join('\n')}`).toEqual([]);
  });
});
