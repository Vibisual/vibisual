import { resolve, dirname } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// electron-vite (preview) 가 Electron 을 spawn 할 때 ELECTRON_RUN_AS_NODE 를 물려주면
// electron.exe 가 일반 Node 로 동작한다(process.type=undefined, require('electron')
// 가 API 가 아닌 경로 문자열 → electron.app undefined → 모듈 로드 크래시).
// VS Code 통합 터미널/확장 호스트 환경이 이 변수를 설정해 둘 수 있으므로, 설정 로드
// 시점(electron 을 spawn 하기 전)에 제거해 통합 앱이 진짜 Electron 앱으로 뜨게 한다.
delete process.env['ELECTRON_RUN_AS_NODE'];

// SCENARIO.md §3.7 — in-process 통합.
//  - main:    server 코어(@vibisual/server)를 같은 프로세스에서 직접 구동. child spawn 없음.
//             @vibisual/* 는 exclude 로 번들에 포함(CJS main 은 ESM dist 를 require 할 수 없음).
//             light-my-request 는 @vibisual/desktop 의 직접 의존성이므로 외부화해도 런타임에
//             node_modules 에서 resolve 된다. express/cors/ws 등 server 전이 의존성은 번들에
//             포함 — desktop/node_modules 에 없으므로 externalize 하면 런타임 require 실패.
//  - preload: contextBridge 로 window.api(IPC 채널) 노출.
//  - renderer: packages/client 의 React Flow UI 를 그대로 번들. UI 소스는 손대지 않고
//              transport 어댑터(packages/client/src/transport)만 IPC 로 라우팅.
//
// renderer 의 fetch/WebSocket 은 transport monkey-patch 가 window.api(IPC) 로 우회하므로
// dev 프록시가 필요 없다 — server 는 항상 main 프로세스 안에서 돈다.
const CLIENT_ROOT = resolve(__dirname, '../client');
const REPO_ROOT = resolve(__dirname, '../..');

// §3.6 v2.9 — Claude Code 글로벌 PreToolUse 훅이 실행할 핸들러 스크립트를
// 앱 리소스에 동봉. main 빌드 closeBundle 단계에서 <repo>/hooks/{handler.mjs, lib/serverUrl.mjs}
// 를 packages/desktop/out/hooks/{handler.mjs, lib/serverUrl.mjs} 로 복사.
// electron-builder `files: out/**` 가 패키지 빌드 시 자동 픽업, dev(`electron-vite preview`)도
// 동일 경로 사용. handler.mjs 는 `--server` argv 가 항상 주어져 resolver 가 안 돌지만
// `import { resolveServerUrl } from './lib/serverUrl.mjs'` static import 라
// lib 파일이 디스크에 있어야 모듈 로드가 성공한다(ERR_MODULE_NOT_FOUND 방지).
function copyHookHandlerPlugin() {
  const FILES = [
    { from: resolve(REPO_ROOT, 'hooks/handler.mjs'), to: resolve(__dirname, 'out/hooks/handler.mjs') },
    { from: resolve(REPO_ROOT, 'hooks/lib/serverUrl.mjs'), to: resolve(__dirname, 'out/hooks/lib/serverUrl.mjs') },
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
    // externalizeDepsPlugin 은 @vibisual/desktop 의 직접 dependencies 를 외부화한다.
    // exclude: @vibisual/* 워크스페이스 패키지는 번들에 포함(CJS main 은 ESM dist 를 require 불가).
    // include 없음: express/cors/ws/multer/chokidar 등 server 전이 의존성은 desktop/node_modules
    //   에 없으므로 외부화 금지 → Rollup 이 번들에 포함. light-my-request 는 desktop 직접 의존성
    //   → 외부화되어 런타임에 정상 resolve. electron 은 electron-vite 가 자동 외부화.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@vibisual/server', '@vibisual/shared', '@vibisual/client'],
      }),
      copyHookHandlerPlugin(),
    ],
    build: {
      lib: { entry: resolve(__dirname, 'src/main/index.ts'), formats: ['cjs'] },
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
      lib: { entry: resolve(__dirname, 'src/preload/index.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } },
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
