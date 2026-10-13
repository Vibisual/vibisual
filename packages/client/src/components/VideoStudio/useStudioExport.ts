import { useCallback, useRef, useState } from 'react';
import { VIDEO_FORMATS, buildSrt, resolveTimeline, type VideoDoc, type VideoFormatId } from '@vibisual/video';

import { deriveDoc } from './videoApi.js';
import type { StudioRender } from './useStudioRender.js';

/**
 * §5.13 (V) 37-15 — **내보내기 단추 하나**의 뜻. MP4(자막 굽기 — 기본 · 따로 내기 — 자막 트랙을 숨긴 렌더 + SRT) · PNG(재생 머리)
 * · SRT(순수 `buildSrt`) · 출력 프리셋(지금 판형이면 그대로, 다른 판형이면 파생 문서 `<docId>-<판형>` 을 만들어 그것을 렌더 — 이미
 * 있으면 사람이 고친 그 문서로). 렌더 진행률은 단추 안에 채워진다(`useStudioRender`).
 * §5.13 (W) 38-3 — 모션만 투명 배경(WebM + 알파): 실측(Electron 31 · VP9 `alpha:'keep'`)이 통과해 켰다.
 */
export interface StudioExport {
  readonly captions: 'burn' | 'separate';
  readonly setCaptions: (mode: 'burn' | 'separate') => void;
  readonly mp4: () => void;
  /** §5.13 (W) 38-3 — 모션만 투명 배경(WebM). 자막은 굽기/따로 내기 설정을 따른다. */
  readonly transparent: () => void;
  readonly png: () => void;
  readonly srt: () => void;
  readonly preset: (format: VideoFormatId) => void;
}

function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-subrip;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useStudioExport(d: {
  readonly projectName: string;
  readonly doc: VideoDoc | null;
  readonly render: StudioRender;
  readonly onError: (err: unknown) => void;
  readonly onInfo: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly onDerived: () => void;
}): StudioExport {
  const [captions, setCaptions] = useState<'burn' | 'separate'>('burn');
  const ref = useRef(d);
  ref.current = d;

  const srtOf = useCallback((doc: VideoDoc): void => {
    const text = buildSrt(doc, resolveTimeline(doc));
    if (text.trim() === '') { ref.current.onInfo('panel.videoStudio.export.noCaptions'); return; }
    downloadText(text, `${doc.title || doc.id}.srt`);
  }, []);

  const mp4 = useCallback((): void => {
    const { doc, render } = ref.current;
    if (!doc) return;
    void render.renderMp4(undefined, { captions });
    if (captions === 'separate') srtOf(doc);
  }, [captions, srtOf]);

  const preset = useCallback((format: VideoFormatId): void => {
    const { doc, render, projectName } = ref.current;
    if (!doc) return;
    const target = VIDEO_FORMATS[format];
    if (doc.size.width === target.width && doc.size.height === target.height) { mp4(); return; }
    void (async () => {
      try {
        const derived = await deriveDoc(projectName, doc.id, format);
        ref.current.onInfo(derived.created ? 'panel.videoStudio.export.derived' : 'panel.videoStudio.export.derivedExisting', { title: derived.doc.title });
        ref.current.onDerived();
        await render.renderMp4({ docId: derived.doc.id, title: derived.doc.title }, { captions });
        if (captions === 'separate') srtOf(derived.doc);
      } catch (err) {
        ref.current.onError(err);
      }
    })();
  }, [captions, mp4, srtOf]);

  const transparent = useCallback((): void => {
    const { doc, render } = ref.current;
    if (!doc) return;
    void render.renderMp4(undefined, { captions, transparent: true });
    if (captions === 'separate') srtOf(doc);
  }, [captions, srtOf]);

  return {
    captions,
    setCaptions,
    mp4,
    transparent,
    png: () => { void ref.current.render.savePng(); },
    srt: () => { const doc = ref.current.doc; if (doc) srtOf(doc); },
    preset,
  };
}
