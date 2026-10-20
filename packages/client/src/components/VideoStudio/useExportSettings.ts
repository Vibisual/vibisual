import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings, type ExportPreset, type ExportSettings } from '@vibisual/video';

import { deleteExportPreset, readExportSettings, saveExportPreset, saveExportSettings } from './videoApi.js';

/**
 * §5.13 (AA) 42-1 — 내보내기 설정을 **프로젝트마다** 기억한다(`export-settings.json` — 앱 데이터). 바꾸는 즉시 화면이 따르고, 저장은
 * 뒤에서 한 번(통합 앱의 요청은 IPC 직결 — 기다리지 않는다). 창을 닫거나 프로젝트를 바꾸면 미뤄 둔 저장을 바로 한다.
 */
export interface ExportSettingsState {
  readonly settings: ExportSettings;
  /** 지금 설정(렌더를 거는 손잡이가 렌더마다 다시 만들어지지 않게 읽는 자리). */
  readonly settingsRef: MutableRefObject<ExportSettings>;
  readonly setSettings: (patch: Partial<ExportSettings>) => void;
  readonly presets: readonly ExportPreset[];
  readonly savePreset: (name: string) => void;
  readonly deletePreset: (id: string) => void;
  readonly applyPreset: (id: string) => void;
}

/** 설정을 저장하기 전에 기다리는 시간(ms) — 칸을 연달아 바꾸는 동안 한 번만 쓴다. */
const SETTINGS_SAVE_DELAY_MS = 400;

export function useExportSettings(projectName: string, cb: {
  readonly onError: (err: unknown) => void;
  readonly onSuccess: (key: string, values?: Readonly<Record<string, string | number>>) => void;
}): ExportSettingsState {
  const ref = useRef({ projectName, ...cb });
  ref.current = { projectName, ...cb };
  const [state, setState] = useState<{ project: string; settings: ExportSettings; presets: readonly ExportPreset[] }>({ project: '', settings: DEFAULT_EXPORT_SETTINGS, presets: [] });
  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 아직 저장하지 않은 마지막 설정(창을 닫는 순간에도 잃지 않게 — 닫힐 때 바로 쓴다). */
  const unsaved = useRef<{ project: string; settings: ExportSettings } | null>(null);

  // 프로젝트마다 마지막 설정을 읽는다(다른 탭의 설정이 새지 않게 — §3.5). 못 읽으면 기본값으로 쓴다.
  useEffect(() => {
    let alive = true;
    setState({ project: projectName, settings: DEFAULT_EXPORT_SETTINGS, presets: [] });
    if (!projectName) return undefined;
    void Promise.resolve().then(() => readExportSettings(projectName))
      .then((env) => { if (alive) setState({ project: projectName, settings: normalizeExportSettings(env.last), presets: env.presets }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [projectName]);

  const flushSettings = useCallback((): void => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const pending = unsaved.current;
    unsaved.current = null;
    if (pending) void Promise.resolve().then(() => saveExportSettings(pending.project, pending.settings)).catch((err: unknown) => ref.current.onError(err));
  }, []);
  // 창을 닫거나 프로젝트를 바꾸면 미뤄 둔 저장을 바로 한다.
  useEffect(() => flushSettings, [projectName, flushSettings]);

  const setSettings = useCallback((patch: Partial<ExportSettings>): void => {
    const project = ref.current.projectName;
    const next = normalizeExportSettings({ ...settingsRef.current, ...patch, after: { ...settingsRef.current.after, ...(patch.after ?? {}) } });
    settingsRef.current = next;
    setState((s) => ({ ...s, settings: next }));
    unsaved.current = { project, settings: next };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSettings, SETTINGS_SAVE_DELAY_MS);
  }, [flushSettings]);

  const savePreset = useCallback((name: string): void => {
    const project = ref.current.projectName;
    void saveExportPreset(project, name, settingsRef.current)
      .then((env) => { setState((s) => (s.project === project ? { ...s, presets: env.presets } : s)); ref.current.onSuccess('panel.videoStudio.export.presetSaved', { name }); })
      .catch((err: unknown) => ref.current.onError(err));
  }, []);

  const deletePreset = useCallback((id: string): void => {
    const project = ref.current.projectName;
    void deleteExportPreset(project, id)
      .then((env) => setState((s) => (s.project === project ? { ...s, presets: env.presets } : s)))
      .catch((err: unknown) => ref.current.onError(err));
  }, []);

  const presets = state.presets;
  const applyPreset = useCallback((id: string): void => {
    const found = presets.find((p) => p.id === id);
    if (found) setSettings(found.settings);
  }, [presets, setSettings]);

  return { settings: state.settings, settingsRef, setSettings, presets, savePreset, deletePreset, applyPreset };
}
