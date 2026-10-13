import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_CANVAS_FACE } from '@vibisual/shared';

import type { AppCanvasFaceProps } from '../../apps/registry.js';
import {
  CheckGlyph,
  CopyGlyph,
  FACE_BAR_HEIGHT,
  FaceBar,
  FaceButton,
  FaceFrame,
  FaceNote,
  FaceStage,
  FaceStill,
  FillGlyph,
  FitGlyph,
} from '../../apps/canvasFaceKit.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { CLIPBOARD_IMAGE_MIME, copyImageToClipboard, resolveClipboardSurface, type ClipboardScope } from '../IDE/imageClipboard.js';

/**
 * §5.4 #36 (G) — Vibimage 노드 화면의 안쪽: **캔버스에서 바로 다룬다.**
 *
 * 화면은 코어가 구운 한 장(화면 크기로 줄인 것 — 원본을 노드마다 디코딩해 들고 있지 않는다)이다. 할 수 있는 것은 둘 —
 * **채우기 ↔ 맞춤**(잘라서 꽉 채워 보기 / 통째로 보기 — 구운 한 장은 자르지 않고 줄인 것이라 둘 다 같은 그림으로 된다)과
 * **클립보드로 복사**(원본을 PNG 로 — 라이트박스(§5.5 #17-25 ④-2)와 같은 `imageClipboard` 한 벌. 세 OS 가 공통으로 받는
 * 이미지 형식이 PNG 뿐이라 원본이 무엇이든 PNG 로 굽는다). 표시·고치기는 더블클릭·[에디터에서 열기]의 몫이다.
 *
 * 그림 위는 조작 자리가 아니다 — 거기서 끌면 노드가 움직이고, 두 번 누르면 에디터가 열린다.
 */
type CopyState = 'idle' | 'busy' | 'done' | 'failed';

/** 클립보드에 실을 PNG — 이미 PNG 면 그대로, 아니면 원본 크기 그대로 한 번 그려 굽는다(SVG 도 그림으로 풀린다). */
async function toClipboardPng(blob: Blob): Promise<Blob | null> {
  if (blob.type === CLIPBOARD_IMAGE_MIME) return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!(w > 0 && h > 0)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, CLIPBOARD_IMAGE_MIME);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageCanvasFace({
  projectId,
  file,
  version,
  width,
  height,
  glow,
  icon,
  thumb,
  thumbLoading,
}: AppCanvasFaceProps): React.JSX.Element {
  const { t } = useTranslation();
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [copy, setCopy] = useState<CopyState>('idle');
  // 클립보드가 없는 런타임이면 복사 단추를 흐린다(누르고 나서 실패를 알리는 대신).
  const clipboard = useMemo(() => resolveClipboardSurface(globalThis as unknown as ClipboardScope), []);

  // 다른 결과가 오면(파일·버전) 처음 모습으로.
  useEffect(() => {
    setFit('cover');
    setCopy('idle');
  }, [projectId, file, version]);

  // 복사 결과(✓·실패)는 잠깐만 보이고 돌아온다.
  useEffect(() => {
    if (copy !== 'done' && copy !== 'failed') return undefined;
    const id = setTimeout(() => setCopy('idle'), APP_CANVAS_FACE.copiedFlashMs);
    return () => clearTimeout(id);
  }, [copy]);

  const copyNow = (): void => {
    if (copy === 'busy') return;
    setCopy('busy');
    // 굽기를 기다리지 않고 약속째 넘긴다 — 쓰기 자체는 누른 손 안에서 시작돼야 거절되지 않는다(imageClipboard 주석).
    const png = (async (): Promise<Blob | null> => {
      const blob = await fetchWorkspaceMediaBlob(projectId, file);
      return blob ? toClipboardPng(blob) : null;
    })();
    void copyImageToClipboard(png, clipboard).then((result) => setCopy(result.ok ? 'done' : 'failed'));
  };

  const stageHeight = Math.max(1, height - FACE_BAR_HEIGHT);
  const fitLabel = fit === 'cover'
    ? t('panel.apps.vibimage.fit', { defaultValue: '맞춤' })
    : t('panel.apps.canvas.fill', { defaultValue: '채우기' });
  const copyLabel = copy === 'done'
    ? t('ide.imageAnnotate.copied', { defaultValue: '클립보드에 복사했습니다' })
    : t('panel.apps.canvas.copyImage', { defaultValue: '그림 복사' });
  const failedText = t('panel.apps.canvas.copyFailed', { defaultValue: '그림을 복사하지 못했습니다' });

  return (
    <FaceFrame>
      <FaceStage className="bg-[#07090D]">
        <FaceStill thumb={thumb} loading={thumbLoading} glow={glow} icon={icon} width={width} height={stageHeight} fit={fit} />
      </FaceStage>
      <FaceBar>
        {/* 단추는 "누르면 무엇이 되나"를 말한다 — 채워 보고 있으면 [맞춤], 맞춰 보고 있으면 [채우기]. */}
        <FaceButton label={fitLabel} onClick={() => setFit((f) => (f === 'cover' ? 'contain' : 'cover'))} disabled={thumb === null}>
          {fit === 'cover' ? <FitGlyph /> : <FillGlyph />}
        </FaceButton>
        <FaceButton label={copyLabel} onClick={copyNow} disabled={clipboard === null || copy === 'busy'} active={copy === 'done'} accent={glow}>
          {copy === 'done' ? <CheckGlyph /> : <CopyGlyph />}
        </FaceButton>
        {copy === 'failed' ? <FaceNote title={failedText}>{failedText}</FaceNote> : <span className="min-w-0 flex-1" />}
      </FaceBar>
    </FaceFrame>
  );
}
