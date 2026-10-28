import { resolve, dirname } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// electron-vite (preview) 가 Electron 을 spawn 할 때 ELECTRON_RUN_AS_NODE 를 물려주면 electron.exe 가 일반 Node 로 돈다
// (`require('electron')` 이 경로 문자열 → electron.app undefined → 모듈 로드 크래시). VS Code 통합 터미널·확장 호스트가 이 변수를 둘 수 있어
// 설정 로드 시점(electron spawn 전)에 지운다.
delete process.env['ELECTRON_RUN_AS_NODE'];

// SCENARIO.md §3.7 — in-process 통합.
//  - main: server 코어(@vibisual/server)를 같은 프로세스에서 구동(child spawn 없음). @vibisual/* 는 번들에 포함(CJS main 은 ESM dist 를 require 못 함).
//    light-my-request 는 desktop 직접 의존성이라 외부화해도 풀린다. express/cors/ws 등 server 전이 의존성은 desktop/node_modules 에 없어 번들에 넣어야 한다.
//  - preload: contextBridge 로 window.api(IPC) 노출. renderer: packages/client UI 를 그대로 번들 — transport 어댑터만 IPC 로 라우팅.
// renderer 의 fetch/WebSocket 은 transport monkey-patch 가 IPC 로 우회하므로 dev 프록시가 필요 없다(server 는 늘 main 안에서 돈다).
const CLIENT_ROOT = resolve(__dirname, '../client');
const REPO_ROOT = resolve(__dirname, '../..');

// main 번들에 넣을 워크스페이스 패키지 — 손으로 적지 말고 dependencies 의 `@vibisual/*` 에서 뽑는다. 빠진 패키지는 외부화돼 설치본 node_modules 에서 풀리는데
// 거기엔 그 패키지의 devDependency 가 없어, 앱 서버 몫이 express 를 import 하는 순간 ERR_MODULE_NOT_FOUND → `app failed to load`(/runapp 은 워크스페이스로 풀려 설치본에서만 드러난다).
// 번들에 넣어도 늦은 로드(§5.13 P-1)는 그대로다 — 동적 import 는 별도 청크로 남는다.
const DESKTOP_PKG = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const WORKSPACE_PACKAGES = Object.keys(DESKTOP_PKG.dependencies ?? {}).filter((name) => name.startsWith('@vibisual/'));

// §3.6 — Claude Code 글로벌 PreToolUse 훅이 실행할 핸들러를 앱 리소스에 동봉한다: main closeBundle 단계에서 <repo>/hooks/{handler.mjs, lib/serverUrl.mjs} 를
// packages/desktop/out/hooks/ 로 복사(electron-builder `files: out/**` 가 픽업, `electron-vite preview` 도 같은 경로).
// handler.mjs 는 `--server` 가 늘 주어져도 `./lib/serverUrl.mjs` 를 static import 하므로 lib 파일이 디스크에 있어야 로드된다(ERR_MODULE_NOT_FOUND 방지).
function copyHookHandlerPlugin() {
  const FILES = [
    { from: resolve(REPO_ROOT, 'hooks/handler.mjs'), to: resolve(__dirname, 'out/hooks/handler.mjs') },
    { from: resolve(REPO_ROOT, 'hooks/codex-edges.mjs'), to: resolve(__dirname, 'out/hooks/codex-edges.mjs') },
    { from: resolve(REPO_ROOT, 'hooks/verification-tools.mjs'), to: resolve(__dirname, 'out/hooks/verification-tools.mjs') },
    { from: resolve(REPO_ROOT, 'hooks/lib/serverUrl.mjs'), to: resolve(__dirname, 'out/hooks/lib/serverUrl.mjs') },
    // SCENARIO §4 엔진 다리 — 우리가 띄우는 claude 세션에 `--plugin-dir` 로 싣는 Claude Code 모드.
    //   매니페스트는 점 폴더(`.claude-plugin/`)에서 꺼내 **평평하게**(`plugin.json`) 싣는다 — 패키징이 점 폴더를
    //   빠뜨리면 모드가 통째로 안 실린다. 서버(`services/engineBridge.ts`)가 `~/.vibisual/mods/` 에 제 모양으로 세운다.
    { from: resolve(REPO_ROOT, 'hooks/mods/vibisual-bridge/.claude-plugin/plugin.json'), to: resolve(__dirname, 'out/mods/vibisual-bridge/plugin.json') },
    { from: resolve(REPO_ROOT, 'hooks/mods/vibisual-bridge/hooks/hooks.json'), to: resolve(__dirname, 'out/mods/vibisual-bridge/hooks/hooks.json') },
    { from: resolve(REPO_ROOT, 'hooks/mods/vibisual-bridge/hooks/register.js'), to: resolve(__dirname, 'out/mods/vibisual-bridge/hooks/register.js') },
    // BrowserWindow.icon (and Linux/Mac packaged window icons) need the PNG at runtime.
    // Stage it next to out/ so dev (electron-vite preview) and packaged builds resolve
    // the same path: `join(__dirname /* out/main */, '../icon.png')`.
    { from: resolve(__dirname, 'resources/icons/icon.png'), to: resolve(__dirname, 'out/icon.png') },
    // Windows BrowserWindow requires .ico for a crisp taskbar/title-bar icon; PNG renders blurry.
    { from: resolve(__dirname, 'resources/icons/icon.ico'), to: resolve(__dirname, 'out/icon.ico') },
  ];
  return {
    name: 'vibisual:copy-hook-handler',
    closeBundle(): void {
      for (const { from, to } of FILES) {
        try {
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(from, to);
        } catch (err) {
          throw new Error(`vibisual:copy-hook-handler failed copying ${from} -> ${to}: ${(err as Error).message}`);
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    // externalizeDepsPlugin 은 desktop 의 직접 dependencies 를 외부화한다. exclude: @vibisual/* 는 전부 번들에 포함(CJS main 은 ESM dist 를 require 불가 — 목록은 WORKSPACE_PACKAGES).
    // include 없음: express/cors/ws/multer/chokidar 등 server 전이 의존성은 desktop/node_modules 에 없어 외부화하면 안 된다(Rollup 이 번들에 포함).
    // light-my-request/ws/@runonflux/nat-upnp/selfsigned(§4 모바일 웹 접속)는 desktop 직접 의존성이라 외부화돼 런타임에 풀린다. electron 은 electron-vite 가 자동 외부화.
    plugins: [
      externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES }),
      copyHookHandlerPlugin(),
    ],
    build: {
      // §3.7 · §9 「시작 화면(스플래시)」 — 입구는 가벼운 시작 진입점이다. 그것이 스플래시를 먼저 띄운 뒤
      //   `import('./index')` 로 본체(서버 코어 전부)를 읽으므로 본체는 별도 청크로 나뉜다. 출력 이름은 그대로
      //   `index.cjs` — package.json `main` 과 설치본이 가리키는 자리가 바뀌지 않는다.
      lib: { entry: resolve(__dirname, 'src/main/bootstrap.ts'), formats: ['cjs'] },
      rollupOptions: {
        output: { entryFileNames: 'index.cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // preload 는 CJS(.cjs)로 emit. ESM preload(.mjs)는 Electron 에서 window.api 노출이
      // 불안정. .cjs 확장자라 package.json "type":"module" 과 무관하게 CJS 로 로드된다.
      // §3.7 「시작 화면」 — 스플래시 창 전용 preload(`splash.cjs`)를 함께 낸다. 샌드박스 preload 라 다른 파일을
      //   require 할 수 없다 — 둘이 나눠 쓰는 모듈이 생기면 공유 청크가 생겨 스플래시가 깨진다(splash.ts 는 electron 만 부른다).
      lib: {
        entry: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          splash: resolve(__dirname, 'src/preload/splash.ts'),
        },
        formats: ['cjs'],
      },
      rollupOptions: { output: { entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: CLIENT_ROOT,
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(CLIENT_ROOT, 'index.html'),
      },
    },
  },
});
