import { join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { app, shell, BrowserWindow, protocol } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { inject, type DispatchFunc } from 'light-my-request';
import type { Express } from 'express';
import { runServer, setBroadcastSink, setHookListenerPort, ensureClaudeHooksInstalled, recordDiagnostic } from '@vibisual/server';
import { setupIpc, type IpcHub } from './ipc';
import { loadSecrets } from './secrets';

// Vibisual desktop main — SCENARIO.md §3.7 (in-process 통합, 단일 프로세스).
//
// server 코어를 child 프로세스로 spawn 하지 않고 이 main 프로세스 안에서 직접 구동한다
// (`runServer()`). renderer↔server 는 Electron IPC 직결(ipc.ts) —
// localhost HTTP/WS 브리지 없음.
//
// 단 하나의 예외: Claude Code hook 과 커스텀 위임 엣지 dispatch 는 claude CLI 가 spawn 하는
// 외부 프로세스라 in-process 흡수(IPC)가 불가능하다. 그래서 main 은 127.0.0.1 loopback
// HTTP 리스너 하나를 띄워 /api/hook-event·/api/task-edges/dispatch·/health 만 받는다
// (renderer 브리지가 아니라 외부 claude 프로세스 ingress 전용 — §3.7 v2.8).

// §3.7 — iframe 서버 프리뷰용 커스텀 스킴 등록(app.ready 전 필수).
// renderer 는 file:// 로 로드되므로 <iframe src="/iframe-proxy/…"> 상대경로가
// file:///iframe-proxy/… 로 깨진다(fetch 몽키패치는 엘리먼트 로드를 못 가로챔).
// vibproxy:// 스킴이 main 의 protocol.handle 을 거쳐 in-process Express(iframe 프록시)에
// 합성 디스패치된다. standard=호스트/경로 파싱(iframe 내부 root-relative 링크 해석용).
protocol.registerSchemesAsPrivileged([
  { scheme: 'vibproxy', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let ipcHub: IpcHub | null = null;
let hookListener: HttpServer | null = null;

// Per-launch token for hook listener auth (item #7). Generated once at startup.
let hookToken: string = randomBytes(24).toString('hex');

export function getHookToken(): string {
  return hookToken;
}

// §4 v1.98 — main 프로세스 에러를 진단 로그(diagnosticService)에 적재 → DebugPanel 에 표시.
// record-and-continue: 비치명 uncaught 에러를 크래시 다이얼로그 대신 앱 안 패널로.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  recordDiagnostic('main', 'error', `uncaughtException: ${err.message}`, err.stack);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[main] unhandledRejection:', err);
  recordDiagnostic('main', 'error', `unhandledRejection: ${err.message}`, err.stack);
});

function createWindow(): void {
  // §3.7 v2.10 — 통합 앱 단일 타이틀바. Electron 네이티브 타이틀바를 숨기고(titleBarStyle: 'hidden')
  // React Header(`app-drag` 영역)가 그 자리에 타이틀바 역할을 한다. Windows 는 titleBarOverlay 가
  // 우상단에 네이티브 윈도우 컨트롤(min/max/close)을 오버레이로 깔아준다 — 헤더 우측의 `pr-36` 가
  // 그 오버레이 폭(=Windows 기본 138px)을 비워둔다. Mac 은 같은 설정이 트래픽 라이트를 자동 표기.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#030712',
    autoHideMenuBar: true,
    title: 'Vibisual',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // §3.7 v2.15 — Header `bg-[#334155]` (slate-700) 와 컬러 매치.
      color: '#334155',
      symbolColor: '#cbd5e1',
      height: 36,
    },
    // out/main/index.cjs → ../icon.{ico,png} (staged by electron.vite.config copy plugin).
    // On Windows, PNG icons render blurry in the taskbar/title bar; use the multi-size
    // .ico instead. macOS/Linux keep the PNG (ICO not supported there).
    icon: join(__dirname, '..', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      // preload 는 CJS(.cjs)로 빌드 — electron.vite.config.ts 참조.
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());

  // §3.7 v2.12 — `titleBarStyle: 'hidden'` + `titleBarOverlay` Windows 조합에서 간헐적으로
  // `ready-to-show` 가 안 떠 창이 영구 숨김 상태가 되는 회귀가 보고됨. 3초 fallback —
  // 그때까지 안 떴으면 강제 show. 정상 경우엔 이미 ready-to-show 가 처리해서 이 분기 no-op.
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[main] ready-to-show timeout — forcing window show()');
      mainWindow.show();
    }
  }, 3000);

  // renderer 치명 오류만 main stdout 으로 — preload 실패 / 페이지 로드 실패 / renderer 크래시.
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[main] preload-error ${preloadPath}:`, error);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] renderer did-fail-load code=${code} "${desc}" url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[main] renderer process gone: ${details.reason}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // §3.7 v2.2 — dev 모드 폐기. renderer 는 항상 디스크의 프로덕션 빌드 산출물에서 로드한다
  // (electron-vite preview·packaged 동일 경로). renderer dev 서버·ELECTRON_RENDERER_URL 분기 없음.
  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

/**
 * §3.7 — hook 전용 loopback HTTP 리스너.
 *
 * in-process 모델에서 유일하게 남는 프로세스 경계 — Claude Code hook 도, 커스텀 위임 엣지를
 * dispatch 하는 소스 커스텀 에이전트도 모두 claude CLI 가 spawn 하는 외부 프로세스라 renderer↔
 * server IPC 를 못 쓴다. 화이트리스트(/api/hook-event·/api/task-edges/dispatch·/health) 외
 * 경로는 404. `:0` 동적 포트 → §3.6 인스톨러가 그 포트를 ~/.claude/settings.json 에 기록하고,
 * server 코어는 setHookListenerPort() 로 같은 포트를 받아 dispatch curl URL 에 쓴다(§3.7 v2.8).
 *
 * 중요: 외부에서 온 **실제** IncomingMessage 를 Express app 에 직접 먹이지 않는다. body 만 읽어
 * light-my-request `inject` 로 재디스패치한다. light-my-request 는 Express 를 감지하면
 * `express.request` 프로토타입을 자기 Request 로 바꿔치기하는데(IPC 디스패치를 위해 필요),
 * 그 상태에서 실제 IncomingMessage 가 Express 를 거치면 socket close 시 `req.destroy` 가
 * light-my-request 의 것으로 풀려 크래시한다. 그 경로를 원천 차단 — 실제 req 는 Express 를
 * 절대 거치지 않고, Express 는 오직 light-my-request 요청만 받는다.
 */
async function startHookListener(expressApp: Express): Promise<number> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    // /health is public — health checks must not require auth.
    const isHealth = path === '/health';
    // dispatch 라우트는 외부 `claude` 자식 프로세스(서브에이전트 LLM) 가 호출자라
    // per-launch 토큰을 전달받을 채널이 없다. listener 가 127.0.0.1 에만 listen 하고
    // dispatch 핸들러 자체가 edgeId/target 등록 여부를 검증하므로(:3634-3643) 임의 호출
    // 차단은 이미 보장됨. 토큰 게이트는 hook 이벤트·permission-check·ask-user-question
    // 라우트에서만 유지하고 dispatch 만 면제. (회귀 픽스 — 토큰 도입 PR 이 dispatch
    // 송신측에 토큰 전달 채널을 추가하지 않아 401 로 영구 차단되던 것 해소.)
    const isDispatch = path === '/api/task-edges/dispatch';

    // All other whitelisted paths require the per-launch token (item #7).
    if (
      path !== '/health' &&
      path !== '/api/hook-event' &&
      path !== '/api/permission-check' &&
      path !== '/api/ask-user-question' &&
      path !== '/api/task-edges/dispatch'
    ) {
      res.statusCode = 404;
      res.end('Vibisual hook listener — only /api/hook-event, /api/permission-check, /api/task-edges/dispatch and /health are served here.');
      req.resume();
      return;
    }

    if (!isHealth && !isDispatch) {
      const incoming = req.headers['x-vibisual-hook-token'];
      if (incoming !== hookToken) {
        res.statusCode = 401;
        res.end('Unauthorized');
        req.resume();
        return;
      }
    }

    // §3.7 v2.8 — hook 수신 외에 커스텀 위임 엣지 dispatch 도 외부 claude 프로세스가 호출하는
    // 경로다(renderer↔server IPC 불가 → loopback 리스너 경유). dispatch 도 화이트리스트에 포함.
    // §3.7 v2.9 — `/api/permission-check` 추가. §5.3 #12-1 권한 승인 팝업의 동기 게이트로,
    // 외부 claude 프로세스가 PreToolUse 훅(node handler.mjs)을 통해 도달한다. 이전 3경로
    // 화이트리스트가 permission-check 를 404 로 막아 `permissionBroker` 모달이 안 떴음.
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', () => { try { res.statusCode = 400; res.end(); } catch { /* socket gone */ } });
    req.on('end', () => {
      void inject(expressApp as unknown as DispatchFunc, {
        method: (req.method ?? 'GET') as 'GET',
        url: req.url ?? path,
        headers: req.headers as Record<string, string | string[]>,
        payload: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      }).then((injected) => {
        res.statusCode = injected.statusCode;
        const ct = injected.headers['content-type'];
        if (typeof ct === 'string') res.setHeader('content-type', ct);
        res.end(injected.payload);
      }).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(`hook dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  });
  hookListener = server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

/**
 * §3.7 — `vibproxy://proxy/iframe-proxy/<host>/<path>` 요청을 in-process Express 의
 * iframe 프록시 핸들러로 합성 디스패치한다. renderer 의 <iframe> 엘리먼트 로드는
 * fetch 몽키패치로 가로챌 수 없어 이 프로토콜 핸들러가 유일한 경로다.
 *
 * - `/iframe-proxy/…` 경로만 처리(프록시된 페이지가 재작성한 root-relative 링크가 동일
 *   오리진으로 다시 들어온다). 그 외 경로는 404.
 * - 응답은 rawPayload(Buffer) 그대로 전달 — 이미지·폰트·JS 등 바이너리 무손실.
 * - 실제 IncomingMessage 가 아니라 light-my-request `inject`(plain 옵션)로 디스패치하므로
 *   startHookListener 주석의 req.destroy 크래시 경로와 무관하다.
 */
function registerIframeProxyProtocol(expressApp: Express): void {
  protocol.handle('vibproxy', async (request) => {
    let pathname: string;
    let search: string;
    try {
      const u = new URL(request.url);
      pathname = u.pathname;
      search = u.search;
    } catch {
      return new Response('bad vibproxy url', { status: 400 });
    }
    if (pathname !== '/iframe-proxy' && !pathname.startsWith('/iframe-proxy/')) {
      return new Response('not found', { status: 404 });
    }
    try {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const payload = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => { headers[k] = v; });
      const injected = await inject(expressApp as unknown as DispatchFunc, {
        method: (request.method ?? 'GET') as 'GET',
        url: pathname + search,
        headers,
        payload,
      });
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(injected.headers)) {
        if (v == null) continue;
        resHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      // 204/304/1xx 는 본문을 가질 수 없다 — Response 생성자가 throw 하므로 null 본문.
      const nullBody =
        injected.statusCode === 204 ||
        injected.statusCode === 304 ||
        (injected.statusCode >= 100 && injected.statusCode < 200);
      // Uint8Array is directly assignable to BodyInit — no cast needed.
      return new Response(nullBody ? null : new Uint8Array(injected.rawPayload), {
        status: injected.statusCode,
        statusText: injected.statusMessage ?? '',
        headers: resHeaders,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`iframe proxy dispatch failed: ${msg}`, { status: 502 });
    }
  });
}

async function bootBackend(): Promise<void> {
  // Secrets — in-process 모델이라 server 코어는 이 main 프로세스의 process.env 를 그대로 읽는다.
  //   dev      : Electron 을 띄운 셸 env 가 이미 process.env 에 있음(추가 작업 불필요).
  //   packaged : 셸 env 가 없으므로 app.getPath('userData')/secrets.json 을 읽어 머지한다.
  // 프로젝트 데이터(§3.5)는 영향 없음 — 여전히 <projectPath>/.vibisual.
  const secrets = loadSecrets();
  for (const [k, v] of Object.entries(secrets.env)) process.env[k] = v;
  if (secrets.source === 'userData') {
    console.log(`[main] merged ${Object.keys(secrets.env).length} secret(s) from ${secrets.path}`);
  }

  // broadcast sink — server 코어의 push 단일 창구를 모든 renderer 로 IPC 전송.
  // runServer 이전에 등록해야 부팅 중 push 가 유실되지 않는다.
  setBroadcastSink((msg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('vibisual:ws', msg);
    }
  });

  // server 코어를 in-process 구동 — HTTP listen / ws 없이 Express app 만 받는다.
  const handle = await runServer();

  // iframe 서버 프리뷰용 vibproxy:// 프로토콜 핸들러 등록(app.ready 이후이므로 여기서).
  registerIframeProxyProtocol(handle.app);

  // hook loopback 리스너 → §3.6 글로벌 훅 인스톨러로 그 포트를 등록.
  const hookPort = await startHookListener(handle.app);
  // §3.7 v2.8 — server 코어가 커스텀 위임 엣지 dispatch curl URL 을 이 포트로 조립하도록 주입.
  setHookListenerPort(hookPort);
  console.log(`[main] hook listener on http://127.0.0.1:${hookPort} (loopback — hook + edge dispatch ingest)`);

  // Item #1 — VIBISUAL_SKIP_HOOK_INSTALL opt-out gate.
  const skipInstall = process.env['VIBISUAL_SKIP_HOOK_INSTALL'];
  if (skipInstall === '1' || skipInstall === 'true') {
    console.log('[main] VIBISUAL_SKIP_HOOK_INSTALL is set — hooks NOT installed. Bubble map will receive no events until hooks are present in ~/.claude/settings.json.');
  } else if (process.env['VIBISUAL_HOME']?.trim()) {
    console.log('[main] hook installer skipped — VIBISUAL_HOME set (isolated instance)');
  } else {
    // §3.6 v2.9 — hook 명령은 `node <handlerPath> --server <loopbackUrl>`.
    // electron-vite 가 빌드 시 <repo>/hooks/handler.mjs 를 out/hooks/handler.mjs 로 복사하므로
    // out/main/index.cjs 기준 ../hooks/handler.mjs 가 dev·packaged 양쪽에서 같은 위치.
    const handlerPath = join(__dirname, '..', 'hooks', 'handler.mjs');
    const r = ensureClaudeHooksInstalled(hookPort, handlerPath, hookToken);
    if (r.error) {
      console.warn(`[main] hook installer failed: ${r.error.message} — 훅 이벤트가 0건일 수 있음`);
    } else if (r.installed) {
      console.warn(
        `[main] WROTE ~/.claude/settings.json (Vibisual-managed hook block). Backup at ${r.backupPath ?? '(no backup — file was new)'}. To opt out, set VIBISUAL_SKIP_HOOK_INSTALL=1 and remove the \`_vibisualManaged: true\` blocks from settings.json.`,
      );
    } else if (r.alreadyPresent) {
      console.log(`[main] hooks already up-to-date in ${r.settingsPath}`);
    }
  }

  ipcHub = setupIpc(handle.app);
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.vibisual.app');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  try {
    await bootBackend();
  } catch (err) {
    console.error('[main] backend boot failed:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Item #8 — await cleanup before exit to prevent socket leak on dev-cycle restarts.
// Double-fire guard via quitting flag.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();

  ipcHub?.stop();
  ipcHub = null;

  const listenerClose = hookListener
    ? new Promise<void>((resolve) => { hookListener!.close(() => resolve()); })
    : Promise.resolve();
  hookListener = null;

  Promise.all([listenerClose]).finally(() => app.exit(0));
});
