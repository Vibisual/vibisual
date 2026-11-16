/**
 * §5.13 (E-1)~(E-9) 구간 렌더 — 2초 구간마다 인코더를 새로 세워 굽고, 열쇠가 같은 구간은 보관한 패킷을 그대로 잇는다.
 * 캐시가 비어 있어도 이 길로 굽는다(전체 렌더와 구간을 다시 쓴 렌더가 한 구조라야 결과가 같다). 이을 수 없으면 `SegmentJoinError` — 부르는 쪽이 한 인코더 렌더로 내려간다.
 */

import { renderFramePlan } from '../exportPlan.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { createAudioFeed } from './audioWindows.js';
import { isPlannedBackend } from './capturePool.js';
import { ENCODE_QUALITY_HIGH, pickCodecs, type OutputContainer, type PickedCodecs } from './encode.js';
import { RenderCanceledError, ctx2d, scaledSurface, type RenderDocOptions, type RenderResult } from './renderDoc.js';
import { PacketMuxer, createSegmentEncoderLayer, type SegmentEncoderLayer, type SegmentEncoderSession } from './segmentEncode.js';
import { packSegment, segmentProblem, unpackSegment, type EncodedSegment } from './segmentPack.js';
import { canHashSegments, planSegments, segmentKeys, type SegmentSpan } from './segments.js';

/** 구간 조각을 두는 곳(호스트가 정한다 — 앱에서는 프로젝트 폴더의 캐시 자리로 가는 일꾼 전용 길). */
export interface SegmentStore {
  /** (E-8) ② — 문서 밖 지문(소재 파일·문서 전체에 걸리는 파일). */
  env(): Promise<{ readonly files: Readonly<Record<string, string>>; readonly shared: string }>;
  /** 열쇠들 중 조각이 있는 것. */
  has(keys: readonly string[]): Promise<ReadonlySet<string>>;
  /** 조각 본문(없거나 깨졌으면 null). */
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export interface SegmentRenderOptions extends RenderDocOptions {
  readonly store: SegmentStore;
  /** 엔진 판(User-Agent) — 열쇠에 든다. */
  readonly engine: string;
  /** (E-5) ④ — 방금 구운 구간을 보관해도 되는가(창을 못 키워 낮게 찍힌 구간은 보관하지 않는다). */
  readonly canStore?: () => boolean;
  /** 구간 인코더(없으면 이 기기의 것). 시험이 결정적인 가짜를 끼운다. */
  readonly encoderLayer?: SegmentEncoderLayer;
  /** 쓸 코덱(없으면 이 기기가 인코딩할 수 있는 것을 묻는다). */
  readonly codecs?: PickedCodecs;
}

export interface SegmentRenderResult extends RenderResult {
  readonly segments: { readonly total: number; readonly reused: number };
}

/** (E-5) ③ — 새로 구운 구간을 이번 렌더의 설정으로 이을 수 없다. 받은 쪽은 올린 결과를 버리고 한 인코더로 처음부터 굽는다. */
export class SegmentJoinError extends Error {
  constructor(readonly reason: string) {
    super(`렌더 구간을 이을 수 없습니다(${reason}).`);
    this.name = 'SegmentJoinError';
  }
}

export async function renderDocSegmented(opts: SegmentRenderOptions): Promise<SegmentRenderResult> {
  const { doc, backend, store } = opts;
  const timeline = opts.timeline ?? resolveTimeline(doc);
  const plan = renderFramePlan(timeline.duration, doc.fps, { fps: opts.fps ?? null, range: opts.range ?? null });
  const { fps, frames } = plan;
  if (frames === 0) throw new Error('길이가 0이라 렌더할 것이 없습니다.');

  await backend.init({ width: doc.size.width, height: doc.size.height });
  let session: SegmentEncoderSession | null = null;
  let muxer: PacketMuxer | null = null;
  try {
    const canvas = backend.canvas;
    if (!canvas) throw new Error('백엔드가 캔버스를 만들지 못했습니다.');
    const out = opts.outputSize && (opts.outputSize.width !== doc.size.width || opts.outputSize.height !== doc.size.height) ? opts.outputSize : null;
    const surface = out ? scaledSurface(out) : canvas;
    const surfaceCtx = out ? ctx2d(surface) : null;
    const width = out?.width ?? doc.size.width;
    const height = out?.height ?? doc.size.height;
    const alpha = opts.alpha === true;
    const container: OutputContainer = alpha ? 'webm' : opts.container ?? 'mp4';
    const quality = opts.quality ?? ENCODE_QUALITY_HIGH;
    const withAudio = opts.audio != null || opts.audioStream != null;

    const codecs = opts.codecs ?? await pickCodecs(width, height, withAudio, alpha, container);
    const codec = codecs.video;
    if (codec === null) {
      throw new Error(alpha
        ? '이 기기에서 투명 배경(VP9/VP8 알파)을 인코딩할 수 없습니다.'
        : '이 기기에서 인코딩할 수 있는 영상 코덱을 찾지 못했습니다.');
    }
    const layer = opts.encoderLayer ?? createSegmentEncoderLayer({ codec, canvas: surface, width, height, fps, quality, alpha, container });
    const aborted = (): boolean => opts.signal?.aborted === true;
    const pass = async (): Promise<void> => {
      if (aborted()) throw new RenderCanceledError();
      if (opts.gate) {
        await opts.gate();
        if (aborted()) throw new RenderCanceledError();
      }
    };

    // (E-8) ① — 이번 렌더의 디코더 설정. 캐시 조각도 새로 구운 구간도 이것과 같을 때만 잇는다.
    const decoder = await layer.probe();
    const spans = planSegments(frames, fps);

    // 열쇠를 못 세우면(지문·해시를 못 얻음) 캐시 없이 같은 구조로 굽는다 — 틀린 열쇠로 낡은 조각을 섞지 않는다.
    let keys: string[] | null = null;
    let have: ReadonlySet<string> = new Set();
    if (canHashSegments()) {
      try {
        const env = await store.env();
        keys = await segmentKeys({
          doc, timeline, start: plan.start, fps, spans, backend: backend.id,
          encode: { container, codec, quality: quality.video, width, height, fps, alpha, decoder },
          env: { engine: opts.engine, files: env.files, shared: env.shared },
        });
        have = await store.has(keys);
      } catch {
        keys = null;
        have = new Set();
      }
    }
    if (aborted()) throw new RenderCanceledError();

    const cached = spans.map((span) => keys !== null && have.has(keys[span.index]!));
    // §5.13 (W) 38-2 — 나눠 찍는 백엔드에는 구울 구간의 프레임 시각만 알린다. 캐시가 깨진 구간이 나오면 그 구간부터 다시 세운다((E-9)).
    const replan = (from: number): void => {
      if (!isPlannedBackend(backend)) return;
      const times: number[] = [];
      for (let i = from; i < spans.length; i += 1) {
        if (cached[i]) continue;
        const span = spans[i]!;
        for (let j = 0; j < span.frames; j += 1) times.push(plan.start + (span.firstFrame + j) / fps);
      }
      backend.plan(times);
    };
    replan(0);

    muxer = new PacketMuxer({
      codec, audioCodec: withAudio ? codecs.audio : null, fps, container, decoder, quality,
      ...(opts.sink ? { sink: opts.sink } : {}),
    });
    await muxer.start();
    const target = muxer;
    const audioFeed = opts.audioStream && !opts.audio && target.hasAudio
      ? createAudioFeed(opts.audioStream, plan.start, plan.end, (buffer) => target.addAudio(buffer))
      : null;

    let done = 0;
    let reusedFrames = 0;
    let reusedSegments = 0;
    /** 구간 하나를 최종 파일에 잇는다. (E-4) — 그 구간의 마지막 프레임 시각을 덮는 소리 창을 먼저(그릇이 영상 조각을 붙잡아 두지 않게). */
    const join = async (span: SegmentSpan, segment: EncodedSegment): Promise<void> => {
      if (audioFeed) {
        await audioFeed.ensureThrough((span.firstFrame + span.frames - 1) / fps);
        if (aborted()) throw new RenderCanceledError();
      }
      for (const packet of segment.packets) await target.addPacket(span.firstFrame + packet.frame, packet);
    };
    /**
     * 앞 구간의 마무리(인코더 비우기 → 검사 → 보관 → 잇기). 다음 구간을 그리는 동안 뒤에서 돈다 — 인코더를 비우는 시간과 새 인코더가 서는 시간이 겹친다
     * (실측은 §5.13 (E-10)). 떠 있는 마무리는 늘 하나뿐이고 잇는 순서는 구간 순서 그대로다.
     */
    let tail: Promise<void> = Promise.resolve();
    for (const span of spans) {
      await pass();
      const key = keys?.[span.index] ?? null;
      let segment: EncodedSegment | null = null;
      if (cached[span.index] && key !== null) {
        const bytes = await store.get(key).catch(() => null);
        const read = bytes ? unpackSegment(bytes) : null;
        if (read && segmentProblem(read, span.frames, decoder) === null) {
          segment = read;
        } else {
          // (E-5) ② — 깨졌거나 설정이 다른 조각은 없는 것으로 보고 다시 굽는다.
          cached[span.index] = false;
          replan(span.index);
        }
      }

      if (segment) {
        await tail;
        reusedSegments += 1;
        reusedFrames += span.frames;
        done += span.frames;
        opts.onProgress?.({ frame: done, totalFrames: frames, reusedFrames, t: plan.start + (span.firstFrame + span.frames - 1) / fps });
        await join(span, segment);
        continue;
      }

      const opened = await layer.open();
      session = opened;
      for (let j = 0; j < span.frames; j += 1) {
        await pass();
        // 그리는 시각은 문서 시각, 파일에 적는 시각은 구간 시작부터.
        const t = plan.start + (span.firstFrame + j) / fps;
        await backend.drawFrame(t);
        if (out && surfaceCtx) {
          // 투명 배경도 지키게 비우고 그린다(줄이는 판이 지난 프레임을 남기지 않게).
          surfaceCtx.clearRect(0, 0, out.width, out.height);
          surfaceCtx.drawImage(canvas, 0, 0, out.width, out.height);
        }
        await opened.addFrame(j);
        done += 1;
        opts.onProgress?.({ frame: done, totalFrames: frames, reusedFrames, t });
      }
      // 앞 구간의 마무리가 실패했으면 여기서 던진다(이을 수 없는 구간 뒤로 더 굽지 않는다).
      await tail;
      session = null;
      const closing = opened.finish();
      // (E-5) ④ — 보관해도 되는지는 이 구간을 다 찍은 지금 묻는다.
      const storable = key !== null && opts.canStore?.() !== false;
      tail = (async () => {
        const encoded = await closing;
        const problem = segmentProblem(encoded, span.frames, decoder);
        if (problem !== null) throw new SegmentJoinError(problem);
        // 보관은 최적화다 — 실패해도 렌더는 계속한다.
        if (storable && key !== null) await store.put(key, packSegment(encoded)).catch(() => undefined);
        await join(span, encoded);
      })();
      // 다음 구간을 그리는 사이의 실패는 위의 `await tail` 이 다시 던진다 — 그 사이 "처리 안 된 거부"로 새지 않게만 한다.
      tail.catch(() => undefined);
    }
    await tail;

    if (opts.audio) await target.addAudio(opts.audio);
    if (audioFeed) await audioFeed.finish();
    const bytes = await target.finish();
    return {
      bytes,
      size: target.bytesWritten,
      frames,
      reusedFrames,
      durationSec: plan.end - plan.start,
      codecs: { video: codec, audio: target.hasAudio ? codecs.audio : null },
      container,
      segments: { total: spans.length, reused: reusedSegments },
    };
  } catch (err) {
    await session?.cancel().catch(() => undefined);
    await muxer?.cancel().catch(() => undefined);
    throw err;
  } finally {
    backend.dispose();
  }
}
