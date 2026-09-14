import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LOCAL_DEFAULT_CONTEXT_SIZE, type LocalContextInfo, type LocalSamplingInfo } from '@vibisual/shared';
import { getEngineState } from './localEngineService.js';
import { readLocalGgufMeta } from './localArchService.js';
import { findModel } from './localModelService.js';
import { loadedModelContext, loadedModelPort } from './localRunner.js';

/**
 * §5.25 (G-2) — 로컬 모델의 온도 칸을 비워 두면 **실제로 쓰이는 값**을 찾는다. 읽기만 한다.
 *
 * 비워 두면 우리는 요청에 `temperature` 를 싣지 않고(§5.19), 그때 값은 엔진이 정한다. 확실한 순서로:
 * ① 지금 올라가 있는 엔진의 `GET /props`(llama.cpp server 문서의 공개 엔드포인트) —
 *    `default_generation_settings` 가 그 인스턴스가 실제로 쓰는 값이다.
 * ② 모델 파일(GGUF)의 `general.sampling.temp` — 엔진은 올릴 때 이 값을 기본으로 삼는다.
 * ③ 설치된 `llama-server --help` 의 `--temp ... (default: N)` — 공개 인터페이스에서 읽는다.
 *    숫자를 코드에 적어 두지 않는다 — 엔진이 바꾸면 화면도 따라 바뀌어야 한다.
 * 셋 다 모르면 `null` 이고 화면은 값을 지어내지 않는다.
 *
 * 문맥 칸도 같은 응답에 싣는다 — 비워 두면 `LOCAL_DEFAULT_CONTEXT_SIZE` 로 띄우되 모델의 학습 문맥보다
 * 크면 그 길이로 깎이고(localRunner `ensureLoaded`), 이미 올라간 엔진은 내리기 전까지 뜬 크기 그대로다.
 */

/** `/props` 한 번에 주는 시간. 같은 기계의 루프백이라 짧게 — 넘으면 다음 근거로 간다. */
const PROPS_TIMEOUT_MS = 1500;
/** `--help` 한 번에 주는 시간. 포트를 잡지 않고 바로 끝나는 명령이다. */
const HELP_TIMEOUT_MS = 10_000;

/** `/props` 응답 → 그 인스턴스의 온도. 요즘 모양(`params.temperature`)과 옛 모양(`temperature`) 둘 다. */
export function parsePropsTemperature(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null;
  const settings = (json as Record<string, unknown>)['default_generation_settings'];
  if (!settings || typeof settings !== 'object') return null;
  const params = (settings as Record<string, unknown>)['params'];
  const candidates = [
    params && typeof params === 'object' ? (params as Record<string, unknown>)['temperature'] : undefined,
    (settings as Record<string, unknown>)['temperature'],
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 0) return Number(c.toFixed(4));
  }
  return null;
}

/**
 * `llama-server --help` 출력 → `--temp` 의 기본값. 설명이 다음 줄로 접혀도 그 옵션 칸 안에서 찾는다.
 * 못 찾으면 `null`(엔진이 문구를 바꾼 날 지어내지 않는다).
 */
export function parseLlamaHelpTemp(help: string): number | null {
  const lines = help.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^\s*(-\w,\s*)?--temp\b/.test(l) || /,\s*--temp\b/.test(l));
  if (at < 0) return null;
  // 옵션 줄보다 깊이 들여쓴 뒤 줄들은 그 옵션 설명이 접힌 것이다. 같거나 얕으면 다음 옵션이다.
  const indentOf = (l: string): number => l.length - l.trimStart().length;
  const own = indentOf(lines[at]!);
  const block = [lines[at]!];
  for (let i = at + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (!l.trim() || indentOf(l) <= own) break;
    block.push(l);
  }
  const d = /default:\s*([0-9]*\.?[0-9]+)/i.exec(block.join(' '));
  if (!d?.[1]) return null;
  const v = Number(d[1]);
  return Number.isFinite(v) ? v : null;
}

/** 근거 셋 중 먼저 있는 것. 순수 함수. */
export function pickLocalSampling(input: {
  loaded: number | null;
  model: number | null;
  engine: number | null;
}): LocalSamplingInfo {
  if (input.loaded !== null) return { temperature: input.loaded, source: 'loaded' };
  if (input.model !== null) return { temperature: input.model, source: 'model' };
  if (input.engine !== null) return { temperature: input.engine, source: 'engine' };
  return { temperature: null, source: null };
}

/** 문맥 칸을 비워 두었을 때 뜨는 크기. 순수 함수 — 올라간 엔진 → 학습 문맥으로 깎임 → 우리 크기. */
export function pickLocalContext(input: { loaded: number | null; trained: number | null; builtin: number }): LocalContextInfo {
  if (input.loaded !== null && input.loaded > 0) return { tokens: input.loaded, source: 'loaded' };
  if (input.trained !== null && input.trained > 0 && input.trained < input.builtin) return { tokens: input.trained, source: 'model' };
  return { tokens: input.builtin, source: 'builtin' };
}

let helpCache: { key: string; temp: number | null } | null = null;

function engineHelpTemp(bin: string): Promise<number | null> {
  let key: string;
  try {
    // 엔진을 갈아 끼우면 같은 경로라도 수정 시각이 바뀐다 — 그때만 다시 묻는다.
    key = `${bin}|${String(fs.statSync(bin).mtimeMs)}`;
  } catch {
    return Promise.resolve(null);
  }
  if (helpCache?.key === key) return Promise.resolve(helpCache.temp);
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    const finish = (temp: number | null, cache: boolean): void => {
      if (settled) return;
      settled = true;
      if (cache) helpCache = { key, temp };
      resolve(temp);
    };
    // 오래 사는 자식이 아니다(포트를 잡지 않고 바로 끝난다) — 프로세스 그룹을 붙이지 않는다.
    //   엔진을 띄우는 자리(localRunner)와 같은 cwd·windowsHide 로 띄워 같은 라이브러리를 찾게 한다.
    const child = spawn(bin, ['--help'], { cwd: path.dirname(bin), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (d: Buffer): void => {
      out += d.toString();
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 이미 끝났으면 그만 */
      }
      finish(null, false);
    }, HELP_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      finish(null, false);
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(parseLlamaHelpTemp(out), true);
    });
  });
}

async function loadedTemp(modelId: string): Promise<number | null> {
  const port = loadedModelPort(modelId);
  if (port === null) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/props`, { signal: AbortSignal.timeout(PROPS_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parsePropsTemperature(await res.json());
  } catch {
    return null;
  }
}

/** 이 모델의 온도·문맥을 비워 두었을 때 쓰이는 값. 온도의 뒤 근거는 앞 근거가 없을 때만 구한다. */
export async function getLocalSampling(modelId: string): Promise<LocalSamplingInfo> {
  const entry = findModel(modelId);
  const meta = entry ? readLocalGgufMeta(entry.path) : null;
  const context = pickLocalContext({
    loaded: loadedModelContext(modelId),
    trained: meta?.contextLength ?? null,
    builtin: LOCAL_DEFAULT_CONTEXT_SIZE,
  });
  const fromLoaded = await loadedTemp(modelId);
  if (fromLoaded !== null) return { ...pickLocalSampling({ loaded: fromLoaded, model: null, engine: null }), context };
  const fromModel = meta?.samplingTemp ?? null;
  if (fromModel !== null) return { ...pickLocalSampling({ loaded: null, model: fromModel, engine: null }), context };
  const bin = getEngineState().serverBin;
  const fromEngine = bin ? await engineHelpTemp(bin) : null;
  return { ...pickLocalSampling({ loaded: null, model: null, engine: fromEngine }), context };
}
