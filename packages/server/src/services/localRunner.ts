/**
 * localRunner.ts — §5.19 (D)(F) All Model 로컬 턴 러너.
 *
 * **우리가 턴 루프를 돈다.** 외부 CLI 를 빌리지 않고, 설치해 둔 `llama-server` 를 우리가
 * 띄우고 우리가 말을 건다. 그래서 화면·세션·중지·카드가 전부 기존 IDE 의 것을 그대로 쓴다.
 *
 * **엔진은 자식 프로세스로 격리한다.** 메인 프로세스가 곧 서버 코어라, 모델 로드 실패나
 * 메모리 부족이 앱 전체를 끌고 내려가면 안 된다.
 *
 * **자원은 한 벌뿐이다.** 클로드 버블은 무한히 병렬이지만 로컬 모델은 아니다 — 동시 로드
 * 상한을 두고, 넘으면 거절이 아니라 앞의 모델을 내리고 자리를 만든다. 유휴 모델은 스스로
 * 내려간다. 같은 모델을 문 버블들은 한 인스턴스를 공유한다.
 *
 * **대화 이력의 주인이 바뀐다.** claude 경로는 CLI 가 `--resume` 으로 들고 있지만 여기서는
 * 우리가 `messages[]` 를 들고 있어야 한다 — 세션 단위 파일로 남겨 앱을 껐다 켜도 이어진다.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  LOCAL_DEFAULT_CONTEXT_SIZE,
  LOCAL_DEFAULT_MAX_TOKENS,
  LOCAL_ENGINE_BOOT_TIMEOUT_MS,
  LOCAL_ENGINE_PORT_BASE,
  LOCAL_MODEL_IDLE_UNLOAD_MS,
  LOCAL_MODEL_MAX_LOADED,
  type StreamEventType,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { getEngineState } from './localEngineService.js';
import { findModel } from './localModelService.js';

/** 한 세션의 대화 한 줄. OpenAI 호환 스키마 그대로 — 엔진에 그대로 실어 보낸다. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── 대화 이력 (세션 단위 파일) ───

function historyDir(): string {
  return path.join(os.homedir(), '.vibisual', 'local-sessions');
}

function historyPath(subAgentId: string): string {
  const safe = subAgentId.replace(/[^\w.-]/g, '_');
  return path.join(historyDir(), `${safe}.json`);
}

function loadHistory(subAgentId: string): ChatMessage[] {
  try {
    const raw = fs.readFileSync(historyPath(subAgentId), 'utf8');
    const j = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveHistory(subAgentId: string, messages: ChatMessage[]): void {
  try {
    fs.mkdirSync(historyDir(), { recursive: true });
    fs.writeFileSync(historyPath(subAgentId), JSON.stringify(messages), 'utf8');
  } catch (err) {
    logger.warn(`[localRunner] history save failed for ${subAgentId}`, err);
  }
}

/** 세션을 지울 때 함께 지운다(버블이 사라졌는데 이력만 남을 이유가 없다). */
export function clearLocalHistory(subAgentId: string): void {
  try {
    fs.rmSync(historyPath(subAgentId), { force: true });
  } catch {
    /* 없으면 그만 */
  }
}

// ─── 모델 인스턴스 풀 ───

interface LoadedModel {
  modelId: string;
  modelPath: string;
  port: number;
  child: ChildProcess;
  lastUsedAt: number;
  /** 준비될 때까지 기다릴 약속. 여러 버블이 동시에 물어도 한 번만 띄운다. */
  ready: Promise<void>;
  /** 지금 이 인스턴스를 쓰고 있는 턴 수 — 0 이 아니면 내리지 않는다. */
  busy: number;
}

const loaded = new Map<string, LoadedModel>();

/** 지금 메모리에 올라가 있는 모델 id 들(§5.19 (F) 표시용). */
export function listLoadedModels(): string[] {
  return [...loaded.keys()];
}

async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 200; p += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port for local engine');
}

async function waitHealthy(port: number, child: ChildProcess, deadline: number): Promise<void> {
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`engine exited before ready (code=${String(child.exitCode)})`);
    }
    if (Date.now() > deadline) throw new Error('engine boot timeout');
    // 준비 판정은 한 엔드포인트에 걸지 않는다 — `/health` 는 `--help` 에 문서화돼 있지 않아
    //   빌드에 따라 사라질 수 있고(실측 b10502 의 --help 에 없다), 모델 로딩 중에는 503 을 준다.
    //   우리가 실제로 쓸 OpenAI 호환 표면(`/v1/models`)이 200 이면 그때가 진짜 준비된 때다.
    for (const probe of ['/health', '/v1/models']) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${probe}`);
        if (res.ok) return;
      } catch {
        /* 아직 안 떴다 */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

function unload(modelId: string): void {
  const m = loaded.get(modelId);
  if (!m) return;
  loaded.delete(modelId);
  try {
    m.child.kill();
  } catch {
    /* 이미 죽었으면 그만 */
  }
  logger.info(`[localRunner] unloaded ${modelId}`);
}

/** 전부 내린다(앱 종료 시). */
export function unloadAllLocalModels(): void {
  for (const id of [...loaded.keys()]) unload(id);
}

// 유휴 언로드 — 30초마다 훑어 오래 안 쓴 인스턴스를 내린다.
const idleTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, m] of loaded) {
    if (m.busy === 0 && now - m.lastUsedAt > LOCAL_MODEL_IDLE_UNLOAD_MS) unload(id);
  }
}, 30_000);
if (typeof idleTimer.unref === 'function') idleTimer.unref();

/**
 * 모델을 올려 둔 인스턴스를 얻는다. 이미 올라가 있으면 그대로 쓰고, 상한을 넘으면
 * 가장 오래 안 쓴 것을 내려 자리를 만든다.
 *
 * `-ngl` 사다리: 먼저 전부 GPU 로 올려 보고, 그 프로세스가 못 뜨면 CPU 로 떨어져 다시
 * 띄운다. 사용자 장비를 재지 않고도 "되면 빠르게, 안 되면 느리게라도" 가 성립하는 자리다.
 */
async function ensureLoaded(modelId: string, contextSize: number): Promise<LoadedModel> {
  const cur = loaded.get(modelId);
  if (cur) {
    await cur.ready;
    cur.lastUsedAt = Date.now();
    return cur;
  }

  const engine = getEngineState();
  if (!engine.installed || !engine.serverBin) throw new Error('local engine is not installed');
  const model = findModel(modelId);
  if (!model) throw new Error(`model not found: ${modelId}`);

  while (loaded.size >= LOCAL_MODEL_MAX_LOADED) {
    const victim = [...loaded.values()].filter((m) => m.busy === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!victim) throw new Error('all loaded models are busy');
    unload(victim.modelId);
  }

  const port = await freePort(LOCAL_ENGINE_PORT_BASE);
  const serverBin = engine.serverBin;

  const boot = async (gpuLayers: number): Promise<ChildProcess> => {
    const args = [
      '-m', model.path,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-c', String(contextSize),
      '-ngl', String(gpuLayers),
    ];
    logger.info(`[localRunner] booting ${model.name} port=${port} ngl=${gpuLayers}`);
    const child = spawn(serverBin, args, {
      cwd: path.dirname(serverBin),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s) logger.debug(`[llama-server] ${s.slice(0, 400)}`);
    });
    await waitHealthy(port, child, Date.now() + LOCAL_ENGINE_BOOT_TIMEOUT_MS);
    return child;
  };

  let resolveReady: () => void = () => undefined;
  let rejectReady: (e: Error) => void = () => undefined;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const placeholder: LoadedModel = {
    modelId,
    modelPath: model.path,
    port,
    child: null as unknown as ChildProcess,
    lastUsedAt: Date.now(),
    ready,
    busy: 0,
  };
  loaded.set(modelId, placeholder);

  try {
    let child: ChildProcess;
    try {
      child = await boot(999);
    } catch (err) {
      logger.warn(`[localRunner] GPU boot failed for ${model.name}, falling back to CPU`, err);
      child = await boot(0);
    }
    placeholder.child = child;
    child.on('close', () => {
      if (loaded.get(modelId) === placeholder) loaded.delete(modelId);
    });
    resolveReady();
    return placeholder;
  } catch (err) {
    loaded.delete(modelId);
    const e = err instanceof Error ? err : new Error(String(err));
    rejectReady(e);
    throw e;
  }
}

// ─── 턴 실행 ───

export interface LocalTurnArgs {
  subAgentId: string;
  /** 사용자가 이번 턴에 친 말. */
  prompt: string;
  modelId: string;
  /** 에이전트 규칙 등 — 대화 맨 앞의 system 한 줄. */
  systemPrompt?: string;
  contextSize?: number;
  temperature?: number;
  /** 스트림 한 조각이 나올 때마다. 화면은 이 이벤트만 보고 그린다. */
  onEvent: (eventType: StreamEventType, content: string) => void;
  /** 턴이 끝나면 한 번. `error` 가 있으면 실패. */
  onDone: (error?: string) => void;
}

/** 진행 중인 턴 — [중지]가 자식 kill 이 아니라 생성 중단이라 여기서 붙잡는다. */
const running = new Map<string, AbortController>();

/** §5.19 (D) — [중지]. 자식을 죽이지 않는다(모델은 다음 턴에 다시 쓴다). */
export function stopLocalTurn(subAgentId: string): boolean {
  const ac = running.get(subAgentId);
  if (!ac) return false;
  ac.abort();
  return true;
}

export function isLocalTurnRunning(subAgentId: string): boolean {
  return running.has(subAgentId);
}

/**
 * 한 턴을 돈다 — 이력을 싣고, 스트림을 받아 조각마다 `onEvent` 를 부르고, 끝에 이력을 저장한다.
 * 예외는 던지지 않는다(호출자는 `onDone(error)` 로만 판단하면 된다).
 */
export function runLocalTurn(args: LocalTurnArgs): void {
  const { subAgentId, prompt, modelId, onEvent, onDone } = args;
  const contextSize = args.contextSize && args.contextSize > 0 ? args.contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;

  const ac = new AbortController();
  running.set(subAgentId, ac);

  void (async (): Promise<void> => {
    let assistant = '';
    let inst: LoadedModel | null = null;
    try {
      inst = await ensureLoaded(modelId, contextSize);
      inst.busy += 1;
      inst.lastUsedAt = Date.now();

      const history = loadHistory(subAgentId);
      const messages: ChatMessage[] = [];
      const sys = args.systemPrompt?.trim();
      if (sys) messages.push({ role: 'system', content: sys });
      messages.push(...history, { role: 'user', content: prompt });

      const body: Record<string, unknown> = {
        messages,
        stream: true,
        max_tokens: LOCAL_DEFAULT_MAX_TOKENS,
      };
      if (typeof args.temperature === 'number') body['temperature'] = args.temperature;

      const res = await fetch(`http://127.0.0.1:${inst.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`engine responded ${res.status}`);

      // SSE — `data: {...}` 줄 단위. `[DONE]` 이 끝 신호다.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const piece = j.choices?.[0]?.delta?.content ?? '';
            if (piece) {
              assistant += piece;
              onEvent('text', piece);
            }
          } catch {
            /* 조각난 줄은 다음 청크에서 이어진다 */
          }
        }
      }

      inst.lastUsedAt = Date.now();

      saveHistory(subAgentId, [...loadHistory(subAgentId), { role: 'user', content: prompt }, { role: 'assistant', content: assistant }]);
      onEvent('result', assistant);
      onDone();
    } catch (err) {
      const aborted = ac.signal.aborted;
      if (aborted) {
        // 중지는 실패가 아니다 — 여기까지 나온 말은 이력에 남겨 다음 턴이 이어지게 한다.
        if (assistant) {
          saveHistory(subAgentId, [...loadHistory(subAgentId), { role: 'user', content: prompt }, { role: 'assistant', content: assistant }]);
        }
        onDone();
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[localRunner] turn failed for ${subAgentId}`, err);
        onEvent('error', msg);
        onDone(msg);
      }
    } finally {
      running.delete(subAgentId);
      if (inst) inst.busy = Math.max(0, inst.busy - 1);
    }
  })();
}

/** 모델 파일 경로를 미리 확인해 둔다(설정 화면이 "지금 고른 모델이 실제로 있는지"를 물을 때). */
export async function probeModelReadable(modelId: string): Promise<boolean> {
  const m = findModel(modelId);
  if (!m) return false;
  try {
    await fsp.access(m.path, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
