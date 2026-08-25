import { describe, it, expect } from 'vitest';
import {
  CMD_PANE_MAX,
  CMD_PANE_RATIO_MAX,
  CMD_PANE_RATIO_MIN,
  closeCmdPane,
  cmdPaneTermId,
  collectCmdPaneIds,
  resolveCmdCliKind,
  sanitizeCmdPaneTree,
  splitCmdPane,
  clampTerminalScrollback,
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_SCROLLBACK_MIN,
  TERMINAL_SCROLLBACK_MAX,
  type CmdPaneNode,
} from '@vibisual/shared';

// §4 (CMD 터미널 업그레이드 ⑤⑧) — pane 트리 편집·정합과 CLI 표.
//
// 이 트리는 체크포인트에 실려 **다음 부팅에도 살아 돌아온다**. 그래서 "옛 파일·손댄 REST body 를
// 그대로 믿지 않는다"가 여기서 가장 중요한 계약이다 — 깨진 트리 하나가 CMD 탭 전체를 못 열게 한다.

describe('cmdPaneTermId', () => {
  it("pane '0' 은 접미사가 없다 — 기존 termId·resume 키와 바이트 단위로 같아야 한다", () => {
    expect(cmdPaneTermId('term:agent-1:sub-9', '0')).toBe('term:agent-1:sub-9');
  });

  it('분할된 pane 은 # 로 구분한다(: 를 쓰면 소유 세션 해석이 깨진다)', () => {
    expect(cmdPaneTermId('term:agent-1:sub-9', '2')).toBe('term:agent-1:sub-9#2');
  });
});

describe('splitCmdPane / closeCmdPane', () => {
  it('단일 pane 을 쪼개면 이진 split 이 된다', () => {
    const tree = splitCmdPane(null, '0', '1', 'row');
    expect(tree.type).toBe('split');
    expect(collectCmdPaneIds(tree)).toEqual(['0', '1']);
  });

  it('중첩 분할도 왼쪽/위 순서를 유지한다', () => {
    let tree: CmdPaneNode = splitCmdPane(null, '0', '1', 'row');
    tree = splitCmdPane(tree, '1', '2', 'column');
    expect(collectCmdPaneIds(tree)).toEqual(['0', '1', '2']);
  });

  it('pane 을 닫으면 형제가 그 자리를 물려받는다', () => {
    let tree: CmdPaneNode | null = splitCmdPane(null, '0', '1', 'row');
    tree = splitCmdPane(tree, '1', '2', 'column');
    tree = closeCmdPane(tree, '1');
    expect(collectCmdPaneIds(tree)).toEqual(['0', '2']);
  });

  it('마지막 하나까지 닫으면 단일 pane(null)로 되돌아간다', () => {
    const tree = splitCmdPane(null, '0', '1', 'row');
    expect(closeCmdPane(tree, '1')).toBeNull();
  });

  it('없는 pane 을 지정하면 트리를 바꾸지 않는다', () => {
    const tree = splitCmdPane(null, '0', '1', 'row');
    expect(collectCmdPaneIds(splitCmdPane(tree, 'nope', '9', 'row'))).toEqual(['0', '1']);
  });
});

describe('sanitizeCmdPaneTree', () => {
  it('비율을 허용 범위로 clamp 한다', () => {
    const out = sanitizeCmdPaneTree({
      type: 'split', dir: 'row', ratio: 0.99,
      children: [{ type: 'leaf', id: '0' }, { type: 'leaf', id: '1' }],
    });
    expect(out?.type).toBe('split');
    if (out?.type === 'split') expect(out.ratio).toBeLessThanOrEqual(CMD_PANE_RATIO_MAX);

    const low = sanitizeCmdPaneTree({
      type: 'split', dir: 'column', ratio: -5,
      children: [{ type: 'leaf', id: '0' }, { type: 'leaf', id: '1' }],
    });
    if (low?.type === 'split') expect(low.ratio).toBeGreaterThanOrEqual(CMD_PANE_RATIO_MIN);
  });

  it('중복 pane id 를 거부한다 — 같은 PTY 를 두 xterm 이 다투면 화면이 깨진다', () => {
    expect(sanitizeCmdPaneTree({
      type: 'split', dir: 'row', ratio: 0.5,
      children: [{ type: 'leaf', id: '7' }, { type: 'leaf', id: '7' }],
    })).toBeNull();
  });

  it('상한을 넘는 pane 개수를 거부한다', () => {
    let tree: CmdPaneNode = { type: 'leaf', id: '0' };
    for (let i = 1; i <= CMD_PANE_MAX + 2; i += 1) tree = splitCmdPane(tree, String(i - 1), String(i), 'row');
    expect(sanitizeCmdPaneTree(tree)).toBeNull();
  });

  it('형태가 어긋난 입력은 단일 pane(null)으로 떨어뜨린다', () => {
    expect(sanitizeCmdPaneTree(null)).toBeNull();
    expect(sanitizeCmdPaneTree('nope')).toBeNull();
    expect(sanitizeCmdPaneTree({ type: 'split', dir: 'row', ratio: 0.5, children: [{ type: 'leaf', id: '0' }] })).toBeNull();
    expect(sanitizeCmdPaneTree({ type: 'leaf', id: 'bad id!' })).toBeNull();
  });

  it("잎 하나뿐인 트리는 단일 pane 표현(null)으로 모은다", () => {
    expect(sanitizeCmdPaneTree({ type: 'leaf', id: '0' })).toBeNull();
  });

  it('정상 트리는 그대로 통과한다', () => {
    const tree = splitCmdPane(null, '0', '1', 'row');
    expect(collectCmdPaneIds(sanitizeCmdPaneTree(tree))).toEqual(['0', '1']);
  });
});

describe('resolveCmdCliKind', () => {
  it('미지 값·undefined 는 claude(기본) 행으로 떨어진다 — 종전 동작 보존', () => {
    expect(resolveCmdCliKind(undefined).value).toBe('claude');
    expect(resolveCmdCliKind('nope').value).toBe('claude');
  });

  it('claude 만 managed 다 — 나머지는 우리 훅의 자식이 아니다', () => {
    expect(resolveCmdCliKind('claude').managed).toBe(true);
    expect(resolveCmdCliKind('codex').managed).toBe(false);
    expect(resolveCmdCliKind('shell').bin).toBe('');
  });
});

describe('clampTerminalScrollback', () => {
  it('미설정·비정상 값은 기본값으로', () => {
    expect(clampTerminalScrollback(undefined)).toBe(TERMINAL_SCROLLBACK_LINES);
    expect(clampTerminalScrollback('x')).toBe(TERMINAL_SCROLLBACK_LINES);
    expect(clampTerminalScrollback(Number.NaN)).toBe(TERMINAL_SCROLLBACK_LINES);
  });

  it('범위를 벗어나면 clamp — 무한정 커지지 않게(§3.2.3)', () => {
    expect(clampTerminalScrollback(1)).toBe(TERMINAL_SCROLLBACK_MIN);
    expect(clampTerminalScrollback(10_000_000)).toBe(TERMINAL_SCROLLBACK_MAX);
  });
});
