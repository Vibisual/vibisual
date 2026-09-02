import { describe, it, expect } from 'vitest';

/**
 * §7.2 **세션 이름은 자기 칸을 넘지 않는다** — 그 이름이 곧 경로일 수 있기 때문이다.
 *
 * 패널의 세션 목록이 그리는 `SubAgent.label` 은 사용자가 지은 이름일 수도, 그 세션이 처음 받은
 * 프롬프트일 수도, **`C:\Users\…\MPS_Field_Interaction_UI_UE5_8_Something` 같은 절대경로**일 수도
 * 있다. 경로에는 띄어쓸 자리가 없어 브라우저가 줄을 나눌 지점을 찾지 못하고, 잘림 지정이 없으면
 * 글자가 부모 상자 밖으로 흘러 **옆 칸(상태·토큰·시각) 위에 겹쳐 그려진다.**
 * (신고 원문: "글자들이 각자 영역 안지키고 넘어가버려")
 *
 * 그래서 세션 이름을 그리는 자리는 **그 태그 자신이** 잘림/줄바꿈을 들고 있어야 한다.
 * 부모의 `min-w-0 flex-1` 은 넘침을 막지 못한다 — 그건 "줄어들 수 있다"는 허락일 뿐이고,
 * 잘림이 없으면 줄어든 상자 밖으로 글자가 그대로 흘러나온다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가
 * 타입체크에서 막힌다. 대신 `import.meta.glob(?raw)` 로 같은 파일들을 문자열로 받는다
 * (`typographyFloor.test.ts` 와 같은 수법).
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
