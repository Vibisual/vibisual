import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFolderContextMenu,
  linuxMenuDirs,
  linuxMenuFiles,
  LINUX_SCRIPT_MARKER,
  macWorkflowFiles,
  VIBISUAL_BUNDLE_ID,
  WINDOWS_MENU_KEYS,
  windowsMenuRegFile,
  windowsRegFileBytes,
  type FolderMenuIo,
} from './folderContextMenu';
import { FOLDER_OPEN_ARG, folderPathsFromArgv } from './folderOpenArgs';

const HOME = '/home/dev';
const MAC_HOME = '/Users/dev';

/** 메모리 위의 디스크·프로세스 — 무엇을 적고 지우고 불렀는지 남긴다. */
function fakeIo(opts: { files?: Record<string, string>; bins?: string[] } = {}) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const runs: Array<{ cmd: string; args: string[]; body?: string }> = [];
  const modes = new Map<string, number>();
  const notices = { assoc: 0 };
  const io: FolderMenuIo = {
    notifyAssocChanged() { notices.assoc += 1; },
    writeFile(file, data, mode) {
      files.set(file, typeof data === 'string' ? data : data.subarray(2).toString('utf16le'));
      if (mode !== undefined) modes.set(file, mode);
    },
    removeFile(file) { files.delete(file); },
    removeDir(dir) {
      for (const k of [...files.keys()]) if (k.startsWith(`${dir}/`)) files.delete(k);
    },
    listDir(dir) {
      return [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1));
    },
    readText(file) { return files.get(file) ?? null; },
    async run(cmd, args) { runs.push({ cmd, args, body: args[1] ? files.get(args[1]) : undefined }); },
    has(bin) { return (opts.bins ?? []).includes(bin); },
  };
  return { io, files, runs, modes, notices };
}

const base = { packaged: true, label: 'Open project in Vibisual', home: HOME, env: {}, tmpDir: '/tmp', bundleId: VIBISUAL_BUNDLE_ID };

describe('Windows — 탐색기 클래식 메뉴(.reg)', () => {
  const exe = 'C:\\Users\\김\\AppData\\Local\\Programs\\Vibisual\\Vibisual.exe';

  it('먼저 두 키를 지우고 폴더 위·폴더 안 빈 곳에 같은 명령을 적는다 — 드라이브는 없다', () => {
    const reg = windowsMenuRegFile({ exePath: exe, label: 'Vibisual에서 프로젝트 열기' });
    for (const key of WINDOWS_MENU_KEYS) {
      expect(reg.indexOf(`[-${key}]`)).toBeLessThan(reg.indexOf(`[${key}]`));
      expect(reg).toContain(`[${key}\\command]`);
    }
    expect(reg).not.toContain('\\Drive\\');
    expect(reg).toContain('@="Vibisual에서 프로젝트 열기"');
    // .reg 문자열 안에서는 \ 와 " 를 escape 한다.
    expect(reg).toContain(`@="\\"${exe.replace(/\\/g, '\\\\')}\\" \\"${FOLDER_OPEN_ARG}=%V\\""`);
    expect(reg.match(/"MultiSelectModel"="Single"/g)).toHaveLength(1);
    expect(reg.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true);
  });

  it('명령줄을 탐색기가 펼친 모양 그대로 다시 읽으면 그 폴더가 나온다', () => {
    const command = `"${exe}" "${FOLDER_OPEN_ARG}=%V"`.replace('%V', 'D:\\내 작업\\앱');
    // CommandLineToArgvW 와 같은 규칙(따옴표로 묶인 토큰)으로 자른다.
    const argv = [...command.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect(folderPathsFromArgv(argv, 'win32')).toEqual(['D:\\내 작업\\앱']);
  });

  it('끄면 지우기만 한다', () => {
    const reg = windowsMenuRegFile(null);
    expect(reg).toContain(`[-${WINDOWS_MENU_KEYS[0]}]`);
    expect(reg).not.toContain('@=');
  });

  it('UTF-16LE + BOM 으로 적어 reg import 하고 임시 파일은 지운다', async () => {
    expect([...windowsRegFileBytes('A').subarray(0, 4)]).toEqual([0xff, 0xfe, 0x41, 0x00]);
    const { io, files, runs } = fakeIo();
    const status = await applyFolderContextMenu({ ...base, platform: 'win32', enabled: true, exePath: exe, env: { SystemRoot: 'C:\\Windows' }, tmpDir: 'C:\\Temp', io });
    expect(status).toMatchObject({ installed: true, targets: ['windows-explorer'], enabled: true });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cmd).toBe('C:\\Windows\\System32\\reg.exe');
    expect(runs[0]!.args[0]).toBe('import');
    expect(runs[0]!.body).toContain('[HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\Vibisual]');
    expect(files.size).toBe(0);
  });

  it('적고 나서도, 끄고 나서도 떠 있는 탐색기에 연결 변경을 알린다 — 안 하면 탐색기를 다시 열 때까지 안 보인다', async () => {
    for (const enabled of [true, false]) {
      const { io, notices } = fakeIo();
      await applyFolderContextMenu({ ...base, platform: 'win32', enabled, exePath: exe, io });
      expect(notices.assoc).toBe(1);
    }
    // 알림이 실패해도 적은 결과는 그대로다.
    const { io } = fakeIo();
    const throwing: FolderMenuIo = { ...io, notifyAssocChanged: () => { throw new Error('no shell32'); } };
    expect(await applyFolderContextMenu({ ...base, platform: 'win32', enabled: true, exePath: exe, io: throwing }))
      .toMatchObject({ installed: true, targets: ['windows-explorer'] });
  });

  it('reg import 가 실패하면 알리지 않는다 · 다른 OS 는 알림을 부르지 않는다', async () => {
    const { io, notices } = fakeIo({ bins: ['nautilus'] });
    const failing: FolderMenuIo = { ...io, run: async () => { throw new Error('access denied'); } };
    await applyFolderContextMenu({ ...base, platform: 'win32', enabled: true, exePath: exe, io: failing });
    await applyFolderContextMenu({ ...base, platform: 'darwin', enabled: true, exePath: '/x', io });
    await applyFolderContextMenu({ ...base, platform: 'linux', enabled: true, exePath: '/x', io });
    expect(notices.assoc).toBe(0);
  });

  it('제거기가 같은 두 키를 걷고 탐색기에 알린다(업데이트 땐 남긴다)', () => {
    const nsh = readFileSync(join(__dirname, '..', '..', 'build', 'installer.nsh'), 'utf8');
    const at = nsh.indexOf('!macro customUnInstall');
    const body = nsh.slice(at, nsh.indexOf('!macroend', at));
    expect(body).toContain('${ifNot} ${isUpdated}');
    let lastDelete = -1;
    for (const key of WINDOWS_MENU_KEYS) {
      const line = `DeleteRegKey HKCU "${key.replace('HKEY_CURRENT_USER\\', '')}"`;
      expect(body).toContain(line);
      lastDelete = Math.max(lastDelete, body.indexOf(line));
    }
    // 템플릿의 알림은 이 매크로보다 앞에서 돈다 — 지운 뒤에 한 번 더.
    expect(body.indexOf("System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'")).toBeGreaterThan(lastDelete);
  });
});

describe('macOS — Finder 빠른 동작', () => {
  it('폴더만 받고 open -b 로 앱에 넘긴다 · 메뉴 글자는 이스케이프한다', () => {
    const [info, wflow] = macWorkflowFiles({ label: 'A & <B>', bundleId: VIBISUAL_BUNDLE_ID });
    expect(info!.rel).toBe('Open in Vibisual.workflow/Contents/Info.plist');
    expect(info!.content).toContain('<string>A &amp; &lt;B&gt;</string>');
    expect(info!.content).toContain('<string>public.folder</string>');
    expect(wflow!.content).toContain(`/usr/bin/open -b ${VIBISUAL_BUNDLE_ID} &quot;$f&quot;`);
    expect(wflow!.content).toContain('<string>com.apple.Automator.servicesMenu</string>');
  });

  it('bundle id 는 electron-builder 의 appId 와 같다 · 폴더 문서 형식을 선언한다', () => {
    const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
    expect(yml).toContain(`appId: ${VIBISUAL_BUNDLE_ID}`);
    expect(yml).toMatch(/LSHandlerRank: Alternate\s+LSItemContentTypes:\s+- public\.folder/);
  });

  it('옛 동작을 지우고 다시 적은 뒤 서비스 목록을 새로 읽게 한다 · 끄면 지우기만', async () => {
    const { io, files, runs } = fakeIo({ files: { [`${MAC_HOME}/Library/Services/Open in Vibisual.workflow/Contents/old`]: 'x' } });
    const on = await applyFolderContextMenu({ ...base, platform: 'darwin', enabled: true, exePath: '/Applications/Vibisual.app/Contents/MacOS/Vibisual', home: MAC_HOME, io });
    expect(on).toMatchObject({ installed: true, targets: ['macos-finder'] });
    expect([...files.keys()].sort()).toEqual([
      `${MAC_HOME}/Library/Services/Open in Vibisual.workflow/Contents/Info.plist`,
      `${MAC_HOME}/Library/Services/Open in Vibisual.workflow/Contents/document.wflow`,
    ]);
    expect(runs.map((r) => r.cmd)).toEqual(['/System/Library/CoreServices/pbs']);
    const off = await applyFolderContextMenu({ ...base, platform: 'darwin', enabled: false, exePath: '', home: MAC_HOME, io });
    expect(off).toMatchObject({ installed: false, targets: [] });
    expect(files.size).toBe(0);
  });
});

describe('Linux — 설치된 파일 관리자에만', () => {
  const exe = '/opt/Vibisual/vibisual';
  const dirs = linuxMenuDirs(HOME, {});

  it('XDG 폴더를 따르고 상대 값은 무시한다', () => {
    expect(linuxMenuDirs(HOME, { XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: 'rel' })).toMatchObject({
      nautilusScripts: '/data/nautilus/scripts',
      cajaScripts: `${HOME}/.config/caja/scripts`,
      kioServiceMenus: '/data/kio/servicemenus',
    });
  });

  it('없는 파일 관리자에는 적지 않는다 · MIME 연결은 하지 않는다', () => {
    expect(linuxMenuFiles({ exePath: exe, label: 'L', dirs, has: () => false })).toEqual([]);
    const files = linuxMenuFiles({ exePath: exe, label: 'L', dirs, has: (b) => b === 'dolphin' });
    expect(files.map((f) => f.target)).toEqual(['dolphin', 'dolphin']);
    expect(files.every((f) => f.mode === 0o755)).toBe(true);
    expect(files[0]!.content).toContain(`Exec=${exe} ${FOLDER_OPEN_ARG} %f`);
    expect(files[0]!.content).not.toContain('"%f"');
  });

  it('스크립트는 고른 폴더(없으면 지금 폴더)를 = 한 토큰으로 넘긴다 · 실행본 경로는 셸 인용', () => {
    const [script] = linuxMenuFiles({ exePath: `${HOME}/App's/Vibisual.AppImage`, label: 'Open/project', dirs, has: (b) => b === 'nautilus' });
    expect(script!.file).toBe(`${HOME}/.local/share/nautilus/scripts/Open project`);
    expect(script!.content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script!.content).toContain(LINUX_SCRIPT_MARKER);
    expect(script!.content).toContain(`exe='${HOME}/App'\\''s/Vibisual.AppImage'`);
    expect(script!.content).toContain(`"$exe" "${FOLDER_OPEN_ARG}=$p"`);
    expect(script!.content).toContain(`"$exe" "${FOLDER_OPEN_ARG}=$NAUTILUS_SCRIPT_CURRENT_URI"`);
  });

  it('공백이 든 실행본은 .desktop 규칙으로 인용한다', () => {
    const [service] = linuxMenuFiles({ exePath: `${HOME}/My Apps/vibisual`, label: 'L', dirs, has: (b) => b === 'dolphin' });
    expect(service!.content).toContain(`Exec="${HOME}/My Apps/vibisual" ${FOLDER_OPEN_ARG} %f`);
  });

  it('언어가 바뀌어 스크립트 이름이 달라져도 표시 줄로 찾아 걷는다 — 사용자의 다른 스크립트는 그대로', async () => {
    const userScript = `${HOME}/.local/share/nautilus/scripts/my-own`;
    const { io, files } = fakeIo({
      bins: ['nautilus', 'nemo'],
      files: {
        [`${HOME}/.local/share/nautilus/scripts/Vibisual에서 프로젝트 열기`]: `#!/bin/sh\n${LINUX_SCRIPT_MARKER}\n`,
        [userScript]: '#!/bin/sh\necho hi\n',
      },
    });
    const status = await applyFolderContextMenu({ ...base, platform: 'linux', enabled: true, exePath: exe, io });
    expect(status).toMatchObject({ installed: true, targets: ['nautilus', 'nemo'] });
    expect(files.has(`${HOME}/.local/share/nautilus/scripts/Vibisual에서 프로젝트 열기`)).toBe(false);
    expect(files.has(`${HOME}/.local/share/nautilus/scripts/Open project in Vibisual`)).toBe(true);
    expect(files.has(`${HOME}/.local/share/nemo/actions/vibisual-open-folder.nemo_action`)).toBe(true);
    expect(files.has(userScript)).toBe(true);

    const off = await applyFolderContextMenu({ ...base, platform: 'linux', enabled: false, exePath: exe, io });
    expect(off).toMatchObject({ installed: false, targets: [] });
    expect([...files.keys()]).toEqual([userScript]);
  });

  it('아는 파일 관리자가 없으면 그 사유를 돌려준다', async () => {
    const { io } = fakeIo();
    expect(await applyFolderContextMenu({ ...base, platform: 'linux', enabled: true, exePath: exe, io }))
      .toMatchObject({ installed: false, reason: 'no-file-manager' });
  });
});

describe('적지 않는 경우', () => {
  it('개발 실행은 설치본의 항목을 덮지 않는다 — 디스크·프로세스를 건드리지 않는다', async () => {
    const { io, files, runs } = fakeIo({ bins: ['nautilus'] });
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const status = await applyFolderContextMenu({ ...base, platform, packaged: false, enabled: true, exePath: '/x', io });
      expect(status).toMatchObject({ installed: false, reason: 'dev-build' });
    }
    expect(files.size).toBe(0);
    expect(runs).toHaveLength(0);
  });

  it('모르는 플랫폼 · 쓰기 실패는 던지지 않고 상태로', async () => {
    const { io } = fakeIo();
    expect(await applyFolderContextMenu({ ...base, platform: 'freebsd', enabled: true, exePath: '/x', io }))
      .toMatchObject({ reason: 'unsupported-platform' });
    const failing: FolderMenuIo = { ...io, run: async () => { throw new Error('access denied'); } };
    expect(await applyFolderContextMenu({ ...base, platform: 'win32', enabled: true, exePath: 'C:\\x.exe', io: failing }))
      .toMatchObject({ installed: false, reason: 'error', error: 'access denied' });
  });
});
