/**
 * commandRegistryContract.test.ts — **표에 있는 단축키는 반드시 듣는 곳이 있다.**
 *
 * §5.4 #32 의 규약은 한 줄이다: *"핸들러가 이 표를 보지 않는 명령은 넣지 마라."* 어기면
 * 사용자가 설정에서 키를 바꿔도 아무 일이 일어나지 않는 **읽히지 않는 설정 스위치**가 된다 —
 * 화면은 바뀌었는데 동작은 그대로인 그 결함이다. 사람이 지킬 수 있는 규약이 아니라서 여기서 못 박는다.
 *
 * 함께 막는 것 셋 —
 *  ① 이관한 파일이 옛 `window.addEventListener('keydown')` 을 도로 들이는 것(두 벌이 되면 재매핑이
 *     한쪽에만 반영돼 "설정은 바뀌었는데 그 화면만 옛 키"가 된다),
 *  ② 명령 이름·보충 설명의 번역 키가 `en.json` 에 없는 것(그러면 화면에 키 문자열이 그대로 뜬다),
 *  ③ 번역문에 단축키를 박는 것(mac 에서 영영 `Ctrl+…` 로 뜬다 — §i18n).
 *
 * ⚠ 클라 vitest 에는 DOM 도 `node:fs` 도 없다. 소스 훑기는 `import.meta.glob('?raw')` 으로 하고,
 * glob 이 비면 검사가 **조용히 통과**하므로 "실제로 읽어 왔다"를 먼저 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import { COMMAND_IDS, COMMANDS, commandDef } from '@vibisual/shared';
import en from '../i18n/locales/en.json';

const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 이관을 끝낸 파일 — 여기서 다시 `keydown` 을 직접 걸면 두 벌이 된다. */
const MIGRATED = [
  'useBookmarks.ts',
  'useCanvasClipboard.ts',
  'IDETabBar.tsx',
  'IDETerminalView.tsx',
  'CodeEditor.tsx',
];

/**
 * 파일 이름으로 소스를 꺼낸다.
 *
 * glob 키는 이 테스트 파일 기준 상대경로라 **같은 폴더는 `./`, 다른 폴더는 `../`** 로 시작한다
 * (`./useBookmarks.ts` vs `../components/IDE/CodeEditor.tsx`). 그래서 경로가 아니라 파일 이름으로
 * 찾고, 같은 이름이 둘이면 검사가 엉뚱한 파일을 볼 수 있으므로 그것도 함께 막는다.
 */
const read = (name: string): string => {
  const hits = Object.entries(SOURCES).filter(([p]) => p.endsWith(`/${name}`));
  if (hits.length !== 1) throw new Error(`소스 ${name} 을 ${hits.length}개 찾았다(1개여야 한다)`);
  return hits[0]![1];
};

const readKey = (dotted: string): unknown =>
  dotted.split('.').reduce<unknown>(
    (node, k) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[k] : undefined),
    en,
  );

describe('단축키 레지스트리 규약', () => {
  it('소스를 실제로 읽어 왔다 — glob 이 비면 아래 검사가 전부 헛통과한다', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  it('표에 있는 모든 명령을 어딘가에서 `useCommand` 로 듣는다', () => {
    const all = Object.values(SOURCES).join('\n');
    const unheard = COMMAND_IDS.filter((id) => !all.includes(`useCommand('${id}'`));
    expect(
      unheard,
      `듣는 곳이 없는 명령(재매핑해도 아무 일이 없다): ${unheard.join(', ')}`,
    ).toEqual([]);
  });

  it('이관한 파일이 모디파이어 조합을 직접 판정하지 않는다', () => {
    // `Escape` 로 팝업을 닫는 리스너는 남아 있어도 된다 — 여러 화면이 각자 자기 것을 닫으므로
    //   레지스트리 명령이 아니고, 표에 넣으면 "바꿀 수 있다"고 거짓말하는 스위치가 된다.
    //   막아야 하는 것은 **모디파이어 조합을 직접 보는** 자리다(그게 레지스트리의 소관이다).
    const offenders = MIGRATED.filter((f) => /e\.(ctrlKey|metaKey|altKey)/.test(read(f)));
    expect(
      offenders,
      `이관 파일이 조합을 직접 판정한다(레지스트리와 두 벌이 된다): ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('명령 이름·보충 설명의 번역 키가 en.json 에 있다', () => {
    const missing: string[] = [];
    for (const id of COMMAND_IDS) {
      const def = commandDef(id);
      if (typeof readKey(def.labelKey) !== 'string') missing.push(def.labelKey);
      if (def.hintKey && typeof readKey(def.hintKey) !== 'string') missing.push(def.hintKey);
    }
    expect(missing, `en.json 에 없는 키: ${missing.join(', ')}`).toEqual([]);
  });

  it('스코프 이름·설명의 번역 키가 en.json 에 있다', () => {
    const scopes = [...new Set(COMMAND_IDS.map((id) => COMMANDS[id].scope))];
    const missing = scopes.flatMap((s) =>
      [`common.shortcuts.scope.${s}`, `common.shortcuts.scopeDesc.${s}`]
        .filter((k) => typeof readKey(k) !== 'string'));
    expect(missing, `en.json 에 없는 스코프 키: ${missing.join(', ')}`).toEqual([]);
  });

  it('명령 이름 번역문에 단축키를 박지 않는다 — mac 에서 영영 어긋난다', () => {
    const bad: string[] = [];
    for (const id of COMMAND_IDS) {
      const def = commandDef(id);
      for (const key of [def.labelKey, def.hintKey].filter((k): k is string => !!k)) {
        const text = readKey(key);
        if (typeof text === 'string' && /Ctrl\s*\+|Cmd\s*\+|⌘/.test(text)) bad.push(key);
      }
    }
    expect(bad, `번역문에 단축키가 박혀 있다: ${bad.join(', ')}`).toEqual([]);
  });

  it('번역 키는 고정 네임스페이스(`common.`) 안에 있다 — 최상위를 늘리지 않는다', () => {
    const outside = COMMAND_IDS
      .map((id) => COMMANDS[id].labelKey)
      .filter((k) => !k.startsWith('common.shortcuts.'));
    expect(outside, `네임스페이스 밖 키: ${outside.join(', ')}`).toEqual([]);
  });
});
