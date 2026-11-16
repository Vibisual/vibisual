import { describe, expect, it, vi } from 'vitest';
import type { AppAgentLink, AppBubble, AppToolRule } from '@vibisual/shared';
import { AppLinkGate, resolveScriptPath, type AppLinkGateDeps } from './appLinkGate.js';

const RULE: AppToolRule = { commands: [], outputCommands: ['ffmpeg'], outputPattern: /\.mp4\b/i, scriptMarkers: [] };
const AGENT = 'agent-1';
const SUB = 'sub-1';

function node(over: Partial<AppBubble> = {}): AppBubble {
  return { id: 'app-a', projectName: 'p', appId: 'studio', x: 0, y: 0, width: 80, height: 50, createdAt: 1, linkedAgentIds: [AGENT], ref: 'doc-1', ...over } as AppBubble;
}

function makeGate(over: Partial<AppLinkGateDeps> & { files?: Record<string, string>; ensured?: string | null } = {}): {
  gate: AppLinkGate; ensureRef: ReturnType<typeof vi.fn>; bindRef: ReturnType<typeof vi.fn>;
} {
  const ensureRef = vi.fn(() => over.ensured ?? null);
  const bindRef = vi.fn(() => true);
  const link: AppAgentLink<unknown> = {
    rule: RULE,
    ensureRef,
    pointer: (t) => `pointer ${t.id} ${t.ref ?? 'none'}`,
    denyReason: (t, evidence) => `deny ${t.id} ${t.ref ?? 'none'} ${evidence}`,
  };
  const files = over.files ?? {};
  const gate = new AppLinkGate({
    linkedNodes: () => [node()],
    commandScope: () => null,
    resolveLink: async () => ({ link, host: {} }),
    bindRef,
    warn: () => {},
    platform: 'linux',
    readText: async (file) => files[file] ?? null,
    ...over,
  });
  return { gate, ensureRef, bindRef };
}

const bash = (command: string, cwd: string | null = '/work'): Parameters<AppLinkGate['check']>[0] =>
  ({ agentId: AGENT, subAgentId: SUB, toolName: 'Bash', toolInput: { command }, cwd });

describe('Windows headless Chrome capture', () => {
  const chrome = '"/c/Program Files/Google/Chrome/Application/chrome.exe"';
  const capture = `${chrome} --headless=new --screenshot=frame.png about:blank`;
  const loop = `for t in 1 2; do ${capture}; done`;
  const denial = { deny: 'Vibisual blocked headless Chrome capture on Windows. Use Vibistudio frame or still.' };

  it('blocks Git Bash capture loops before resolving an app link', async () => {
    const resolveLink = vi.fn();
    const { gate } = makeGate({ platform: 'win32', linkedNodes: () => [], resolveLink });
    expect(await gate.check(bash(loop))).toEqual(denial);
    expect(resolveLink).not.toHaveBeenCalled();
  });

  it('finds capture after a heredoc even when app links are disabled', async () => {
    const { gate } = makeGate({
      platform: 'win32',
      commandScope: () => ({ appNodeIds: [], off: true }),
    });
    expect(await gate.check(bash(`python - <<'PY'\nprint("ready")\nPY\n${loop}`))).toEqual(denial);
  });

  it('blocks the PowerShell call operator with a quoted Chrome path', async () => {
    const { gate } = makeGate({ platform: 'win32', linkedNodes: () => [] });
    const command = String.raw`& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --screenshot=frame.png --headless`;
    expect(await gate.check({ ...bash(command), toolName: 'PowerShell' })).toEqual(denial);
  });

  it('follows a local capture script launched by a package command', async () => {
    const { gate } = makeGate({
      platform: 'win32',
      linkedNodes: () => [],
      files: {
        'C:\\work\\package.json': JSON.stringify({ scripts: { capture: 'node capture.mjs' } }),
        'C:\\work\\capture.mjs': 'const chrome = "C:/Google/chrome.exe"; spawn(chrome, ["--headless=new"]); send("Page.captureScreenshot");',
      },
    });
    expect(await gate.check(bash('npm run capture', 'C:/work'))).toEqual(denial);
  });

  it('does not read network scripts during the Windows host check', async () => {
    const readText = vi.fn(async () => null);
    const { gate } = makeGate({ platform: 'win32', linkedNodes: () => [], readText });
    expect(await gate.check(bash('node "//host/share/capture.mjs"', 'C:/work'))).toEqual({});
    expect(readText).not.toHaveBeenCalled();
  });

  it.each([
    `echo '${capture}'`,
    'chrome --version',
    'npx chrome-driver --version',
    'chrome --headless about:blank',
    `python - <<'PY'\nprint("chrome --headless --screenshot")\nPY`,
    'curl http://127.0.0.1/api/app/vibistudio/doc/doc-1/still',
  ])('adds no guidance to an unrelated command: %s', async (command) => {
    const { gate } = makeGate({ platform: 'win32', linkedNodes: () => [] });
    expect(await gate.check(bash(command))).toEqual({});
  });

  it.each(['darwin', 'linux'])('leaves headless capture available on %s', async (platform) => {
    const { gate } = makeGate({ platform, linkedNodes: () => [] });
    expect(await gate.check(bash(loop))).toEqual({});
  });
});

describe('resolveScriptPath — 셸이 말한 경로', () => {
  it('Windows 의 Git Bash 형식을 드라이브 경로로 편다', () => {
    expect(resolveScriptPath('/c/work/r.py', null, 'win32')).toBe('c:\\work\\r.py');
    expect(resolveScriptPath('r.py', '/c/work', 'win32')).toBe('c:\\work\\r.py');
    expect(resolveScriptPath('tools/r.py', 'C:/work', 'win32')).toBe('C:\\work\\tools\\r.py');
  });

  it('macOS·Linux 의 /c/ 는 그냥 폴더다', () => {
    expect(resolveScriptPath('/c/work/r.py', null, 'linux')).toBe('/c/work/r.py');
    expect(resolveScriptPath('r.py', '/srv/projects/p', 'darwin')).toBe('/srv/projects/p/r.py');
  });

  it('cwd 를 모르는 상대 경로는 넘겨짚지 않는다', () => {
    expect(resolveScriptPath('r.py', null, 'linux')).toBe('r.py');
  });
});

describe('AppLinkGate — 연결 강제', () => {
  it('이어진 노드가 없으면 아무 말도 하지 않는다', async () => {
    const { gate } = makeGate({ linkedNodes: () => [] });
    expect(await gate.check(bash('ffmpeg -i a out.mp4'))).toEqual({});
  });

  it('영상을 굽는 호출을 막고 어디로 가야 하는지 말한다', async () => {
    const { gate } = makeGate();
    expect((await gate.check(bash('ffmpeg -i a.png out.mp4'))).deny).toBe('deny app-a doc-1 ffmpeg');
  });

  it('슬래시 명령이든 IDE 입력이든 명령 범위가 없으면 이어진 노드 전부를 본다', async () => {
    const { gate } = makeGate({ commandScope: () => ({ appNodeIds: [], off: false }) });
    expect((await gate.check(bash('ffmpeg -i a.png out.mp4'))).deny).toContain('deny');
  });

  it('칩을 모두 끈 명령은 쉰다', async () => {
    const { gate } = makeGate({ commandScope: () => ({ appNodeIds: [], off: true }) });
    expect(await gate.check(bash('ffmpeg -i a.png out.mp4'))).toEqual({});
  });

  it('칩으로 고른 노드만 본다', async () => {
    const { gate } = makeGate({ commandScope: () => ({ appNodeIds: ['app-other'], off: false }) });
    expect(await gate.check(bash('ffmpeg -i a.png out.mp4'))).toEqual({});
  });

  it('스크립트와 그 로컬 import 안의 렌더도 찾는다', async () => {
    const { gate } = makeGate({
      files: {
        '/work/make.py': 'import helper\nhelper.go()',
        '/work/helper.py': `subprocess.run(["ffmpeg", "-i", "a", "out.mp4"])`,
      },
    });
    expect((await gate.check(bash('python make.py'))).deny).toBe('deny app-a doc-1 ffmpeg');
  });

  it('heredoc 코드 안의 렌더도 찾는다', async () => {
    const { gate } = makeGate();
    const verdict = await gate.check(bash(`python - <<'EOF'\nsubprocess.run(["ffmpeg", "-i", "a", "out.mp4"])\nEOF`));
    expect(verdict.deny).toContain('ffmpeg');
  });

  it('npm run 은 package.json 의 그 스크립트를 본다', async () => {
    const { gate } = makeGate({ files: { '/work/package.json': JSON.stringify({ scripts: { render: 'ffmpeg -i a out.mp4' } }) } });
    expect((await gate.check(bash('npm run render'))).deny).toContain('ffmpeg');
  });

  it('소리만 다루는 스크립트는 통과한다', async () => {
    const { gate } = makeGate({ files: { '/work/voice.py': `subprocess.run(["ffmpeg", "-i", "a", "voice.wav"])` } });
    expect((await gate.check(bash('python voice.py'))).deny).toBeUndefined();
  });

  it('안내는 세션·노드마다 첫 호출에 한 번만 실린다', async () => {
    const { gate } = makeGate();
    const read = { agentId: AGENT, subAgentId: SUB, toolName: 'Read', toolInput: { file_path: 'a' }, cwd: '/work' };
    expect((await gate.check(read)).additionalContext).toBe('pointer app-a doc-1');
    expect(await gate.check(read)).toEqual({});
    expect((await gate.check({ ...read, subAgentId: 'sub-2' })).additionalContext).toBe('pointer app-a doc-1');
  });

  it('말풍선 전송은 브리프가 이미 실렸으니 안내를 더하지 않되 막기는 한다', async () => {
    const { gate } = makeGate({ commandScope: () => ({ appNodeIds: ['app-a'], off: false }) });
    expect(await gate.check({ agentId: AGENT, subAgentId: SUB, toolName: 'Read', toolInput: {}, cwd: null })).toEqual({});
    expect((await gate.check(bash('ffmpeg -i a out.mp4'))).deny).toContain('ffmpeg');
  });

  it('문서가 없는 노드는 만들어 묶고, 그 문서를 말한다', async () => {
    const { gate, ensureRef, bindRef } = makeGate({ linkedNodes: () => [node({ ref: undefined })], ensured: 'doc-new' });
    expect((await gate.check(bash('ffmpeg -i a out.mp4'))).deny).toBe('deny app-a doc-new ffmpeg');
    expect(ensureRef).toHaveBeenCalledTimes(1);
    expect(bindRef).toHaveBeenCalledWith('app-a', 'doc-new');
  });

  it('첫 턴의 병렬 호출이 문서를 둘 만들지 않는다', async () => {
    let bound: string | undefined;
    const fresh = (): AppBubble => node({ ref: bound });
    const deps = makeGate({ linkedNodes: () => [fresh()], ensured: 'doc-new' });
    deps.bindRef.mockImplementation((_id: string, ref: string) => { bound = ref; return true; });
    const verdicts = await Promise.all([deps.gate.check(bash('ls')), deps.gate.check(bash('pwd')), deps.gate.check(bash('ffmpeg -i a out.mp4'))]);
    expect(deps.ensureRef).toHaveBeenCalledTimes(1);
    expect(verdicts[2]!.deny).toBe('deny app-a doc-new ffmpeg');
  });

  it('문서가 있는 노드는 건드리지 않는다', async () => {
    const { gate, ensureRef } = makeGate();
    await gate.check(bash('ls'));
    expect(ensureRef).not.toHaveBeenCalled();
  });

  it('선언하지 않은 앱은 지나간다', async () => {
    const { gate } = makeGate({ resolveLink: async () => null });
    expect(await gate.check(bash('ffmpeg -i a out.mp4'))).toEqual({});
  });

  it('판정이 터져도 도구를 막지 않는다', async () => {
    const warn = vi.fn();
    const { gate } = makeGate({ resolveLink: async () => { throw new Error('boom'); }, warn });
    expect(await gate.check(bash('ffmpeg -i a out.mp4'))).toEqual({});
    expect(warn).toHaveBeenCalled();
  });
});
