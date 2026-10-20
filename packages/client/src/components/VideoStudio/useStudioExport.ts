import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  batchFileName,
  buildSrt,
  formatRatioLabel,
  planExportJobs,
  resolveTimeline,
  specFromSettings,
  type ExportPlanEntry,
  type ExportPreset,
  type ExportSettings,
  type ResolvedTimeline,
  type VideoDoc,
  type VideoFormatId,
} from '@vibisual/video';

import { formatClock } from './PreviewControls.js';
import { downloadText, piecesOf, planDocsOf, type ExportMode, type ExportTarget } from './exportTarget.js';
import { deriveDoc, type DocSummary } from './videoApi.js';
import type { StudioRender } from './useStudioRender.js';
import { useExportSettings } from './useExportSettings.js';


/**
 * §5.13 (V) 37-15 · (AA) 42 — **내보내기**의 뜻. 설정은 프로젝트마다 기억하고(`useExportSettings`), [렌더] 한 번을 **문서 × 판형 ×
 * 장면** 의 대기열 줄로 펼친다(`planExportJobs` — 순수). 다른 판형은 파생 문서로(있으면 사람이 고친 그것), 자막 따로 내기의 SRT 는
 * 서버가 영상 옆에 같은 이름으로 둔다.
 */
export interface StudioExport {
  readonly settings: ExportSettings;
  readonly setSettings: (patch: Partial<ExportSettings>) => void;
  readonly presets: readonly ExportPreset[];
  readonly savePreset: (name: string) => void;
  readonly deletePreset: (id: string) => void;
  readonly applyPreset: (id: string) => void;
  /** 기본 대상(이 문서 · 원래 판형 · 전체). */
  readonly defaultTarget: () => ExportTarget;
  /** 계획대로 줄에 세운다 — 세운 수. */
  readonly submit: (target: ExportTarget, mode: ExportMode, at?: number) => Promise<number>;
  readonly renderNow: () => void;
  readonly preset: (format: VideoFormatId) => void;
  readonly png: () => void;
  readonly srt: () => void;
}

export function useStudioExport(d: {
  readonly projectName: string;
  readonly doc: VideoDoc | null;
  readonly docs: readonly DocSummary[];
  readonly timeline: ResolvedTimeline | null;
  readonly render: StudioRender;
  readonly onError: (err: unknown) => void;
  readonly onInfo: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly onSuccess: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly onDerived: () => void;
}): StudioExport {
  const { t } = useTranslation();
  const ref = useRef(d);
  ref.current = d;
  const store = useExportSettings(d.projectName, { onError: d.onError, onSuccess: d.onSuccess });
  const settingsRef = store.settingsRef;

  const defaultTarget = useCallback((): ExportTarget => {
    const { doc, timeline } = ref.current;
    return {
      docIds: doc ? [doc.id] : [],
      ownFormat: true,
      extraFormats: [],
      rangeMode: 'all',
      range: { start: 0, end: timeline?.duration ?? 0 },
      sceneIds: [],
      mutedTracks: [],
    };
  }, []);

  const sceneName = useCallback((index: number, title: string): string => title.trim() || t('panel.videoStudio.strip.chapterN', { n: index + 1 }), [t]);

  const labelOf = useCallback((entry: ExportPlanEntry): string => {
    const where = entry.scene ?? (entry.range ? `${formatClock(entry.range.start)}–${formatClock(entry.range.end)}` : null);
    return [formatRatioLabel(entry.format), where].filter((x): x is string => !!x).join(' · ');
  }, []);

  const submit = useCallback(async (target: ExportTarget, mode: ExportMode, at?: number): Promise<number> => {
    const { doc, docs, timeline, projectName, render } = ref.current;
    if (!doc) return 0;
    const settings = settingsRef.current;
    const pieces = piecesOf(target, timeline ?? resolveTimeline(doc), sceneName);
    if (pieces === null) { ref.current.onInfo('panel.videoStudio.export.badRange'); return 0; }
    const plan = planExportJobs({
      docs: planDocsOf(target, doc, docs), currentDocId: doc.id, ownFormat: target.ownFormat, extraFormats: target.extraFormats, pieces,
    });
    if (plan.entries.length === 0) { ref.current.onInfo('panel.videoStudio.export.nothing'); return 0; }
    const fileName = batchFileName(settings.fileName, plan.entries);
    const notice = { done: t('panel.videoStudio.export.notice.done'), failed: t('panel.videoStudio.export.notice.failed') };
    const derived = new Map<string, string>();
    let made = 0;
    let derivedAny = false;
    try {
      for (const entry of plan.entries) {
        let targetId = entry.doc.id;
        if (entry.derived) {
          const key = `${entry.doc.id}\u0000${entry.format}`;
          let id = derived.get(key);
          if (!id) {
            const r = await deriveDoc(projectName, entry.doc.id, entry.format);
            id = r.doc.id;
            derived.set(key, id);
            if (r.created) {
              derivedAny = true;
              ref.current.onInfo('panel.videoStudio.export.derived', { title: r.doc.title });
            }
          }
          targetId = id;
        }
        const spec = specFromSettings(settings, { mutedTracks: entry.doc.id === doc.id ? target.mutedTracks : [], range: entry.range });
        const job = await render.enqueue(targetId, {
          spec,
          output: {
            dir: settings.outputDir, fileName, conflict: settings.conflict, after: settings.after, keepAwake: settings.keepAwake,
            scene: entry.scene, index: plan.entries.length > 1 ? entry.index : null, notice,
          },
          label: labelOf(entry),
          ...(mode === 'queue' ? { schedule: { hold: true } } : mode === 'schedule' && at !== undefined ? { schedule: { at } } : {}),
        });
        if (job) made += 1;
      }
    } catch (err) {
      ref.current.onError(err);
    }
    if (derivedAny) ref.current.onDerived();
    if (made > 0) {
      if (mode === 'queue') ref.current.onSuccess('panel.videoStudio.export.queued', { count: made });
      else if (mode === 'schedule' && at !== undefined) ref.current.onSuccess('panel.videoStudio.export.scheduled', { count: made, time: new Date(at).toLocaleString() });
      else ref.current.onSuccess('panel.videoStudio.export.started', { count: made });
    }
    if (plan.truncated) ref.current.onInfo('panel.videoStudio.export.truncated', { count: plan.entries.length });
    return made;
  }, [t, sceneName, labelOf, settingsRef]);

  const renderNow = useCallback((): void => { void submit(defaultTarget(), 'now'); }, [submit, defaultTarget]);
  const preset = useCallback((format: VideoFormatId): void => {
    void submit({ ...defaultTarget(), ownFormat: false, extraFormats: [format] }, 'now');
  }, [submit, defaultTarget]);

  // §5.13 (Y) 40-5 ③ — 손잡이는 렌더마다 새로 만들지 않는다(머리줄의 내보내기 메뉴 함수가 이 값들에 기대어 정체로 비교된다).
  const png = useCallback((): void => { void ref.current.render.savePng(); }, []);
  const srt = useCallback((): void => {
    const doc = ref.current.doc;
    if (!doc) return;
    const text = buildSrt(doc, resolveTimeline(doc));
    if (text.trim() === '') { ref.current.onInfo('panel.videoStudio.export.noCaptions'); return; }
    downloadText(text, `${doc.title || doc.id}.srt`);
  }, []);

  const { settings, setSettings, presets, savePreset, deletePreset, applyPreset } = store;
  return useMemo(() => ({
    settings, setSettings, presets, savePreset, deletePreset, applyPreset, defaultTarget, submit, renderNow, preset, png, srt,
  }), [settings, setSettings, presets, savePreset, deletePreset, applyPreset, defaultTarget, submit, renderNow, preset, png, srt]);
}
