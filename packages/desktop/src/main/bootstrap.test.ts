/**
 * §3.7 · §9 「시작 화면(스플래시)」 — 시작 진입점의 배선을 원문으로 고정한다.
 * 실측: 재설치·업데이트 직후 첫 실행은 프로세스 시작→본체 첫 줄 4.4~5.4초, 서버 기동 동기 구간 4.2~6.2초. 시작 진입점이 서버 코어·shared 값을 정적으로 부르면
 * 그 덩어리가 첫 청크에 실려 스플래시가 늦고, `ready` 전에만 먹는 호출(스킴 등록·스위치·잠금)이 본체로 가면 본체는 `ready` 뒤라 조용히 깨진다 — 둘 다 막는다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN_DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
/** 주석을 걷은 코드(주석에 남긴 옛 이름이 검사를 속이지 않게). */
const code = (path: string): string => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const bootstrap = code(join(MAIN_DIR, 'bootstrap.ts'));
const mainIndex = code(join(MAIN_DIR, 'index.ts'));

/** 정적 import 줄(`import type` 은 지워지므로 뺀다). */
function staticImports(src: string): Array<{ from: string; typeOnly: boolean }> {
  const out: Array<{ from: string; typeOnly: boolean }> = [];
  const re = /^\s*import\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ from: m[2] ?? m[3] ?? '', typeOnly: Boolean(m[1]) });
  return out;
}

/** 시작 진입점에서 정적으로 닿는 우리 모듈 전부(상대 경로만 따라간다). */
function bootstrapClosure(): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const src = code(file);
    seen.set(file, src);
    for (const imp of staticImports(src)) {
      if (imp.typeOnly || !imp.from.startsWith('.')) continue;
      visit(resolve(dirname(file), imp.from.endsWith('.ts') ? imp.from : `${imp.from.replace(/\.js$/, '')}.ts`));
    }
  };
  visit(join(MAIN_DIR, 'bootstrap.ts'));
  return seen;
}

describe('시작 진입점은 가볍다', () => {
  const closure = bootstrapClosure();

  it('정적으로 닿는 모듈 어디에서도 서버 코어를 부르지 않는다', () => {
    for (const [file, src] of closure) {
      for (const imp of staticImports(src)) {
        expect(imp.from, `${file} 가 서버 코어를 정적으로 부른다 — 스플래시가 그만큼 늦게 뜬다`).not.toBe('@vibisual/server');
      }
    }
  });

  it('shared 는 타입만 — 값으로 부르면 shared 덩어리가 첫 청크에 실린다', () => {
    for (const [file, src] of closure) {
      for (const imp of staticImports(src)) {
        if (imp.from === '@vibisual/shared') expect(imp.typeOnly, `${file} 가 shared 값을 부른다`).toBe(true);
      }
    }
  });

  it('본체는 동적으로만 읽는다', () => {
    expect(bootstrap).toContain("await import('./index')");
    expect(staticImports(bootstrap).some((i) => i.from === './index' && !i.typeOnly)).toBe(false);
  });

  it('닿는 모듈이 예상한 범위다(새 의존이 끼면 이 목록부터 본다)', () => {
    const names = [...closure.keys()].map((f) => f.slice(MAIN_DIR.length + 1).replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      'appMessageBox.ts', 'appMessagePage.ts', 'bootErrors.ts', 'bootstrap.ts', 'consentStrings.ts', 'crashLog.ts', 'hookLifecycle.ts',
      'mainStallLog.ts', 'splashCache.ts', 'splashPage.ts', 'splashPolicy.ts', 'splashStrings.ts', 'splashWindow.ts', 'windowCloak.ts',
    ]);
  });

  it('첫 표시 가림의 koffi 는 정적으로 읽지 않는다 — Windows 에서 처음 가릴 때만 읽는다(다른 OS 의 스플래시를 늦추지 않게)', () => {
    for (const [file, src] of closure) {
      for (const imp of staticImports(src)) {
        expect(imp.from, `${file} 가 koffi 를 정적으로 부른다`).not.toBe('koffi');
        expect(imp.from === './dwmCloak' && !imp.typeOnly, `${file} 가 dwmCloak 을 정적으로 부른다`).toBe(false);
      }
    }
    expect(code(join(MAIN_DIR, 'windowCloak.ts'))).toContain("import('./dwmCloak')");
    // koffi 는 앱의 다른 곳과 같은 입구로 — 정적 import(빌드가 require 로 낸다). `import('koffi')` 는 ESM 입구를 탄다.
    expect(staticImports(code(join(MAIN_DIR, 'dwmCloak.ts'))).map((i) => i.from)).toEqual(['koffi']);
    expect(code(join(MAIN_DIR, 'windowCloak.ts'))).not.toContain("import('koffi')");
  });
});

describe('ready 전에만 먹는 일은 시작 진입점에 있다', () => {
  it('vibproxy 스킴 등록 · Linux 캡처 스위치 · 크래시 수집·배너 · 단일 인스턴스 잠금', () => {
    expect(bootstrap).toContain("protocol.registerSchemesAsPrivileged([");
    expect(bootstrap).toContain("{ scheme: 'vibproxy', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }");
    expect(bootstrap).toContain("app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');");
    expect(bootstrap).toContain('startCrashReporter();\nlogAppStart();');
    expect(bootstrap).toContain('app.requestSingleInstanceLock()');
  });

  it('본체에는 다시 두지 않는다 — 본체는 ready 뒤에 읽히므로 거기서는 이미 늦다', () => {
    for (const call of ['registerSchemesAsPrivileged', 'appendSwitch(', 'requestSingleInstanceLock', 'startCrashReporter(', 'logAppStart(', 'startMainStallLog(']) {
      expect(mainIndex, `본체가 ${call} 를 부른다`).not.toContain(call);
    }
  });

  it('순서 — 잠금 → (ready) 멈춤 시계 → 스플래시 → 본체 읽기', () => {
    const lock = bootstrap.indexOf('app.requestSingleInstanceLock()');
    const ready = bootstrap.indexOf('app.whenReady()');
    const stall = bootstrap.indexOf('startMainStallLog();');
    const splash = bootstrap.indexOf('await openSplash(');
    const load = bootstrap.indexOf("await import('./index')");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(ready);
    expect(ready).toBeLessThan(stall);
    expect(stall).toBeLessThan(splash);
    expect(splash).toBeLessThan(load);
  });

  // §3.6 「수명」 · §5.7 #24-3 ⑤ — 제거기의 정리 모드는 잠금·스플래시·본체 없이 훅만 걷고 끝난다.
  it('제거기의 정리 모드는 잠금을 잡지 않고, 정리 모듈만 동적으로 읽고 끝낸다', () => {
    expect(bootstrap).toContain('const gotSingleInstanceLock = !hookCleanupRun && app.requestSingleInstanceLock();');
    const at = bootstrap.indexOf('if (hookCleanupRun) {');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(bootstrap.indexOf('await openSplash('));
    const branch = bootstrap.slice(at, bootstrap.indexOf('} else if (!gotSingleInstanceLock) {', at));
    expect(branch).toContain("import('./hookCleanup')");
    expect(branch).toContain('logCleanExit();');
    expect(branch).toContain('app.exit(0)');
    expect(branch).not.toContain('openSplash');
    expect(branch).not.toContain("import('./index')");
    expect(staticImports(bootstrap).some((i) => i.from === './hookCleanup' && !i.typeOnly)).toBe(false);
  });

  it('잠금을 못 잡은 쪽은 스플래시 없이 끝난다(정상 종료 표식을 남기고)', () => {
    const at = bootstrap.indexOf('if (!gotSingleInstanceLock) {');
    expect(at).toBeGreaterThan(-1);
    expect(bootstrap.slice(at, bootstrap.indexOf('} else {', at))).toBe('if (!gotSingleInstanceLock) {\n  logCleanExit();\n  app.quit();\n');
  });

  it('본체를 못 읽으면 스플래시를 걷고 안내한 뒤 끝낸다(기록을 남기고)', () => {
    const at = bootstrap.indexOf("await import('./index')");
    const tail = bootstrap.slice(at, bootstrap.indexOf('launched = main.launchApp({ splash });', at));
    expect(tail).toContain("appendCrashLine('main', 'fatal'");
    expect(tail).toContain('splash?.close();');
    expect(tail).toContain('await showAppMessageBox({ type: \'error\', title: s.loadFailedTitle, message: s.loadFailedMessage,');
    expect(tail).toContain('app.exit(1);');
  });
});

describe('본체 쪽 배선', () => {
  it('시작은 launchApp 하나 — 두 번째 실행·Dock 클릭 손잡이를 돌려준다', () => {
    expect(mainIndex).toContain('export function launchApp(opts: { splash: SplashHandle | null }): LaunchedApp {');
    expect(bootstrap).toContain('launched.onSecondInstance()');
    expect(bootstrap).toContain('launched.onActivate()');
  });

  it('본체가 숨은 동안의 두 번째 실행은 숨은 본체가 아니라 스플래시를 앞으로', () => {
    const at = mainIndex.indexOf('onSecondInstance: () => {');
    const body = mainIndex.slice(at, mainIndex.indexOf('onActivate:', at));
    expect(body.indexOf('mainReveal?.pending')).toBeGreaterThan(-1);
    expect(body.indexOf('mainReveal.focusSplash();')).toBeLessThan(body.indexOf('win.show();'));
  });

  it('동의 창이 뜨면 스플래시는 숨는다', () => {
    expect(mainIndex).toContain('ensureDesktopConsent({ onPrompt: () => bootSplash?.hide() })');
  });

  it('부팅 진척을 스플래시로 흘리고, 서버 코어가 끝나면 창구를 걷는다', () => {
    expect(mainIndex).toContain('setBootProgressSink((progress) => bootSplash?.boot(progress));');
    const run = mainIndex.indexOf('const handle = await runServer();');
    expect(mainIndex.slice(run, run + 200)).toContain('setBootProgressSink(null);');
  });

  it('부팅 실패 안내 전에 스플래시를 걷는다 — 안내가 스플래시 뒤에 가려지지 않게', () => {
    const at = mainIndex.indexOf('askRestart: async () => {');
    const body = mainIndex.slice(at, mainIndex.indexOf('showAppMessageBox(', at));
    expect(body).toContain('bootSplash?.close();');
  });

  it('스플래시가 있으면 부팅 확인을 그 뒤에서 먼저 풀고, 본체 창은 숨긴 채 공개 제어에 맡긴다', () => {
    const release = mainIndex.indexOf("if (bootSplash) releaseStartupJobs('splash');");
    const create = mainIndex.indexOf('createWindow({ splash: bootSplash });');
    expect(release).toBeGreaterThan(-1);
    expect(release).toBeLessThan(create);
    expect(mainIndex).toContain('mainReveal = startMainReveal({');
    expect(mainIndex).toContain('pendingStartupJobs: pendingStartupJobCount,');
  });

  it('스플래시가 있을 때는 ready-to-show 에 곧바로 보이지 않는다(그 순간이 버벅임의 시작이었다)', () => {
    const at = mainIndex.indexOf('if (splash) {');
    const elseAt = mainIndex.indexOf('} else {', at);
    expect(mainIndex.slice(at, elseAt)).not.toContain("on('ready-to-show'");
    expect(mainIndex.slice(elseAt, elseAt + 120)).toContain("mainWindow.on('ready-to-show', () => mainWindow.show());");
    const fallback = mainIndex.slice(elseAt, mainIndex.indexOf("mainWindow.once('show'", elseAt));
    expect(fallback).toContain('observeMainWindowReady({');
    expect(fallback).toContain('window: mainWindow,');
    expect(fallback).toContain('firstShow,');
  });
});

describe('채널 이름 짝', () => {
  it('스플래시 포트 — main 이 보내는 이름을 preload 가 듣는다', () => {
    const preload = read(join(MAIN_DIR, '..', 'preload', 'splash.ts'));
    const window = read(join(MAIN_DIR, 'splashWindow.ts'));
    const name = /SPLASH_PORT_CHANNEL = '([^']+)'/.exec(window)?.[1];
    expect(name).toBe('vibisual:splash:port');
    expect(preload).toContain(`ipcRenderer.once('${name}',`);
  });

  it('스플래시 preload 는 electron 하나만 부른다 — 샌드박스 preload 는 다른 파일을 require 할 수 없다', () => {
    const preload = code(join(MAIN_DIR, '..', 'preload', 'splash.ts'));
    expect(staticImports(preload).map((i) => i.from)).toEqual(['electron']);
  });

  it('첫 화면 신호 — 렌더러가 보내는 이름을 main 이 받는다', () => {
    const preload = read(join(MAIN_DIR, '..', 'preload', 'index.ts'));
    const reveal = read(join(MAIN_DIR, 'mainReveal.ts'));
    const name = /MAIN_READY_CHANNEL = '([^']+)'/.exec(reveal)?.[1];
    expect(name).toBe('vibisual:lifecycle:main-ready');
    expect(preload).toContain(`mainReady: (): Promise<boolean> => ipcRenderer.invoke('${name}'),`);
  });

  it('빌드 — main 입구는 시작 진입점, preload 는 스플래시 입구를 함께 낸다', () => {
    const config = read(join(MAIN_DIR, '..', '..', 'electron.vite.config.ts'));
    expect(config).toContain("lib: { entry: resolve(__dirname, 'src/main/bootstrap.ts'), formats: ['cjs'] },");
    expect(config).toContain("splash: resolve(__dirname, 'src/preload/splash.ts'),");
    expect(config).toContain("rollupOptions: { output: { entryFileNames: '[name].cjs' } },");
  });
});
