/**
 * localModelService.ts — §5.19 (E) All Model 로컬 모델 카탈로그·내려받기·목록.
 *
 * **카탈로그를 코드에 박지 않는다.** 모델 목록을 상수 배열로 들고 있으면 그 항목이 사라지거나
 * 새 모델이 나올 때마다 앱을 새로 내야 하고, 그 사이 화면은 거짓말을 한다. 그래서 검색은
 * 그때그때 조회해서 만든다(§5.19 (D) 빌드 번호를 안 박는 것과 같은 이유).
 *
 * **고르는 것은 사용자다.** "당신 PC 엔 이게 맞습니다" 식 추천을 하지 않는다 — 배포되는
 * 제품이라 우리는 사용자 장비를 모르고, 올라마도 7B 옆에 70B 를 그냥 같이 놓는다.
 * 이름·용량·양자화를 정직하게 보여 주는 것까지가 우리 몫이다.
 *
 * 받아 둔 모델의 진실도 **디스크**다 — 별도 색인 파일을 두면 사용자가 파일을 지웠을 때
 * 목록만 남아 첫 대화에서 죽는다. 매번 폴더를 훑는다.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  HF_MODEL_API,
  LOCAL_MODEL_DIR_NAME,
  LOCAL_MODEL_FILE_LIMIT,
  LOCAL_MODEL_SEARCH_LIMIT,
  type LocalModelCatalogEntry,
  type LocalModelCatalogRepo,
  type LocalModelDownloadProgress,
  type LocalModelEntry,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

/** 모델이 놓이는 폴더(`~/.vibisual/models`). 지우는 것도 여기 한 곳. */
export function modelsDir(): string {
  return path.join(os.homedir(), '.vibisual', LOCAL_MODEL_DIR_NAME);
}

/** 파일명에서 양자화 라벨을 읽는다(`…-Q4_K_M.gguf` → `Q4_K_M`). 못 읽으면 undefined. */
function parseQuant(fileName: string): string | undefined {
  const m = /[-.]((?:IQ|Q)\d+(?:_[A-Z0-9]+)*|F16|BF16|F32)\.gguf$/i.exec(fileName);
  return m?.[1]?.toUpperCase();
}

/** 파일명 → 안정 id. 경로 주입을 막기 위해 안전 문자만 남긴다. */
function fileToId(fileName: string): string {
  return fileName.replace(/\.gguf$/i, '').replace(/[^\w.-]/g, '_');
}

/**
 * §5.19 (E) — 받아 둔 모델 목록. 폴더를 훑어 만든다.
 * 아직 받는 중인 `.part` 파일은 목록에 넣지 않는다(반쪽 모델을 고를 수 있으면 안 된다).
 */
export function listModels(): LocalModelEntry[] {
  const dir = modelsDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: LocalModelEntry[] = [];
  for (const name of names) {
    if (!/\.gguf$/i.test(name)) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const entry: LocalModelEntry = {
      id: fileToId(name),
      name: name.replace(/\.gguf$/i, ''),
      path: full,
      sizeBytes: st.size,
      downloadedAt: st.mtimeMs,
    };
    const quant = parseQuant(name);
    if (quant) entry.quant = quant;
    out.push(entry);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** id 로 받아 둔 모델 하나 찾기. 없으면 null. */
export function findModel(modelId: string): LocalModelEntry | null {
  return listModels().find((m) => m.id === modelId) ?? null;
}

/** §5.19 (E) — 받아 둔 모델 삭제. 사용자가 명시적으로 고른 것만 지운다. */
export async function deleteModel(modelId: string): Promise<boolean> {
  const found = findModel(modelId);
  if (!found) return false;
  await fsp.rm(found.path, { force: true });
  logger.info(`[localModel] deleted ${found.name}`);
  return true;
}

// ─── 카탈로그 조회 (Hugging Face) ───

interface HfModelSummary {
  id?: string;
  modelId?: string;
  downloads?: number;
}

interface HfSibling {
  rfilename?: string;
  size?: number;
}

function downloadUrl(repo: string, file: string): string {
  const parts = file.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `https://huggingface.co/${repo}/resolve/main/${parts}?download=true`;
}

/**
 * §5.19 (E) — 저장소 검색. 검색어가 비면 내려받기 순 인기 목록을 준다.
 * 실패하면 빈 배열 — 화면은 "찾지 못했습니다"로 떨어지고 앱은 계속 돈다.
 */
export async function searchCatalog(query: string): Promise<LocalModelCatalogRepo[]> {
  const url = new URL(HF_MODEL_API);
  url.searchParams.set('filter', 'gguf');
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(LOCAL_MODEL_SEARCH_LIMIT));
  const q = query.trim();
  if (q) url.searchParams.set('search', q);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'vibisual' } });
    if (!res.ok) throw new Error(`hf search ${res.status}`);
    const list = (await res.json()) as HfModelSummary[];
    return list
      .map((m) => {
        const repo = m.id ?? m.modelId ?? '';
        return { repo, downloads: m.downloads ?? 0, files: [] as LocalModelCatalogEntry[] };
      })
      .filter((r) => r.repo.length > 0);
  } catch (err) {
    logger.warn('[localModel] catalog search failed', err);
    return [];
  }
}

/**
 * §5.19 (E) — 저장소 하나가 들고 있는 GGUF(=양자화 선택지) 목록.
 * 크기를 모르면 0 으로 둔다 — 화면이 "크기 미상"이라고 정직하게 말하면 된다.
 */
export async function listRepoFiles(repo: string): Promise<LocalModelCatalogEntry[]> {
  try {
    const res = await fetch(`${HF_MODEL_API}/${repo}?blobs=true`, {
      headers: { accept: 'application/json', 'user-agent': 'vibisual' },
    });
    if (!res.ok) throw new Error(`hf repo ${res.status}`);
    const j = (await res.json()) as { siblings?: HfSibling[] };
    const files = (j.siblings ?? [])
      .map((s) => s.rfilename ?? '')
      .filter((n) => /\.gguf$/i.test(n));
    const sizes = new Map<string, number>();
    for (const s of j.siblings ?? []) {
      if (s.rfilename && typeof s.size === 'number') sizes.set(s.rfilename, s.size);
    }
    return files.slice(0, LOCAL_MODEL_FILE_LIMIT).map((file) => {
      const base = file.split('/').pop() ?? file;
      const entry: LocalModelCatalogEntry = {
        id: fileToId(base),
        repo,
        file,
        url: downloadUrl(repo, file),
        sizeBytes: sizes.get(file) ?? 0,
      };
      const quant = parseQuant(base);
      if (quant) entry.quant = quant;
      return entry;
    });
  } catch (err) {
    logger.warn(`[localModel] repo listing failed: ${repo}`, err);
    return [];
  }
}

// ─── 내려받기 ───

interface DownloadSession extends LocalModelDownloadProgress {
  abort: AbortController;
  destPath: string;
  partPath: string;
}

const downloads = new Map<string, DownloadSession>();

function toProgress(s: DownloadSession): LocalModelDownloadProgress {
  return {
    downloadId: s.downloadId,
    modelId: s.modelId,
    name: s.name,
    status: s.status,
    receivedBytes: s.receivedBytes,
    totalBytes: s.totalBytes,
    ...(s.error ? { error: s.error } : {}),
  };
}

function pushDownload(s: DownloadSession): void {
  const msg: WSMessage = { type: 'local_model_progress', timestamp: Date.now(), payload: toProgress(s) };
  broadcast(msg);
}

/** 진행 중이거나 방금 끝난 내려받기들(화면이 목록 아래에 그대로 그린다). */
export function listDownloads(): LocalModelDownloadProgress[] {
  return [...downloads.values()].map(toProgress);
}

/**
 * §5.19 (E) — 모델 내려받기. **재개 가능**하다 — 수 GB 를 받다 앱이 꺼지면 처음부터 다시
 * 받게 만들 수 없다. 받다 만 것은 `.part` 로 두고 다음에 `Range` 로 이어 받는다.
 */
export function downloadModel(repo: string, file: string): LocalModelDownloadProgress {
  const base = file.split('/').pop() ?? file;
  const modelId = fileToId(base);

  const existing = [...downloads.values()].find(
    (d) => d.modelId === modelId && (d.status === 'starting' || d.status === 'downloading'),
  );
  if (existing) return toProgress(existing);

  const dir = modelsDir();
  const destPath = path.join(dir, base);
  const session: DownloadSession = {
    downloadId: randomUUID(),
    modelId,
    name: base.replace(/\.gguf$/i, ''),
    status: 'starting',
    receivedBytes: 0,
    totalBytes: 0,
    abort: new AbortController(),
    destPath,
    partPath: `${destPath}.part`,
  };
  downloads.set(session.downloadId, session);
  pushDownload(session);

  void (async (): Promise<void> => {
    try {
      await fsp.mkdir(dir, { recursive: true });

      // 이어 받기 — 남아 있는 조각만큼 건너뛰고 요청한다.
      let already = 0;
      try {
        already = (await fsp.stat(session.partPath)).size;
      } catch {
        already = 0;
      }

      const headers: Record<string, string> = { 'user-agent': 'vibisual' };
      if (already > 0) headers['range'] = `bytes=${already}-`;

      const res = await fetch(downloadUrl(repo, file), {
        headers,
        redirect: 'follow',
        signal: session.abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`download ${res.status}`);

      // 206 이면 이어 받는 중이고, 200 이면 서버가 범위를 무시한 것이라 처음부터 다시 쓴다.
      const resumed = res.status === 206 && already > 0;
      const startAt = resumed ? already : 0;
      const len = Number(res.headers.get('content-length') ?? 0);
      session.totalBytes = len > 0 ? startAt + len : 0;
      session.receivedBytes = startAt;
      session.status = 'downloading';
      pushDownload(session);

      const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      let lastPush = 0;
      body.on('data', (chunk: Buffer) => {
        session.receivedBytes += chunk.length;
        const now = Date.now();
        if (now - lastPush >= 250) {
          lastPush = now;
          pushDownload(session);
        }
      });
      await pipeline(body, fs.createWriteStream(session.partPath, resumed ? { flags: 'a' } : { flags: 'w' }));

      await fsp.rename(session.partPath, session.destPath);
      session.status = 'done';
      pushDownload(session);
      logger.info(`[localModel] downloaded ${base} (${session.receivedBytes} bytes)`);
    } catch (err) {
      if (session.abort.signal.aborted) {
        session.status = 'canceled';
      } else {
        session.status = 'error';
        session.error = err instanceof Error ? err.message : String(err);
        logger.error(`[localModel] download failed: ${base}`, err);
      }
      pushDownload(session);
    }
  })();

  return toProgress(session);
}

/** 내려받기 중단. 받다 만 조각은 남겨 둔다 — 다음에 이어 받으라고. */
export function cancelDownload(downloadId: string): boolean {
  const s = downloads.get(downloadId);
  if (!s) return false;
  if (s.status === 'starting' || s.status === 'downloading') s.abort.abort();
  return true;
}
