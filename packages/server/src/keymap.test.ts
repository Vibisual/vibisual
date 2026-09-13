import { describe, it, expect } from 'vitest';
import {
  COMMANDS,
  COMMAND_IDS,
  commandDef,
  parseBinding,
  formatBinding,
  normalizeBinding,
  expandBinding,
  matchesBinding,
  bindingFromEvent,
  keyTokenFromCode,
  scopeRelation,
  scopeChain,
  defaultKeymap,
  normalizeKeymapOverrides,
  resolveKeymap,
  inspectBinding,
  blocksAssignment,
  findKeymapConflicts,
  isCommandId,
  type CommandId,
  type KeyEventLike,
} from '@vibisual/shared';

/**
 * 단축키 SSOT(`shared/src/keymap.ts`)의 회귀 고정.
 *
 * 이 파일이 지키는 것은 셋이다.
 *  ① **mac 에서 ⌘ 로 눌린다** — 판정이 `ctrlKey` 만 보면 mac 사용자에게는 그 단축키가 아예 없다.
 *  ② **형제 스코프는 충돌이 아니다** — 이 규칙이 없으면 `Escape` 62곳이 전부 빨갛게 뜬다.
 *  ③ **자판 배열과 무관하다** — 독일어(QWERTZ) 자판에서도 같은 물리 키가 같은 명령이다.
 *
 * 실기(mac·linux)가 없으므로 플랫폼은 **인자로 받아** Windows 개발기에서 세 OS 를 전부 고정한다
 * ([docs/rules/multiplatform.md] 5축 — 단축키). shared 에는 러너가 없어 여기 server 쪽에 둔다
 * (`pathCase.test.ts` 와 같은 선례).
 */

/** 키 이벤트 흉내 — 진짜 `KeyboardEvent` 를 만들지 않고도 판정을 부를 수 있다. */
function ev(code: string, mods: Partial<Omit<KeyEventLike, 'code'>> = {}): KeyEventLike {
  return {
    code,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  };
}

describe('바인딩 파싱 · 표기', () => {
  it('모디파이어 순서가 달라도 같은 정규 표기로 접힌다', () => {
    expect(normalizeBinding('shift+ctrl+z')).toBe('Ctrl+Shift+Z');
    expect(normalizeBinding('Ctrl+Shift+Z')).toBe('Ctrl+Shift+Z');
    expect(normalizeBinding('CMD+SHIFT+Z')).toBe('Ctrl+Shift+Z');
  });

  it('`Control` 은 mod 로 접히지 않는다 — 뜻이 다른 키다', () => {
    const control = parseBinding('Control+Tab');
    expect(control).toEqual({ mod: false, control: true, alt: false, shift: false, key: 'Tab' });
    const mod = parseBinding('Ctrl+Tab');
    expect(mod).toEqual({ mod: true, control: false, alt: false, shift: false, key: 'Tab' });
    expect(formatBinding(control!)).toBe('Control+Tab');
  });

  it('끝에 붙은 `+` 는 키 자체다 — `Ctrl++` 를 쪼개지 않는다', () => {
    // NumpadAdd 토큰. 쪼개면 "모디파이어만 있고 키가 없는" 바인딩이 되어 통째로 버려진다.
    expect(parseBinding('Ctrl++')?.key).toBe('+');
  });

  it('모디파이어만 있으면 바인딩이 아니다', () => {
    expect(parseBinding('Ctrl')).toBeNull();
    expect(parseBinding('Ctrl+Shift')).toBeNull();
    expect(parseBinding('')).toBeNull();
    expect(parseBinding('  ')).toBeNull();
  });

  it('모르는 키 토큰은 버린다 — 지어내지 않는다', () => {
    expect(parseBinding('Ctrl+Frobnicate')).toBeNull();
    expect(normalizeBinding('Ctrl+F25')).toBeNull();
  });

  it('자리표는 실제 키들로 펼쳐진다', () => {
    expect(expandBinding('Alt+Digit')).toHaveLength(10);
    expect(expandBinding('Alt+Digit')).toContain('Alt+0');
    expect(expandBinding('Ctrl+Digit1To9')).toHaveLength(9);
    expect(expandBinding('Ctrl+Digit1To9')).not.toContain('Ctrl+0');
    expect(expandBinding('Ctrl+S')).toEqual(['Ctrl+S']);
  });
});

describe('키 이벤트 판정', () => {
  it('mod 는 세 OS 에서 각자의 키로 눌린다 — mac 은 ⌘', () => {
    // win/linux: Ctrl
    expect(matchesBinding(ev('KeyC', { ctrlKey: true }), 'Ctrl+C')).toBe(true);
    // mac: ⌘(metaKey). 이 줄이 깨지면 mac 사용자에게는 그 단축키가 아예 없는 것이다.
    expect(matchesBinding(ev('KeyC', { metaKey: true }), 'Ctrl+C')).toBe(true);
    // 아무 모디파이어도 없으면 아니다.
    expect(matchesBinding(ev('KeyC'), 'Ctrl+C')).toBe(false);
  });

  it('`Control` 자리는 mac 에서도 진짜 Control 이다', () => {
    expect(matchesBinding(ev('Tab', { ctrlKey: true }), 'Control+Tab')).toBe(true);
    // ⌘Tab 은 macOS 앱 전환이라 우리 것이 아니다.
    expect(matchesBinding(ev('Tab', { metaKey: true }), 'Control+Tab')).toBe(false);
    // ⌃⌘Tab 처럼 둘이 함께 눌린 것도 다른 손짓이다.
    expect(matchesBinding(ev('Tab', { ctrlKey: true, metaKey: true }), 'Control+Tab')).toBe(false);
  });

  it('모디파이어는 정확히 일치해야 한다 — 두 단축키가 한 손짓에 함께 발동하면 안 된다', () => {
    expect(matchesBinding(ev('KeyC', { ctrlKey: true, shiftKey: true }), 'Ctrl+C')).toBe(false);
    expect(matchesBinding(ev('KeyC', { ctrlKey: true, altKey: true }), 'Ctrl+C')).toBe(false);
    expect(matchesBinding(ev('KeyC', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+C')).toBe(true);
  });

  it('자판 배열과 무관하다 — 물리 키(`code`)로 판정한다', () => {
    // QWERTZ 에서 `KeyZ` 물리 위치는 그대로다(새겨진 글자만 다르다).
    expect(matchesBinding(ev('KeyZ', { ctrlKey: true }), 'Ctrl+Z')).toBe(true);
    // 숫자패드도 같은 숫자로 받는다.
    expect(matchesBinding(ev('Numpad3', { altKey: true }), 'Alt+Digit')).toBe(true);
    expect(matchesBinding(ev('Digit3', { altKey: true }), 'Alt+Digit')).toBe(true);
  });

  it('자리표 밖의 키는 받지 않는다', () => {
    expect(matchesBinding(ev('Digit0', { ctrlKey: true }), 'Ctrl+Digit1To9')).toBe(false);
    expect(matchesBinding(ev('Digit9', { ctrlKey: true }), 'Ctrl+Digit1To9')).toBe(true);
  });

  it('모디파이어 없는 바인딩은 Ctrl 이 눌린 상태를 가로채지 않는다', () => {
    expect(matchesBinding(ev('Digit3'), 'Digit')).toBe(true);
    expect(matchesBinding(ev('Digit3', { ctrlKey: true }), 'Digit')).toBe(false);
  });

  it('모르는 물리 키는 토큰이 없다', () => {
    expect(keyTokenFromCode('Unidentified')).toBeNull();
    expect(keyTokenFromCode('KeyA')).toBe('A');
    expect(keyTokenFromCode('F12')).toBe('F12');
    expect(keyTokenFromCode('ArrowLeft')).toBe('Left');
  });
});

describe('눌린 조합 잡기(캡처 모드)', () => {
  it('win/linux 의 Ctrl 은 mod 로 잡힌다', () => {
    expect(bindingFromEvent(ev('KeyS', { ctrlKey: true }), 'win32')).toBe('Ctrl+S');
    expect(bindingFromEvent(ev('KeyS', { ctrlKey: true }), 'linux')).toBe('Ctrl+S');
  });

  it('mac 은 ⌘ 가 mod, ⌃ 는 Control 로 갈린다', () => {
    expect(bindingFromEvent(ev('KeyS', { metaKey: true }), 'darwin')).toBe('Ctrl+S');
    expect(bindingFromEvent(ev('Tab', { ctrlKey: true }), 'darwin')).toBe('Control+Tab');
  });

  it('모디파이어만 눌렀으면 아직 조합이 아니다', () => {
    expect(bindingFromEvent(ev('ControlLeft', { ctrlKey: true }), 'win32')).toBeNull();
    expect(bindingFromEvent(ev('ShiftLeft', { shiftKey: true }), 'win32')).toBeNull();
  });
});

describe('스코프 트리', () => {
  it('조상 사슬은 global 에서 끝난다', () => {
    expect(scopeChain('editor')).toEqual(['editor', 'ide', 'global']);
    expect(scopeChain('global')).toEqual(['global']);
  });

  it('형제는 부딪히지 않는다 — 이 규칙이 오탐의 대부분을 없앤다', () => {
    expect(scopeRelation('editor', 'terminal')).toBe('none');
    expect(scopeRelation('canvas', 'ide')).toBe('none');
    expect(scopeRelation('canvas', 'dialog')).toBe('none');
  });

  it('조상-자손은 가림이다', () => {
    expect(scopeRelation('editor', 'ide')).toBe('ancestor');
    expect(scopeRelation('global', 'terminal')).toBe('ancestor');
    expect(scopeRelation('ide', 'ide')).toBe('same');
  });
});

describe('명령 표', () => {
  it('기본 바인딩은 전부 읽을 수 있는 모양이다', () => {
    for (const id of COMMAND_IDS) {
      // `as const satisfies` 라 리터럴 타입이다 — 빈 기본값(붙일 수 있는 빈 자리)도 허용하므로
      // 폭을 넓혀 받는다.
      const binding: string = COMMANDS[id].defaultBinding;
      if (binding.length === 0) continue;
      expect(normalizeBinding(binding), `${id} 의 기본 바인딩 '${binding}'`).toBe(binding);
    }
  });

  it('기본 키맵에는 충돌이 없다 — 세 OS 모두', () => {
    const resolved = resolveKeymap({});
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const conflicts = findKeymapConflicts(resolved, platform);
      expect(conflicts, `${platform} 기본 키맵 충돌`).toEqual([]);
    }
  });

  it('모르는 식별자는 명령이 아니다', () => {
    expect(isCommandId('canvas.copy')).toBe(true);
    expect(isCommandId('nope.nope')).toBe(false);
  });
});

describe('사용자 덮어쓰기', () => {
  it('모르는 명령·못 읽는 바인딩은 버린다', () => {
    const out = normalizeKeymapOverrides({
      'canvas.copy': 'ctrl+shift+c',
      'nope.nope': 'Ctrl+X',
      'canvas.paste': 'Ctrl+Frobnicate',
      'ide.tabNext': 123,
    });
    expect(out).toEqual({ 'canvas.copy': 'Ctrl+Shift+C' });
  });

  it('기본값과 같은 값은 저장하지 않는다 — 기본값이 바뀌면 따라가야 한다', () => {
    const out = normalizeKeymapOverrides({ 'canvas.copy': 'ctrl+c' });
    expect(out).toEqual({});
  });

  it('`null` 은 해제다 — 키 삭제(기본값 복귀)와 다른 뜻이다', () => {
    expect(normalizeKeymapOverrides({ 'canvas.copy': null })).toEqual({ 'canvas.copy': null });
    expect(resolveKeymap({ 'canvas.copy': null })['canvas.copy']).toBeNull();
    expect(resolveKeymap({})['canvas.copy']).toBe(COMMANDS['canvas.copy'].defaultBinding);
  });

  it('배열·null 을 통째로 받아도 터지지 않는다', () => {
    expect(normalizeKeymapOverrides(null)).toEqual({});
    expect(normalizeKeymapOverrides(['Ctrl+C'])).toEqual({});
    expect(normalizeKeymapOverrides('Ctrl+C')).toEqual({});
  });

  it('기본 키맵은 표 전체를 덮는다', () => {
    expect(Object.keys(defaultKeymap()).sort()).toEqual([...COMMAND_IDS].sort());
  });
});

describe('충돌 판정', () => {
  const base = resolveKeymap({});

  it('같은 스코프의 같은 조합은 확정을 막는다', () => {
    const issues = inspectBinding('canvas.paste', 'Ctrl+C', base, 'win32');
    const conflict = issues.find((i) => i.kind === 'conflict');
    expect(conflict?.with).toEqual(['canvas.copy']);
    expect(blocksAssignment(issues)).toBe(true);
  });

  it('형제 스코프의 같은 조합은 통과한다', () => {
    // `ide.tabNext` 를 캔버스 복사와 같은 조합으로 줘도 스코프가 형제라 부딪히지 않는다.
    const issues = inspectBinding('ide.tabNext', 'Ctrl+C', base, 'win32');
    expect(issues.some((i) => i.kind === 'conflict')).toBe(false);
    expect(blocksAssignment(issues)).toBe(false);
  });

  it('조상을 가리면 경고만 하고 막지는 않는다', () => {
    const resolved = { ...base, 'global.shortcutOverlay': 'Ctrl+K' } as Record<CommandId, string | null>;
    const issues = inspectBinding('ide.tabNext', 'Ctrl+K', resolved, 'win32');
    expect(issues.find((i) => i.kind === 'shadow')?.with).toEqual(['global.shortcutOverlay']);
    expect(blocksAssignment(issues)).toBe(false);
  });

  it('OS 예약은 OS 마다 다르게 막는다', () => {
    // ⌘Q 는 mac 종료라 mac 에서만 막힌다.
    expect(blocksAssignment(inspectBinding('canvas.copy', 'Ctrl+Q', base, 'darwin'))).toBe(true);
    expect(blocksAssignment(inspectBinding('canvas.copy', 'Ctrl+Q', base, 'win32'))).toBe(false);
    // Alt+F4 는 win/linux 창 닫기.
    expect(blocksAssignment(inspectBinding('canvas.copy', 'Alt+F4', base, 'win32'))).toBe(true);
    expect(blocksAssignment(inspectBinding('canvas.copy', 'Alt+F4', base, 'linux'))).toBe(true);
    expect(blocksAssignment(inspectBinding('canvas.copy', 'Alt+F4', base, 'darwin'))).toBe(false);
  });

  it('자리표가 예약 조합을 삼켜도 잡힌다', () => {
    // mac 의 ⌘⇧3/4/5 는 화면 캡처다 — `Ctrl+Shift+Digit` 는 그 셋을 통째로 먹는다.
    const issues = inspectBinding('bookmark.assign', 'Ctrl+Shift+Digit', base, 'darwin');
    expect(issues.some((i) => i.kind === 'os-reserved')).toBe(true);
  });

  it('모디파이어 없는 조합은 타이핑 위험으로 알린다 — 막지는 않는다', () => {
    const issues = inspectBinding('bookmark.jump', 'Digit', base, 'win32');
    expect(issues.some((i) => i.kind === 'typing-risk')).toBe(true);
    expect(blocksAssignment(issues)).toBe(false);
  });

  it('해제된 명령은 아무와도 부딪히지 않는다', () => {
    const resolved = { ...base, 'canvas.copy': null } as Record<CommandId, string | null>;
    const issues = inspectBinding('canvas.paste', 'Ctrl+C', resolved, 'win32');
    expect(issues.some((i) => i.kind === 'conflict')).toBe(false);
  });

  it('자기 자신과는 부딪히지 않는다', () => {
    const issues = inspectBinding('canvas.copy', 'Ctrl+C', base, 'win32');
    expect(issues.some((i) => i.kind === 'conflict')).toBe(false);
  });
});

describe('스코프가 요구하는 성질 — 이걸 어기면 그 자리에서 아예 안 듣는다', () => {
  it('터미널·편집기 명령은 전부 typingSafe 다', () => {
    // 터미널(xterm 보조 textarea)과 코드 편집창은 **포커스가 있으면 항상 "타이핑 중"** 이다.
    //   그래서 `typingSafe` 가 아니면 디스패처가 걸러내 정작 그 자리에서 하나도 안 듣는다.
    const bad = COMMAND_IDS
      .filter((id) => COMMANDS[id].scope === 'terminal' || COMMANDS[id].scope === 'editor')
      .filter((id) => commandDef(id).typingSafe !== true);
    expect(bad, `타이핑 중에 죽는 명령: ${bad.join(', ')}`).toEqual([]);
  });

  it('창 배치(Ctrl+Alt) 는 typingSafe 가 아니다 — AltGr 자판의 입력을 가로챈다', () => {
    // 일부 유럽 자판에서 AltGr = Ctrl+Alt 다. 이 묶음이 입력칸에서도 살면 글자를 못 친다.
    const placement: CommandId[] = [
      'ide.dockLeft', 'ide.dockRight', 'ide.dockTop', 'ide.dockBottom',
      'ide.toggleMaximize', 'ide.undock', 'ide.nextWindow',
    ];
    for (const id of placement) {
      expect(commandDef(id).typingSafe, `${id} 가 타이핑 중에도 산다`).not.toBe(true);
      expect(commandDef(id).defaultBinding).toMatch(/^Ctrl\+Alt\+/);
    }
  });

  it('모든 명령이 파싱되는 기본 바인딩을 갖는다 — 못 읽는 값은 영영 안 눌린다', () => {
    const broken = COMMAND_IDS.filter((id) => normalizeBinding(COMMANDS[id].defaultBinding) === null);
    expect(broken, `기본 바인딩을 못 읽는 명령: ${broken.join(', ')}`).toEqual([]);
  });

  it('터미널의 Ctrl+C 는 캔버스 복사와 형제라 부딪히지 않는다', () => {
    // 같은 조합이라도 스코프가 형제면 충돌이 아니다 — 이 규칙이 없으면 판정이 무의미해진다.
    const resolved = defaultKeymap() as Record<CommandId, string | null>;
    const issues = inspectBinding('terminal.copyOrPass', 'Ctrl+C', resolved, 'win32');
    expect(issues.some((i) => i.kind === 'conflict')).toBe(false);
  });

  it('IDE 의 Ctrl+1~9 를 터미널이 같은 키로 가리면 shadow 로 알린다', () => {
    const resolved = defaultKeymap() as Record<CommandId, string | null>;
    const issues = inspectBinding('terminal.find', 'Ctrl+1', resolved, 'win32');
    expect(issues.some((i) => i.kind === 'shadow')).toBe(true);
    expect(blocksAssignment(issues)).toBe(false);
  });
});
