import { prepareVideoImports } from './videoImportFiles.js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTimeline, type VideoAsset, type VideoDoc, type VideoDocOp } from '@vibisual/video';

import { measureAssets } from './useVideoRenderer.js';
import { importVideoAsset } from './videoApi.js';
import { withStudioAgentContext, type StudioAgentContext, type StudioPassMode, type StudioPointed } from './studioAgentMessage.js';
import type { StudioAgent } from './useStudioAgent.js';
import type { StudioPlayback } from './useStudioPlayback.js';
import { MEDIA_IMPORT_LIMIT } from './useStudioEditing.js';

/**
 * §5.13 (V) 37-1 — AI 패널 입력창의 상태와 보내기. 칩(가리킨 것·첨부·시각)은 이 말과 함께 문맥 블록으로 실려 간다. 첨부는
 * 그림·영상·소리를 **이 문서의 소재로** 들인다(배치는 AI 가 한다 — 되돌릴 수 있는 평소 편집 경로). 보내기는 바퀴를 열고
 * 기존 명령 큐로 간다(`useStudioAgent.send`). Codex 그림 생성 허용은 Codex 일 때만 싣는다(37-14).
 */
export function useStudioComposer(d: {
  projectName: string;
  doc: VideoDoc | null;
  playback: StudioPlayback;
  selectedItemId: string | null;
  agent: StudioAgent;
  applyOps: (ops: readonly VideoDocOp[]) => Promise<boolean>;
  disabled: boolean;
  onError: (err: unknown) => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [assets, setAssets] = useState<readonly { asset: VideoAsset; label: string }[]>([]);
  const [pointed, setPointed] = useState<readonly StudioPointed[]>([]);
  const [useTime, setUseTime] = useState(true);
  const [imageGeneration, setImageGeneration] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const docId = d.doc?.id ?? '';
  useEffect(() => { setAssets([]); setPointed([]); }, [docId]);

  const attach = useCallback(async (files: readonly File[]): Promise<void> => {
    if (!d.doc || d.disabled) return;
    setAttaching(true);
    try {
      const added: { asset: VideoAsset; label: string }[] = [];
      if (files.reduce((sum, file) => sum + file.size, 0) > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
      for (const file of await prepareVideoImports(files)) {
        if (file.size > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
        const imported = await importVideoAsset(d.projectName, file);
        const measured = imported.kind === 'image' ? undefined : (await measureAssets(d.projectName, [imported]))[imported.id];
        added.push({
          label: file.name,
          asset: {
            ...imported,
            ...(measured?.duration ? { duration: measured.duration } : {}),
            ...(measured?.width ? { width: measured.width } : {}),
            ...(measured?.height ? { height: measured.height } : {}),
            ...(measured?.hasAudio !== undefined ? { hasAudio: measured.hasAudio } : {}),
          },
        });
      }
      if (added.length > 0 && await d.applyOps(added.map(({ asset }): VideoDocOp => ({ op: 'setAsset', asset })))) setAssets((prev) => [...prev, ...added]);
    } catch (err) {
      d.onError(err);
    } finally {
      setAttaching(false);
    }
  }, [d, t]);

  /** 바퀴 하나를 보낸다(입력창·메모 맡기기·장면 다시·검수 고치기가 같은 길을 쓴다). */
  const sendPass = useCallback(async (note: string, mode: StudioPassMode, extra: Partial<StudioAgentContext> = {}, engine?: 'claude' | 'codex'): Promise<string | null> => {
    const doc = d.doc;
    if (!doc) return null;
    const timeline = resolveTimeline(doc);
    const selected = timeline.items.find((item) => item.id === d.selectedItemId);
    try {
      const passId = await d.agent.send({
        request: note,
        mode,
        chapterId: extra.chapter?.id,
        engine,
        doc: { id: doc.id, title: doc.title },
        compose: (id) => withStudioAgentContext(note, {
          projectName: d.projectName,
          doc: { id: doc.id, title: doc.title, version: doc.version, size: doc.size },
          // §5.13 (Y) 40-5 ① — 보내는 순간의 시각(재생 중이면 상태 재생 머리는 시작 자리에 머문다).
          playhead: useTime ? d.playback.clock.get() : 0,
          duration: timeline.duration,
          passId: id,
          mode,
          selected,
          ...((engine ?? d.agent.engine) === 'codex' ? { imageGeneration } : {}),
          ...extra,
        }),
      });
      d.onSent();
      return passId;
    } catch (err) {
      d.onError(err);
      return null;
    }
  }, [d, useTime, imageGeneration]);

  const send = useCallback(async (live?: string): Promise<void> => {
    const typed = (live ?? text).trim();
    if (typed === '' && assets.length === 0 && pointed.length === 0) return;
    const note = typed !== '' ? typed : t('panel.videoStudio.agent.useAttachments');
    const sent = await sendPass(note, 'revise', { attached: assets.map((a) => a.asset), pointed });
    if (sent) { setText(''); setAssets([]); setPointed([]); }
  }, [text, assets, pointed, sendPass, t]);

  return {
    text, setText, assets, removeAsset: (id: string) => setAssets((prev) => prev.filter((a) => a.asset.id !== id)),
    pointed, addPointed: (p: StudioPointed) => setPointed((prev) => [...prev.filter((x) => !(x.itemId === p.itemId && x.path === p.path)), p].slice(-4)),
    removePointed: (index: number) => setPointed((prev) => prev.filter((_, i) => i !== index)),
    useTime, setUseTime, imageGeneration, setImageGeneration, attaching, attach, send, sendPass,
  };
}

export type StudioComposerState = ReturnType<typeof useStudioComposer>;
