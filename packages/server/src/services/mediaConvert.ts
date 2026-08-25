/**
 * mediaConvert.ts — §5.13 (R-8) **못 읽는 영상·소리를 우리 엔진이 읽는 형식으로 바꾼다.**
 *
 * 규율 넷:
 *   ① **포장만 바꾸는 것이 먼저다** — 영상은 리먹스(`-c copy`)를 먼저 시도한다. 재인코딩이 아니라
 *      컨테이너만 갈아 끼우는 것이라 화질 손실이 없고 25MB 가 0.073초에 끝난다(실측). MP4 가 담을 수
 *      없는 코덱일 때만 인코딩으로 내려간다.
 *   ② **결과는 프로젝트 안 캐시** — 원본 경로+크기+수정시각 해시라 원본이 바뀌면 저절로 다시 만든다.
 *   ③ **같은 파일을 두 번 갈지 않는다** — 이미 도는 작업이 있으면 그 작업을 그대로 돌려준다.
 *   ④ **상태는 휘발성** — 진실은 디스크의 캐시 파일이다. 체크포인트·broadcast 미관여(§5.13 (I) 와 같은 판단).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { mediaCacheRelPath, type MediaConvertJob, type MediaConvertKind, type MediaConvertStatus } from '@vibisual/shared';

import { logger } from '../logger.js';
import { detectMediaTools } from './mediaTools.js';
import { resolveWorkspacePath } from './workspaceExplorer.js';

// ─── 순수 계산(테스트가 지키는 자리) ──────────────────────────────────────────

/**
 * 리먹스 인자 — **다시 인코딩하지 않는다.**
 *
 * `+faststart` 는 재생 머리(moov)를 앞으로 옮겨 스트리밍 시작이 빨라지게 한다. 우리 미디어 창구가
 * 구간 요청으로 읽으므로 이게 없으면 첫 프레임까지 파일 끝을 먼저 받아야 한다.
 */
export function buildRemuxArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-nostdin', '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out];
}

/** 리먹스가 안 될 때(코덱을 MP4 가 못 담을 때) 쓰는 인코딩 인자. 속도를 화질보다 앞에 둔다. */
export function buildEncodeArgs(src: string, out: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-i', src,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out,
  ];
}

/** 소리는 **WAV(PCM)** 로 뽑는다 — 음악 편집기가 그대로 받아 자르고 다시 내보낸다. */
export function buildAudioArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-nostdin', '-y', '-i', src, '-vn', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', out];
}

/**
 * `-progress pipe:1` 이 뱉는 `key=value` 줄에서 **진행한 시각(초)** 을 읽는다.
 *
 * 사람이 읽는 `time=00:00:04.00` 대신 이 창구를 쓰는 이유는 형식이 고정이라서다(로케일·판올림에
 * 흔들리지 않는다). 모르는 줄은 null.
 */
export function parseProgressSeconds(line: string): number | null {
  const m = /^out_time_ms=(\d+)/.exec(line.trim());
  if (m?.[1] !== undefined) return Number(m[1]) / 1_000_000;
  const t = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line.trim());
  if (t) return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  return null;
}

/** `Duration: 00:01:23.45` → 초. 없으면 null(그때는 진행률 대신 "변환 중"만 보인다). */
export function parseDurationSeconds(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 진행 초 → 퍼센트(0~99). 100 은 **끝났을 때만** 준다 — 다 됐는데 안 끝난 화면을 만들지 않는다. */
export function progressPercent(doneSec: number, totalSec: number | null): number {
  if (totalSec === null || totalSec <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round((doneSec / totalSec) * 100)));
}

// ─── 작업 ─────────────────────────────────────────────────────────────────────

class MediaConvertService {
  private readonly jobs = new Map<string, MediaConvertJob>();
  /** 캐시 경로 → 도는 작업 id. 같은 파일을 두 번 갈지 않기 위한 자리. */
  private readonly running = new Map<string, string>();
  private seq = 0;

  getJob(jobId: string): MediaConvertJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * 변환을 시작한다(또는 이미 있는 결과·작업을 돌려준다).
   *
   * 셋 중 하나로 답한다 — 캐시가 이미 있으면 **곧바로 `done`**, 같은 파일을 갈고 있으면 **그 작업**,
   * 아니면 새로 띄운다. 호출부(화면)는 셋을 구분할 필요 없이 `status` 만 보면 된다.
   */
  start(root: string, sourceRel: string, kind: MediaConvertKind): MediaConvertJob | { error: 'not-found' | 'no-ffmpeg' } {
    const source = resolveWorkspacePath(root, sourceRel);
    if (!source || !fs.existsSync(source.abs)) return { error: 'not-found' };

    const tools = detectMediaTools();
    if (!tools.available || tools.ffmpegPath === null) return { error: 'no-ffmpeg' };

    const stat = fs.statSync(source.abs);
    const outRel = mediaCacheRelPath(source.rel, stat.size, stat.mtimeMs, kind);
    const outAbs = path.join(path.resolve(root), ...outRel.split('/'));

    // ② 이미 만들어 둔 것이 있으면 그대로 쓴다 — 두 번째부터 팝업 없이 열리는 근거.
    if (fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0) {
      return this.remember({ root, sourceRel: source.rel, outRel, kind, status: 'done', percent: 100 });
    }

    // ③ 같은 결과물을 이미 만들고 있으면 그 작업을 돌려준다.
    const inFlight = this.running.get(outAbs);
    if (inFlight) {
      const job = this.jobs.get(inFlight);
      if (job && (job.status === 'queued' || job.status === 'running')) return job;
    }

    const job = this.remember({ root, sourceRel: source.rel, outRel, kind, status: 'queued', percent: 0 });
    this.running.set(outAbs, job.id);
    void this.run(job, source.abs, outAbs, tools.ffmpegPath);
    return job;
  }

  private remember(seed: Omit<MediaConvertJob, 'id' | 'startedAt'> & Partial<Pick<MediaConvertJob, 'id' | 'startedAt'>>): MediaConvertJob {
    const job: MediaConvertJob = {
      id: seed.id ?? `mc-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      startedAt: seed.startedAt ?? Date.now(),
      root: seed.root,
      sourceRel: seed.sourceRel,
      outRel: seed.outRel,
      kind: seed.kind,
      status: seed.status,
      percent: seed.percent,
      ...(seed.error === undefined ? {} : { error: seed.error }),
      ...(seed.endedAt === undefined ? {} : { endedAt: seed.endedAt }),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private patch(id: string, patch: Partial<MediaConvertJob>): void {
    const prev = this.jobs.get(id);
    if (!prev) return;
    this.jobs.set(id, { ...prev, ...patch });
  }

  /** ffmpeg 한 번 돌리기. 진행률을 갱신하고 종료 코드를 돌려준다. */
  private runOnce(id: string, ffmpeg: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let total: number | null = null;

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (total === null) total = parseDurationSeconds(text);
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          const seconds = parseProgressSeconds(line);
          if (seconds !== null) this.patch(id, { status: 'running', percent: progressPercent(seconds, total) });
        }
      });
      child.on('error', () => resolve(-1));
      child.on('close', (code) => resolve(code ?? -1));
    });
  }

  private async run(job: MediaConvertJob, srcAbs: string, outAbs: string, ffmpeg: string): Promise<void> {
    try {
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      this.patch(job.id, { status: 'running', percent: 0 });

      let code: number;
      if (job.kind === 'audio') {
        code = await this.runOnce(job.id, ffmpeg, buildAudioArgs(srcAbs, outAbs));
      } else {
        // ① 포장만 바꾸기부터. 대부분 여기서 끝나고, 끝나면 화질이 원본 그대로다.
        code = await this.runOnce(job.id, ffmpeg, buildRemuxArgs(srcAbs, outAbs));
        if (code !== 0) {
          logger.info(`[media-convert] 리먹스가 안 되어 인코딩으로 내려갑니다: ${job.sourceRel}`);
          this.patch(job.id, { percent: 0 });
          code = await this.runOnce(job.id, ffmpeg, buildEncodeArgs(srcAbs, outAbs));
        }
      }

      const ok = code === 0 && fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0;
      if (!ok) {
        // 반쯤 쓰다 만 파일을 남기면 다음 번에 "캐시가 있다"고 오판한다.
        try { if (fs.existsSync(outAbs)) fs.rmSync(outAbs, { force: true }); } catch { /* 지우지 못해도 상태는 error 다 */ }
        this.patch(job.id, { status: 'error', error: `exit ${String(code)}`, endedAt: Date.now() });
      } else {
        this.patch(job.id, { status: 'done', percent: 100, endedAt: Date.now() });
        logger.info(`[media-convert] 변환 완료: ${job.sourceRel} → ${job.outRel}`);
      }
    } catch (err) {
      this.patch(job.id, { status: 'error', error: String(err), endedAt: Date.now() });
    } finally {
      this.running.delete(outAbs);
    }
  }

  /** 이 파일의 변환 결과가 이미 있으면 그 상대 경로. 화면이 팝업 없이 바로 열지 판단하는 자리. */
  cachedOutput(root: string, sourceRel: string, kind: MediaConvertKind): string | null {
    const source = resolveWorkspacePath(root, sourceRel);
    if (!source || !fs.existsSync(source.abs)) return null;
    const stat = fs.statSync(source.abs);
    const outRel = mediaCacheRelPath(source.rel, stat.size, stat.mtimeMs, kind);
    const outAbs = path.join(path.resolve(root), ...outRel.split('/'));
    try {
      return fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0 ? outRel : null;
    } catch {
      return null;
    }
  }
}

export const mediaConvertService = new MediaConvertService();
export type { MediaConvertStatus };
