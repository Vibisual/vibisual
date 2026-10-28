import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedEngineStatus } from '@vibisual/shared';
import { EngineBinPicker, ManagedPendingNotice, type EngineBinRow } from './EngineBinPicker.js';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> & { defaultValue?: string }) => {
      let text = options?.defaultValue ?? key;
      for (const [k, v] of Object.entries(options ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
    i18n: { language: 'en' },
  }),
}));

/** §4 (앱 전용 엔진) ④⑨ — "기본 = 앱 전용, 나머지 = 보조"가 화면 구조에서 보여야 한다. */

let view: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
});

const managedStatus = (over: Partial<ManagedEngineStatus> = {}): ManagedEngineStatus => ({
  engine: 'claude',
  root: '/home/u/.vibisual/cli-engines/claude', // privacy-ok — 가상 경로
  active: null,
  previous: null,
  installed: [],
  latest: '2.1.310',
  checkedAt: 1,
  platformTarget: 'linux-x64',
  updating: false,
  lastError: null,
  autoUpdate: true,
  ...over,
});

const vscodeRow: EngineBinRow = { binPath: '/home/u/.vscode/extensions/anthropic.claude-code/claude', source: 'vscode-extension', version: '2.1.300', active: true, selected: false }; // privacy-ok — 가상 경로
const managedRow: EngineBinRow = { binPath: '/home/u/.vibisual/cli-engines/claude/versions/2.1.310/claude', source: 'managed', version: '2.1.310', active: false, selected: false }; // privacy-ok — 가상 경로

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const buttons = (): ReactTestInstance[] => view!.root.findAllByType('button');

async function mountPicker(props: Partial<Parameters<typeof EngineBinPicker>[0]> = {}): Promise<{ onSelect: ReturnType<typeof vi.fn> }> {
  const onSelect = vi.fn();
  await act(async () => {
    view = create(createElement(EngineBinPicker, {
      managed: managedStatus(),
      isDefault: true,
      rows: [managedRow, vscodeRow],
      saving: false,
      onSelect,
      renderSource: (s: string) => createElement('span', null, `[${s}]`),
      ...props,
    }));
  });
  return { onSelect };
}

describe('고르기 — 기본 = 앱 관리형, 나머지 = 보조', () => {
  it('첫 줄은 앱 관리형(기본 · 자동 업데이트)이고, 앱 관리형 판은 다른 설치본 묶음에 다시 싣지 않는다', async () => {
    await mountPicker();
    const [first, ...rest] = buttons();
    expect(textOf(first!)).toContain('App-managed (default · auto-updated)');
    expect(textOf(first!)).toContain('Default');
    expect(rest).toHaveLength(1);
    expect(textOf(rest[0]!)).toContain('[vscode-extension]');
    expect(textOf(view!.root)).toContain('Other installations (secondary) (1)');
  });

  it('기본인데 다른 설치본이 쓰이고 있으면(앱 관리형 준비 전) 그 줄은 "임시"다 — 사용자가 고른 것이 아니다', async () => {
    await mountPicker();
    const vscode = buttons()[1]!;
    expect(textOf(vscode)).toContain('Temporary');
    expect(textOf(vscode)).not.toContain('active');
  });

  it('사용자가 고른 설치본이 쓰이면 "임시"가 아니라 사용 중이다', async () => {
    await mountPicker({ isDefault: false, rows: [managedRow, { ...vscodeRow, selected: true }] });
    expect(textOf(buttons()[1]!)).toContain('active');
    expect(textOf(buttons()[1]!)).not.toContain('Temporary');
  });

  it('앱 관리형 판이 있으면 그 판을 기본 줄에 적고, 쓰이고 있으면 사용 중 표시를 단다', async () => {
    await mountPicker({
      managed: managedStatus({ active: { version: '2.1.310', binPath: managedRow.binPath, installedAt: 1 } }),
      rows: [{ ...managedRow, active: true }, { ...vscodeRow, active: false }],
    });
    const first = buttons()[0]!;
    expect(textOf(first)).toContain('Using 2.1.310');
    expect(textOf(first)).toContain('active');
    expect(textOf(buttons()[1]!)).not.toContain('Temporary');
  });

  it('기본을 누르면 null(사용자 지정 해제), 다른 설치본을 누르면 그 경로를 넘긴다', async () => {
    const { onSelect } = await mountPicker({ isDefault: false });
    await act(async () => { buttons()[0]!.props.onClick(); });
    await act(async () => { buttons()[1]!.props.onClick(); });
    expect(onSelect.mock.calls).toEqual([[null], [vscodeRow.binPath]]);
  });

  it('다른 설치본이 없으면 그렇게 적는다', async () => {
    await mountPicker({ rows: [managedRow] });
    expect(textOf(view!.root)).toContain('No other installations found on this PC.');
  });
});

describe('앱 관리형 준비 중 안내', () => {
  async function mountNotice(props: Partial<Parameters<typeof ManagedPendingNotice>[0]>): Promise<string> {
    await act(async () => {
      view = create(createElement(ManagedPendingNotice, { managed: managedStatus(), running: false, engineName: 'Claude Code', ...props }));
    });
    return textOf(view!.root);
  }

  it('받는 중이면 진행 줄을 함께 보인다', async () => {
    const text = await mountNotice({ running: true, lastLine: 'Downloading Claude Code 2.1.310… 40%' });
    expect(text).toContain('Preparing the app-managed copy');
    expect(text).toContain('40%');
  });

  it('실패면 사유 · 다음 재시도 시각 · [지금 업데이트] 안내를 보인다', async () => {
    const text = await mountNotice({ managed: managedStatus({ lastError: 'checksum mismatch for claude.exe', nextRetryAt: Date.UTC(2026, 9, 26, 1, 5) }) });
    expect(text).toContain("couldn't be prepared: checksum mismatch for claude.exe");
    expect(text).toContain('Retrying automatically at');
    expect(text).toContain('Use "Update now" below to try again now.');
  });

  it('점검 탈락이면 떨어진 옵션을 사유로 적는다', async () => {
    const text = await mountNotice({ managed: managedStatus({ failedProbes: ['--model sonnet'], lastError: 'x' }) });
    expect(text).toContain('rejected: --model sonnet');
  });

  it('그 엔진을 쓰지 않는 PC 면 미뤄 둔 이유를 적는다', async () => {
    expect(await mountNotice({ managed: managedStatus({ deferred: 'not-in-use' }), engineName: 'Codex' })).toContain("this PC doesn't use Codex yet");
  });

  it('그 밖에는 "아직 준비 전 · 자동으로 받는다"', async () => {
    expect(await mountNotice({})).toContain("isn't ready yet, so this installation is used for now");
  });
});
