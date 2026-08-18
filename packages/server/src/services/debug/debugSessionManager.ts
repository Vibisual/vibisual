/**
 * §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층의 심장.
 *
 * **화면은 어느 백엔드로 붙었는지 몰라야 한다.** 그 규율을 지키는 자리가 여기다 — CDP(Node
 * 내장 인스펙터)와 DAP(남의 어댑터)의 서로 다른 응답을 `DebugStackFrame`·`DebugScope`·
 * `DebugVariable` 한 벌로 정규화해 올린다. 런타임이 하나 늘어도 UI 는 한 줄도 안 바뀐다.
 *
 * 연결을 **서버가 소유하는** 이유는 단순하다: 소켓과 자식 프로세스는 브라우저가 못 연다.
 * 클라는 REST 로 명령하고 `debug_event` WS 로 결과를 받는다(새 통신 레일 ❌ — §4 broadcast 재사용).
 *
 * 영속 미관여 — 세션은 프로세스 수명이다. 저장되는 것은 중단점뿐이고 그건 클라가
 * `ProjectCheckpoint.debugBreakpoints` 로 들고 있다가 세션이 열릴 때 여기로 밀어 넣는다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  DEBUG_ADAPTER_PORT_BASE,
  DEBUG_ADAPTER_PORT_TOKEN,
  DEBUG_ADAPTER_READY_TIMEOUT_MS,
  DEBUG_PORT_SCAN_MAX,
  findDebugAdapter,
} from '@vibisual/shared';
import type {
  DebugAdapterSpec,
  DebugBreakpoint,
  DebugEventPayload,
  DebugScope,
  DebugSessionState,
  DebugStackFrame,
  DebugStoppedReason,
  DebugVariable,
  RunRuntime,
  WSMessage,
} from '@vibisual/shared';

import { broadcast } from '../../broadcastBus.js';
import { logger } from '../../logger.js';
import { isPortAlive } from '../processChecker.js';
import { CdpClient } from './cdpClient.js';
import { DapClient } from './dapClient.js';

/** 세션 하나가 들고 있는 것 — 공개 상태(`state`)와 백엔드별 살림살이. */
interface SessionRuntime {
  state: DebugSessionState;
  cdp?: CdpClient;
  dap?: DapClient;
  /** DAP 어댑터 자식 프로세스(stdio·tcp 모두 우리가 띄운다). */
  child?: ChildProcess;
  /** DAP TCP transport 의 소켓. */
  socket?: net.Socket;
  /** CDP: scriptId → 파일 URL(멈춘 프레임의 파일 이름을 되찾는 유일한 길). */
  scriptUrls: Map<string, string>;
  /** CDP: 우리가 발급한 정수 핸들 → objectId(DAP 의 variablesReference 와 축을 맞춘다). */
  cdpObjects: Map<number, string>;
  cdpObjectSeq: number;
  /** CDP: frameId → 그 프레임의 callFrameId + 스코프 목록. */
  cdpFrames: Map<number, { callFrameId: string; scopes: { name: string; objectId?: string }[] }>;
  breakpoints: DebugBreakpoint[];
}

/** 세션을 시작할 때 받는 것. `port` 는 디버기 포트, `pid` 는 네이티브 붙이기용. */
export interface StartDebugSessionOptions {
  runId: string;
  projectPath: string;
  runtime: RunRuntime;
  port?: number;
  pid?: number;
  /**
   * 붙자마자 걸어 둘 중단점.
   *
   * **순서가 중요하다** — `--inspect-brk`·`suspend=y` 로 멈춰 선 프로세스는 우리가 풀어 줘야
   * 비로소 달리기 시작하는데, 그전에 중단점을 걸어 두지 않으면 **시작 코드의 중단점을 통째로
   * 놓친다**(그 줄은 이미 지나간 뒤가 된다). 그래서 붙기 절차는 항상
   * `연결 → 중단점 → 풀어 주기` 세 단계다.
   */
  breakpoints?: DebugBreakpoint[];
}

/** 스텝 조작 — 화면 버튼 하나가 이 중 하나로 온다. */
export type DebugControlAction = 'continue' | 'pause' | 'stepOver' | 'stepIn' | 'stepOut';

/** 경로를 중단점 키로 정규화한다 — OS 구분자 차이로 같은 파일이 둘로 갈리지 않게. */
export function normalizeBreakpointFile(projectPath: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(projectPath, file);
  return path.relative(projectPath, abs).split(path.sep).join('/');
}

/** 중단점의 상대 경로를 다시 절대 경로로 편다. */
function toAbsolute(projectPath: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(projectPath, file);
}

/** DAP `stopped.reason` / CDP `Debugger.paused.reason` → 우리 어휘. */
function toStoppedReason(raw: unknown): DebugStoppedReason {
  const r = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (r.includes('breakpoint')) return 'breakpoint';
  if (r.includes('step')) return 'step';
  if (r.includes('exception') || r === 'promiserejection') return 'exception';
  if (r === 'pause' || r === 'paused') return 'pause';
  if (r === 'entry' || r === 'debugcommand') return 'entry';
  return 'other';
}

class DebugSessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private seq = 0;

  /** 지금 살아 있는 세션들 — 클라가 부팅·재접속 때 한 번 받아 간다. */
  list(): DebugSessionState[] {
    return [...this.sessions.values()].map((s) => s.state);
  }

  get(sessionId: string): DebugSessionState | null {
    return this.sessions.get(sessionId)?.state ?? null;
  }

  /** 같은 실행(runId)에 이미 붙어 있으면 그 세션을 돌려준다(중복 연결 방지). */
  findByRun(runId: string): DebugSessionState | null {
    for (const s of this.sessions.values()) {
      if (s.state.runId === runId && s.state.status !== 'ended') return s.state;
    }
    return null;
  }

  /**
   * 디버기에 붙는다. 실패하면 **그 사유를 그대로** 던진다 — "어댑터가 없다" 와 "포트가 안 열렸다"
   * 는 사용자가 할 일이 다르다.
   */
  async start(opts: StartDebugSessionOptions): Promise<DebugSessionState> {
    const existing = this.findByRun(opts.runId);
    if (existing) return existing;

    const spec = findDebugAdapter(opts.runtime);
    if (!spec) throw new Error('no-adapter-for-runtime');
    if (spec.backend === 'delegated') throw new Error('delegated-runtime');

    const sessionId = `dbg-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    const runtime: SessionRuntime = {
      state: {
        sessionId,
        runId: opts.runId,
        projectPath: opts.projectPath,
        runtime: opts.runtime,
        backend: spec.backend,
        status: 'connecting',
        ...(opts.port ? { port: opts.port } : {}),
        startedAt: Date.now(),
      },
      scriptUrls: new Map(),
      cdpObjects: new Map(),
      cdpObjectSeq: 1000,
      cdpFrames: new Map(),
      breakpoints: [],
    };
    this.sessions.set(sessionId, runtime);
    this.push(runtime, 'state');

    try {
      // ① 연결
      if (spec.backend === 'cdp') await this.connectCdp(runtime, opts);
      else await this.connectDap(runtime, spec, opts);
      // ② 중단점 — 반드시 ③ 앞에서. 뒤로 가면 시작 코드의 중단점을 놓친다.
      if (opts.breakpoints && opts.breakpoints.length > 0) {
        await this.setBreakpoints(sessionId, opts.breakpoints);
      }
      // ③ 멈춰 서 있던 프로세스를 풀어 준다.
      await this.finalizeStart(runtime);
      runtime.state.status = 'running';
      this.push(runtime, 'state');
      return runtime.state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runtime.state.status = 'error';
      runtime.state.error = message;
      this.push(runtime, 'state');
      this.teardown(sessionId);
      throw err;
    }
  }

  /** 세션을 끊는다(디버기는 계속 달린다 — 죽이는 것은 실행 런처의 [정지] 몫이다). */
  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      if (s.dap) await s.dap.request('disconnect', { terminateDebuggee: false }).catch(() => undefined);
      if (s.cdp) await s.cdp.send('Debugger.disable').catch(() => undefined);
    } finally {
      s.state.status = 'ended';
      this.push(s, 'terminated');
      this.teardown(sessionId);
    }
  }

  /**
   * 중단점 전체를 밀어 넣는다(부분 갱신 ❌ — DAP `setBreakpoints` 가 **파일 단위 전량 교체**라
   * 그 축에 맞춘다). 응답으로 실제 걸렸는지(`verified`)를 받아 화면이 흐리게/진하게 그린다.
   */
  async setBreakpoints(sessionId: string, breakpoints: DebugBreakpoint[]): Promise<DebugBreakpoint[]> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no-session');
    s.breakpoints = breakpoints;

    const byFile = new Map<string, DebugBreakpoint[]>();
    for (const bp of breakpoints) {
      if (!bp.enabled) continue;
      const list = byFile.get(bp.file) ?? [];
      list.push(bp);
      byFile.set(bp.file, list);
    }

    const verified: DebugBreakpoint[] = [];
    for (const [file, list] of byFile) {
      const abs = toAbsolute(s.state.projectPath, file);
      try {
        if (s.cdp) verified.push(...(await this.setCdpBreakpoints(s, file, abs, list)));
        else if (s.dap) verified.push(...(await this.setDapBreakpoints(s, file, abs, list)));
      } catch (err) {
        logger.warn(`[debug] setBreakpoints failed (${file}): ${err instanceof Error ? err.message : String(err)}`);
        verified.push(...list.map((bp) => ({ ...bp, verified: false })));
      }
    }
    return verified;
  }

  /** 계속·일시정지·스텝 — 백엔드마다 이름만 다르고 뜻은 같다. */
  async control(sessionId: string, action: DebugControlAction): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no-session');

    if (s.cdp) {
      const method =
        action === 'continue' ? 'Debugger.resume'
        : action === 'pause' ? 'Debugger.pause'
        : action === 'stepOver' ? 'Debugger.stepOver'
        : action === 'stepIn' ? 'Debugger.stepInto'
        : 'Debugger.stepOut';
      await s.cdp.send(method);
    } else if (s.dap) {
      const threadId = s.state.threadId ?? 1;
      const command =
        action === 'continue' ? 'continue'
        : action === 'pause' ? 'pause'
        : action === 'stepOver' ? 'next'
        : action === 'stepIn' ? 'stepIn'
        : 'stepOut';
      await s.dap.request(command, { threadId });
    }

    if (action !== 'pause') {
      s.state.status = 'running';
      delete s.state.frames;
      delete s.state.stoppedReason;
      s.cdpFrames.clear();
      s.cdpObjects.clear();
      this.push(s, 'state');
    }
  }

  /** 프레임 하나의 변수 묶음(Local·Closure·Global …). */
  async scopes(sessionId: string, frameId: number): Promise<DebugScope[]> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no-session');

    if (s.cdp) {
      const frame = s.cdpFrames.get(frameId);
      if (!frame) return [];
      return frame.scopes
        .filter((sc) => !!sc.objectId)
        .map((sc) => ({
          name: sc.name,
          variablesReference: this.cdpHandle(s, sc.objectId as string),
        }));
    }
    if (s.dap) {
      const body = await s.dap.request('scopes', { frameId });
      const raw = Array.isArray(body['scopes']) ? (body['scopes'] as Record<string, unknown>[]) : [];
      return raw.map((sc) => ({
        name: String(sc['name'] ?? ''),
        variablesReference: Number(sc['variablesReference'] ?? 0),
        ...(sc['expensive'] === true ? { expensive: true } : {}),
      }));
    }
    return [];
  }

  /** 묶음 하나를 펼친다. 자식이 또 펼쳐지면 그 핸들이 함께 온다. */
  async variables(sessionId: string, reference: number): Promise<DebugVariable[]> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no-session');

    if (s.cdp) {
      const objectId = s.cdpObjects.get(reference);
      if (!objectId) return [];
      const body = await s.cdp.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        generatePreview: false,
      });
      const props = Array.isArray(body['result']) ? (body['result'] as Record<string, unknown>[]) : [];
      return props.map((p) => {
        const value = (p['value'] ?? {}) as Record<string, unknown>;
        const childId = typeof value['objectId'] === 'string' ? (value['objectId'] as string) : null;
        return {
          name: String(p['name'] ?? ''),
          value: cdpValueToText(value),
          ...(typeof value['type'] === 'string' ? { type: value['type'] as string } : {}),
          variablesReference: childId ? this.cdpHandle(s, childId) : 0,
        };
      });
    }
    if (s.dap) {
      const body = await s.dap.request('variables', { variablesReference: reference });
      const raw = Array.isArray(body['variables']) ? (body['variables'] as Record<string, unknown>[]) : [];
      return raw.map((v) => ({
        name: String(v['name'] ?? ''),
        value: String(v['value'] ?? ''),
        ...(typeof v['type'] === 'string' ? { type: v['type'] as string } : {}),
        variablesReference: Number(v['variablesReference'] ?? 0),
      }));
    }
    return [];
  }

  /** 멈춘 자리에서 식을 계산한다(워치·즉석 확인). */
  async evaluate(sessionId: string, expression: string, frameId?: number): Promise<DebugVariable> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('no-session');

    if (s.cdp) {
      const frame = frameId === undefined ? undefined : s.cdpFrames.get(frameId);
      const body = frame
        ? await s.cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression })
        : await s.cdp.send('Runtime.evaluate', { expression });
      const value = (body['result'] ?? {}) as Record<string, unknown>;
      const childId = typeof value['objectId'] === 'string' ? (value['objectId'] as string) : null;
      return {
        name: expression,
        value: cdpValueToText(value),
        ...(typeof value['type'] === 'string' ? { type: value['type'] as string } : {}),
        variablesReference: childId ? this.cdpHandle(s, childId) : 0,
      };
    }
    if (s.dap) {
      const body = await s.dap.request('evaluate', {
        expression,
        ...(frameId === undefined ? {} : { frameId }),
        context: 'watch',
      });
      return {
        name: expression,
        value: String(body['result'] ?? ''),
        ...(typeof body['type'] === 'string' ? { type: body['type'] as string } : {}),
        variablesReference: Number(body['variablesReference'] ?? 0),
      };
    }
    throw new Error('no-backend');
  }

  /** 프로세스 종료 등으로 서버가 접히기 전에 전부 정리. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.teardown(id);
  }

  // ─── CDP ────────────────────────────────────────────────────────────────

  private async connectCdp(s: SessionRuntime, opts: StartDebugSessionOptions): Promise<void> {
    if (!opts.port) throw new Error('port-required');
    const client = new CdpClient(
      (event) => this.onCdpEvent(s, event),
      (reason) => this.onBackendClosed(s, reason),
    );
    s.cdp = client;
    await client.connect(opts.port);
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');
    // 여기서 풀어 주지 않는다 — 중단점을 건 **뒤에** `finalizeStart` 가 푼다(위 ②③ 순서).
  }

  /**
   * 붙기 절차의 마지막 단계 — 멈춰 서 있던 프로세스를 달리게 한다.
   * CDP 는 `Runtime.runIfWaitingForDebugger`, DAP 는 `configurationDone` 이 같은 뜻이다.
   */
  private async finalizeStart(s: SessionRuntime): Promise<void> {
    if (s.cdp) {
      await s.cdp.send('Runtime.runIfWaitingForDebugger').catch(() => undefined);
      return;
    }
    if (s.dap) {
      await s.dap.request('configurationDone').catch(() => undefined);
    }
  }

  private onCdpEvent(s: SessionRuntime, event: { method: string; params?: Record<string, unknown> }): void {
    const params = event.params ?? {};
    if (event.method === 'Debugger.scriptParsed') {
      const scriptId = typeof params['scriptId'] === 'string' ? params['scriptId'] : null;
      const url = typeof params['url'] === 'string' ? params['url'] : '';
      if (scriptId && url) s.scriptUrls.set(scriptId, url);
      return;
    }
    if (event.method === 'Debugger.paused') {
      const callFrames = Array.isArray(params['callFrames'])
        ? (params['callFrames'] as Record<string, unknown>[])
        : [];
      s.cdpFrames.clear();
      s.cdpObjects.clear();
      const frames: DebugStackFrame[] = callFrames.map((f, index) => {
        const location = (f['location'] ?? {}) as Record<string, unknown>;
        const scriptId = typeof location['scriptId'] === 'string' ? (location['scriptId'] as string) : '';
        const url = s.scriptUrls.get(scriptId) ?? '';
        const scopeChain = Array.isArray(f['scopeChain']) ? (f['scopeChain'] as Record<string, unknown>[]) : [];
        s.cdpFrames.set(index, {
          callFrameId: String(f['callFrameId'] ?? ''),
          scopes: scopeChain.map((sc) => {
            const obj = (sc['object'] ?? {}) as Record<string, unknown>;
            return {
              name: String(sc['type'] ?? 'scope'),
              ...(typeof obj['objectId'] === 'string' ? { objectId: obj['objectId'] as string } : {}),
            };
          }),
        });
        const file = urlToPathOrUndefined(url);
        return {
          id: index,
          name: String(f['functionName'] ?? '(anonymous)') || '(anonymous)',
          ...(file ? { file } : {}),
          // CDP 는 0-based, 우리는 에디터와 같은 1-based 로 통일한다.
          line: Number(location['lineNumber'] ?? 0) + 1,
          column: Number(location['columnNumber'] ?? 0) + 1,
        };
      });
      s.state.status = 'paused';
      s.state.threadId = 1;
      s.state.stoppedReason = toStoppedReason(params['reason']);
      s.state.frames = frames;
      this.push(s, 'state');
      return;
    }
    if (event.method === 'Debugger.resumed') {
      s.state.status = 'running';
      delete s.state.frames;
      delete s.state.stoppedReason;
      this.push(s, 'state');
      return;
    }
    if (event.method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params['args']) ? (params['args'] as Record<string, unknown>[]) : [];
      const text = args.map((a) => cdpValueToText(a)).join(' ');
      if (text) this.pushOutput(s, `${text}\n`, 'console');
    }
  }

  private async setCdpBreakpoints(
    s: SessionRuntime,
    file: string,
    abs: string,
    list: DebugBreakpoint[],
  ): Promise<DebugBreakpoint[]> {
    const client = s.cdp;
    if (!client) return list.map((bp) => ({ ...bp, verified: false }));
    const url = pathToFileURL(abs).href;
    const out: DebugBreakpoint[] = [];
    for (const bp of list) {
      try {
        const body = await client.send('Debugger.setBreakpointByUrl', {
          lineNumber: bp.line - 1,
          url,
          columnNumber: 0,
        });
        const locations = Array.isArray(body['locations']) ? body['locations'] : [];
        out.push({ ...bp, file, verified: locations.length > 0 });
      } catch {
        out.push({ ...bp, file, verified: false });
      }
    }
    return out;
  }

  /** CDP 의 objectId(문자열)를 DAP 와 같은 정수 축으로 바꿔 준다 — 화면은 하나만 알면 된다. */
  private cdpHandle(s: SessionRuntime, objectId: string): number {
    for (const [handle, id] of s.cdpObjects) if (id === objectId) return handle;
    const handle = s.cdpObjectSeq++;
    s.cdpObjects.set(handle, objectId);
    return handle;
  }

  // ─── DAP ────────────────────────────────────────────────────────────────

  private async connectDap(
    s: SessionRuntime,
    spec: DebugAdapterSpec,
    opts: StartDebugSessionOptions,
  ): Promise<void> {
    if (!spec.adapter) throw new Error('adapter-not-configured');

    if (spec.adapter.transport === 'stdio') {
      const child = spawn(spec.adapter.command, spec.adapter.args, {
        cwd: opts.projectPath,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      s.child = child;
      const client = new DapClient(
        (payload) => { child.stdin?.write(payload); },
        (event) => this.onDapEvent(s, event),
      );
      s.dap = client;
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => client.feed(chunk));
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => this.pushOutput(s, chunk, 'stderr'));
      child.on('error', (err) => this.onBackendClosed(s, err.message));
      child.on('exit', () => this.onBackendClosed(s, 'adapter-exited'));
    } else {
      const adapterPort = await findFreePort(DEBUG_ADAPTER_PORT_BASE);
      const args = spec.adapter.args.map((a) => a.split(DEBUG_ADAPTER_PORT_TOKEN).join(String(adapterPort)));
      const child = spawn(spec.adapter.command, args, {
        cwd: opts.projectPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      s.child = child;
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => this.pushOutput(s, chunk, 'stderr'));
      child.on('error', (err) => this.onBackendClosed(s, err.message));
      child.on('exit', () => this.onBackendClosed(s, 'adapter-exited'));

      const socket = await waitForAdapterSocket(adapterPort);
      s.socket = socket;
      const client = new DapClient(
        (payload) => { socket.write(payload); },
        (event) => this.onDapEvent(s, event),
      );
      s.dap = client;
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => client.feed(chunk));
      socket.on('close', () => this.onBackendClosed(s, 'adapter-socket-closed'));
    }

    const client = s.dap;
    if (!client) throw new Error('adapter-not-started');

    await client.request('initialize', {
      clientID: 'vibisual',
      adapterID: opts.runtime,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    // 우리는 **이미 떠 있는 프로세스에 붙는다**(③ 이 그렇게 띄웠다) — launch 는 쓰지 않는다.
    const attachArgs: Record<string, unknown> =
      spec.attach === 'pid'
        ? { processId: opts.pid, request: 'attach' }
        : { connect: { host: '127.0.0.1', port: opts.port }, request: 'attach' };
    if (spec.attach === 'pid' && !opts.pid) throw new Error('pid-required');
    if (spec.attach === 'port' && !opts.port) throw new Error('port-required');
    // DAP 규격의 순서도 같다: initialize → attach → **setBreakpoints** → configurationDone.
    // 그 마지막 한 걸음은 `finalizeStart` 가 중단점을 건 뒤에 밟는다.
    await client.request('attach', { ...attachArgs, cwd: opts.projectPath });
  }

  private onDapEvent(s: SessionRuntime, event: { event: string; body?: Record<string, unknown> }): void {
    const body = event.body ?? {};
    if (event.event === 'stopped') {
      s.state.status = 'paused';
      s.state.stoppedReason = toStoppedReason(body['reason']);
      s.state.threadId = Number(body['threadId'] ?? 1);
      void this.loadDapStack(s);
      return;
    }
    if (event.event === 'continued') {
      s.state.status = 'running';
      delete s.state.frames;
      delete s.state.stoppedReason;
      this.push(s, 'state');
      return;
    }
    if (event.event === 'output') {
      const text = typeof body['output'] === 'string' ? body['output'] : '';
      const category = body['category'] === 'stderr' ? 'stderr' : 'stdout';
      if (text) this.pushOutput(s, text, category);
      return;
    }
    if (event.event === 'terminated' || event.event === 'exited') {
      this.onBackendClosed(s, 'debuggee-terminated');
    }
  }

  private async loadDapStack(s: SessionRuntime): Promise<void> {
    const client = s.dap;
    if (!client) return;
    try {
      const body = await client.request('stackTrace', {
        threadId: s.state.threadId ?? 1,
        startFrame: 0,
        levels: 40,
      });
      const raw = Array.isArray(body['stackFrames']) ? (body['stackFrames'] as Record<string, unknown>[]) : [];
      s.state.frames = raw.map((f) => {
        const source = (f['source'] ?? {}) as Record<string, unknown>;
        const file = typeof source['path'] === 'string' ? (source['path'] as string) : undefined;
        return {
          id: Number(f['id'] ?? 0),
          name: String(f['name'] ?? ''),
          ...(file ? { file } : {}),
          line: Number(f['line'] ?? 0),
          column: Number(f['column'] ?? 0),
        };
      });
    } catch (err) {
      logger.warn(`[debug] stackTrace failed: ${err instanceof Error ? err.message : String(err)}`);
      s.state.frames = [];
    }
    this.push(s, 'state');
  }

  private async setDapBreakpoints(
    s: SessionRuntime,
    file: string,
    abs: string,
    list: DebugBreakpoint[],
  ): Promise<DebugBreakpoint[]> {
    const client = s.dap;
    if (!client) return list.map((bp) => ({ ...bp, verified: false }));
    const body = await client.request('setBreakpoints', {
      source: { path: abs, name: path.basename(abs) },
      breakpoints: list.map((bp) => ({ line: bp.line })),
    });
    const raw = Array.isArray(body['breakpoints']) ? (body['breakpoints'] as Record<string, unknown>[]) : [];
    return list.map((bp, i) => ({
      ...bp,
      file,
      verified: raw[i]?.['verified'] === true,
    }));
  }

  // ─── 공통 ───────────────────────────────────────────────────────────────

  private onBackendClosed(s: SessionRuntime, reason: string): void {
    if (s.state.status === 'ended') return;
    s.state.status = 'ended';
    s.state.error = reason;
    this.push(s, 'terminated');
    this.teardown(s.state.sessionId);
  }

  private teardown(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    s.cdp?.dispose('session-closed');
    s.dap?.dispose('session-closed');
    if (s.socket) { try { s.socket.destroy(); } catch { /* 이미 닫힘 */ } }
    if (s.child) { try { s.child.kill(); } catch { /* 이미 죽음 */ } }
  }

  private push(s: SessionRuntime, kind: DebugEventPayload['kind']): void {
    const payload: DebugEventPayload = {
      sessionId: s.state.sessionId,
      kind,
      // 상태는 **복사해서** 보낸다 — 우리 쪽 객체를 그대로 넘기면 이후 변경이 전선 밖에서 보인다.
      state: { ...s.state, ...(s.state.frames ? { frames: [...s.state.frames] } : {}) },
    };
    const message: WSMessage = { type: 'debug_event', timestamp: Date.now(), payload };
    broadcast(message);
  }

  private pushOutput(s: SessionRuntime, text: string, category: 'stdout' | 'stderr' | 'console'): void {
    const payload: DebugEventPayload = {
      sessionId: s.state.sessionId,
      kind: 'output',
      output: text,
      category,
    };
    broadcast({ type: 'debug_event', timestamp: Date.now(), payload });
  }
}

/** CDP `RemoteObject` → 사람이 읽는 한 줄. */
function cdpValueToText(value: Record<string, unknown>): string {
  if (typeof value['unserializableValue'] === 'string') return value['unserializableValue'] as string;
  if ('value' in value) {
    const v = value['value'];
    if (typeof v === 'string') return v;
    if (v === null) return 'null';
    if (v !== undefined) return String(v);
  }
  if (typeof value['description'] === 'string') return value['description'] as string;
  if (typeof value['type'] === 'string') return value['type'] as string;
  return '';
}

/** `file://` URL 이면 경로로, 아니면 undefined(내장 스크립트 등 — 열 파일이 없다). */
function urlToPathOrUndefined(url: string): string | undefined {
  if (!url.startsWith('file://')) return undefined;
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

/**
 * 비어 있는 포트를 고른다. **상한(`DEBUG_PORT_SCAN_MAX`)을 지킨다** — 종전 클라이언트의 포트
 * 고르기는 상한 없이 while 로 올리기만 해서, 상수만 export 되고 아무도 쓰지 않았다.
 */
export async function findFreePort(base: number): Promise<number> {
  for (let i = 0; i < DEBUG_PORT_SCAN_MAX; i += 1) {
    const port = base + i;
    if (!(await isPortAlive(port))) return port;
  }
  throw new Error('no-free-port');
}

/** TCP 어댑터가 뜰 때까지 짧게 재시도하며 붙는다. */
function waitForAdapterSocket(port: number): Promise<net.Socket> {
  const deadline = Date.now() + DEBUG_ADAPTER_READY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => resolve(socket));
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error('adapter-not-listening'));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

/** 서버 전역 단일 인스턴스 — 세션 레지스트리가 둘이면 화면이 둘로 갈린다. */
export const debugSessionManager = new DebugSessionManager();
