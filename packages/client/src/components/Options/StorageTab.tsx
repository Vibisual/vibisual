import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NumericRetentionKey,
  RetentionLogEntry,
  RetentionSettings,
  StorageCleanupResult,
  StorageUsageKind,
  StorageUsageReport,
} from '@vibisual/shared';
import { DEFAULT_RETENTION_SETTINGS, RETENTION_LIMITS } from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

const API_BASE = '';

/**
 * §3.2.3 — 옵션창 Storage 탭: 보존 설정(여섯 축, `0`=무제한으로 끈다) + 저장소 사용량(어디가 몇 MB 인지 상시).
 * 워크트리는 자동 삭제하지 않는다 — 사용자 산출물이 섞일 수 있어 목록으로만 보인다.
 */

/** 사람이 읽는 크기. 0 이면 대시(비어 있음을 0B 로 쓰면 오히려 안 읽힌다). */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 보존 축의 표시 순서 + 단위(`0` 의 뜻이 축마다 달라 문구를 따로 준다). `auditEntryMaxPerProject` 는 §5.22 타임라인 팝업과 같은 값이다. */
/** 숫자 축만 선다 — 스위치(§5.26 `insuranceMirror`)가 섞여 키는 `NumericRetentionKey` 다(그래야 `RETENTION_LIMITS[key]` 가 된다). 스위치는 `SWITCHES` 가 그린다. */
const FIELDS: { key: NumericRetentionKey; unit: 'days' | 'count' | 'seconds' | 'megabytes' }[] = [
  { key: 'fileEditRetentionDays', unit: 'days' },
  { key: 'maxFileEditPaths', unit: 'count' },
  { key: 'fileEditMergeWindowMs', unit: 'seconds' },
  { key: 'completedCommandMaxPerSession', unit: 'count' },
  { key: 'subStreamRetentionDays', unit: 'days' },
  { key: 'attachmentRetentionDays', unit: 'days' },
  { key: 'auditEntryMaxPerProject', unit: 'count' },
  { key: 'trashRetentionDays', unit: 'days' },
  // §5.26 — 컨텍스트 보험. 나이 한 축 + 저장고 예산 한 축.
  { key: 'insuranceRetentionDays', unit: 'days' },
  { key: 'insuranceVaultMaxMB', unit: 'megabytes' },
];

/** 켬/끔으로만 있는 축 — 숫자 칸으로 그릴 수 없어 표를 나눈다. */
const SWITCHES: { key: 'insuranceMirror' }[] = [
  { key: 'insuranceMirror' },
];

const USAGE_KIND_ORDER: StorageUsageKind[] = [
  'checkpoint', 'activity', 'identity', 'checkpointBackups',
  'subStreams', 'attachments', 'insurance', 'trash', 'skills', 'logs', 'video', 'other',
];

interface StorageTabProps {
  /** "저장 안 하고 나가기" 가드가 이 탭의 dirty 를 알게 올린다(언마운트 때 `false`). */
  onDirtyChange?: (dirty: boolean) => void;
}

export function StorageTab({ onDirtyChange }: StorageTabProps = {}): React.JSX.Element {
  const { t } = useTranslation();

  const [settings, setSettings] = useState<RetentionSettings>(DEFAULT_RETENTION_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<RetentionSettings>(DEFAULT_RETENTION_SETTINGS);
  const [usage, setUsage] = useState<StorageUsageReport | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'scan' | 'clean' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<StorageCleanupResult | null>(null);
  /** 휴지통 목록 = 복원 가능한 것 목록(§3.2.3 규칙 3·4). 서버가 폴더를 훑어 만든 것을 그대로 그린다. */
  const [trash, setTrash] = useState<{ entries: RetentionLogEntry[]; totalBytes: number } | null>(null);
  /** 복원 중인 항목의 `trashRel` — 버튼 하나만 잠그기 위해 id 로 들고 있는다. */
  const [restoring, setRestoring] = useState<string | null>(null);

  const dirty = useMemo(
    () => FIELDS.some((f) => settings[f.key] !== savedSettings[f.key])
      || SWITCHES.some((f) => settings[f.key] !== savedSettings[f.key]),
    [settings, savedSettings],
  );

  const loadSettings = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/retention-settings`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: RetentionSettings };
      setSettings(data.settings);
      setSavedSettings(data.settings);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, []);

  const scanUsage = useCallback(async () => {
    setBusy('scan');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/storage-usage`);
      if (!res.ok) throw new Error(String(res.status));
      setUsage(await res.json() as StorageUsageReport);
    } catch {
      setError('scan');
    } finally {
      setBusy(null);
    }
  }, []);

  const loadTrash = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/retention-trash`);
      if (!res.ok) throw new Error(String(res.status));
      setTrash(await res.json() as { entries: RetentionLogEntry[]; totalBytes: number });
    } catch {
      setTrash(null); // 목록을 못 받은 것은 치명적이지 않다 — 설정·실측은 그대로 보여 준다
    }
  }, []);

  const handleRestore = useCallback(async (entry: RetentionLogEntry) => {
    setRestoring(entry.trashRel);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/retention-trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: entry.projectPath, trashRel: entry.trashRel }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await loadTrash();
      void scanUsage();
    } catch {
      setError('restore');
    } finally {
      setRestoring(null);
    }
  }, [loadTrash, scanUsage]);

  // 탭을 열면 설정과 실측을 한 번 받아 온다(디스크를 훑으므로 여기서만 돈다).
  useEffect(() => { void loadSettings(); void scanUsage(); void loadTrash(); }, [loadSettings, scanUsage, loadTrash]);

  // 미저장 여부를 옵션창에 알려 나가기 가드에 태운다. 언마운트(탭 이동·창 닫힘) 때는 해제한다 —
  // 편집분이 이 컴포넌트 state 와 함께 사라지므로 창에 dirty 가 남아 있으면 유령 경고가 된다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const handleSave = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/retention-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { settings: RetentionSettings };
      setSettings(data.settings);
      setSavedSettings(data.settings);
      void scanUsage(); // 상한을 내렸으면 즉시 반영되므로 실측도 새로 받는다
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [settings, scanUsage]);

  const handleCleanup = useCallback(async () => {
    setBusy('clean');
    setError(null);
    setCleanResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/storage-cleanup`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      setCleanResult(await res.json() as StorageCleanupResult);
      void scanUsage();
      void loadTrash(); // 방금 치운 것이 복원 목록에 바로 뜨게 한다

    } catch {
      setError('clean');
    } finally {
      setBusy(null);
    }
  }, [scanUsage, loadTrash]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── 머리말 ── */}
      <div>
        <h4 className="text-sm font-semibold text-gray-200">
          {t('panel.options.categories.storage', { defaultValue: 'Storage' })}
        </h4>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          {t('panel.options.storage.intro', {
            defaultValue: 'How long Vibisual keeps activity history on disk. Set any value to 0 to keep it forever — nothing is deleted silently, and live sessions are never touched.',
          })}
        </p>
      </div>

      {/* ── 보존 설정 6축 ── */}
      <div className="flex flex-col gap-2">
        {FIELDS.map(({ key, unit }) => {
          const lim = RETENTION_LIMITS[key];
          const value = settings[key];
          const shown = unit === 'seconds' ? Math.round(value / 1000) : value;
          const step = unit === 'seconds' ? 1 : lim.step;
          return (
            // 폰 폭에서는 설명을 자르지 않고 한 줄을 다 쓰게 한 뒤 스테퍼를 아랫줄로 내린다 —
            //   옆에 두면 설명이 스무 자 남짓에서 … 로 잘려 무슨 칸인지 읽을 수 없었다.
            <label key={key} className="flex items-center justify-between gap-3 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2 max-md:flex-wrap">
              <span className="flex min-w-0 flex-col max-md:basis-full">
                <span className="truncate text-xs text-gray-200 max-md:whitespace-normal">
                  {t(`panel.options.storage.fields.${key}.label`, { defaultValue: key })}
                </span>
                <span className="truncate text-[12px] leading-relaxed text-gray-500 max-md:whitespace-normal">
                  {t(`panel.options.storage.fields.${key}.desc`, { defaultValue: '' })}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <NumberStepper
                  min={unit === 'seconds' ? 0 : lim.min}
                  max={unit === 'seconds' ? Math.round(lim.max / 1000) : lim.max}
                  step={step}
                  value={shown}
                  widthClassName="w-16"
                  ariaLabel={t(`panel.options.storage.fields.${key}.label`, { defaultValue: key })}
                  onChange={(next) => {
                    setSettings((s) => ({ ...s, [key]: unit === 'seconds' ? next * 1000 : next }));
                  }}
                />
                <span className="w-12 text-[12px] text-gray-500">
                  {t(`panel.options.storage.units.${unit}`, { defaultValue: unit })}
                </span>
              </span>
            </label>
          );
        })}

        {/* §5.26 — 켬/끔 축. 끄면 마커(수백 바이트)만 남고 트랜스크립트 사본은 뜨지 않는다. */}
        {SWITCHES.map(({ key }) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-gray-200 max-md:whitespace-normal">
                {t(`panel.options.storage.fields.${key}.label`, { defaultValue: key })}
              </span>
              <span className="truncate text-[12px] leading-relaxed text-gray-500 max-md:whitespace-normal">
                {t(`panel.options.storage.fields.${key}.desc`, { defaultValue: '' })}
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
              aria-label={t(`panel.options.storage.fields.${key}.label`, { defaultValue: key })}
              className="h-4 w-4 shrink-0 accent-blue-500"
            />
          </label>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={!dirty || busy !== null}
            onClick={() => { void handleSave(); }}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-blue-500"
          >
            {busy === 'save'
              ? t('panel.options.storage.saving', { defaultValue: 'Saving…' })
              : t('panel.options.storage.save', { defaultValue: 'Apply' })}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setSettings(DEFAULT_RETENTION_SETTINGS)}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-white/[0.04]"
          >
            {t('panel.options.storage.reset', { defaultValue: 'Restore defaults' })}
          </button>
          {dirty && (
            <span className="text-[12px] text-amber-400">
              {t('panel.options.storage.unsaved', { defaultValue: 'Not applied yet' })}
            </span>
          )}
        </div>
      </div>

      {/* ── 저장소 사용량 ── */}
      <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
        <div className="flex items-center justify-between gap-2 max-md:flex-wrap">
          <h4 className="text-sm font-semibold text-gray-200">
            {t('panel.options.storage.usageTitle', { defaultValue: 'Disk usage' })}
          </h4>
          <span className="flex items-center gap-2 max-md:flex-wrap">
            {usage && (
              <span className="text-[12px] text-gray-400">
                {t('panel.options.storage.total', { defaultValue: 'Total' })} <span className="font-medium text-gray-200">{formatBytes(usage.totalBytes)}</span>
              </span>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => { void scanUsage(); }}
              className="flex items-center gap-1 whitespace-nowrap rounded border border-gray-700 px-2 py-1 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.04] pointer-coarse:py-2"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>
              {busy === 'scan'
                ? t('panel.options.storage.scanning', { defaultValue: 'Scanning…' })
                : t('panel.options.storage.rescan', { defaultValue: 'Rescan' })}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => { void handleCleanup(); }}
              className="flex items-center gap-1 whitespace-nowrap rounded border border-gray-700 px-2 py-1 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.04] pointer-coarse:py-2"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
              {busy === 'clean'
                ? t('panel.options.storage.cleaning', { defaultValue: 'Cleaning…' })
                : t('panel.options.storage.cleanNow', { defaultValue: 'Clean now' })}
            </button>
          </span>
        </div>

        {cleanResult && (
          <p className="rounded border border-emerald-700/40 bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-200">
            {t('panel.options.storage.cleaned', {
              defaultValue: 'Moved {{files}} file(s) ({{size}}) to the trash — restore them below while they are still there.',
              files: cleanResult.removedFiles,
              size: formatBytes(cleanResult.freedBytes),
            })}
            {(cleanResult.purgedFiles ?? 0) > 0 && (
              <span className="ml-1">
                {t('panel.options.storage.purged', {
                  defaultValue: 'Permanently deleted {{files}} expired trash file(s) ({{size}}).',
                  files: cleanResult.purgedFiles,
                  size: formatBytes(cleanResult.purgedBytes ?? 0),
                })}
              </span>
            )}
            {(cleanResult.keptReferenced ?? 0) > 0 && (
              <span className="ml-1">
                {t('panel.options.storage.keptReferenced', {
                  defaultValue: 'Kept {{files}} still-referenced file(s) regardless of age.',
                  files: cleanResult.keptReferenced,
                })}
              </span>
            )}
            {cleanResult.skipped.length > 0 && (
              <span className="ml-1 text-emerald-300/70">({cleanResult.skipped.join(' · ')})</span>
            )}
          </p>
        )}

        {usage?.projects.map((p) => (
          <div key={p.projectPath} className="rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium text-gray-200" title={p.projectPath}>{p.projectName}</span>
              <span className="shrink-0 text-[12px] text-gray-400">{formatBytes(p.totalBytes)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {USAGE_KIND_ORDER.map((kind) => {
                const e = p.entries.find((x) => x.kind === kind);
                if (!e) return null;
                return (
                  <span key={kind} className="text-[12px] text-gray-500">
                    {t(`panel.options.storage.kinds.${kind}`, { defaultValue: kind })}
                    <span className="ml-1 text-gray-400">{formatBytes(e.bytes)}</span>
                    {e.fileCount > 1 && <span className="ml-1 text-gray-600">({e.fileCount})</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}

        {usage && usage.worktrees.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            <p className="text-[12px] text-gray-400">
              {t('panel.options.storage.worktreesTitle', { defaultValue: 'Git worktrees' })}
              <span className="ml-1 text-[12px] text-gray-500">
                {t('panel.options.storage.worktreesNote', {
                  defaultValue: 'Never removed automatically — these may hold your work. Delete the folder yourself if you no longer need it.',
                })}
              </span>
            </p>
            {usage.worktrees.map((w) => (
              <div key={w.path} className="flex items-baseline justify-between gap-2 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-1.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[12px] text-gray-300" title={w.path}>{w.name}</span>
                  {!w.alive && (
                    <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[12px] text-amber-300">
                      {t('panel.options.storage.worktreeOrphan', { defaultValue: 'orphaned' })}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[12px] text-gray-400">{formatBytes(w.bytes)}</span>
              </div>
            ))}
          </div>
        )}

        {usage && usage.projects.length === 0 && (
          <p className="text-[12px] text-gray-500">
            {t('panel.options.storage.empty', { defaultValue: 'No project data on disk yet.' })}
          </p>
        )}
      </div>

      {/* ── 휴지통 = 되돌릴 수 있는 것 목록 (§3.2.3 규칙 3·4) ── */}
      <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-200">
            {t('panel.options.storage.trashTitle', { defaultValue: 'Trash' })}
          </h4>
          {trash && trash.entries.length > 0 && (
            <span className="text-[12px] text-gray-400">{formatBytes(trash.totalBytes)}</span>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-gray-500">
          {settings.trashRetentionDays > 0
            ? t('panel.options.storage.trashNote', {
              defaultValue: 'Cleanup moves files here instead of deleting them. You can restore anything listed until it is {{days}} day(s) old.',
              days: settings.trashRetentionDays,
            })
            : t('panel.options.storage.trashNoteForever', {
              defaultValue: 'Cleanup moves files here instead of deleting them. Nothing here is ever deleted automatically.',
            })}
        </p>

        {trash && trash.entries.length === 0 && (
          <p className="text-[12px] text-gray-500">
            {t('panel.options.storage.trashEmpty', { defaultValue: 'Trash is empty — nothing has been cleaned up.' })}
          </p>
        )}

        {trash?.entries.map((e) => (
          <div key={`${e.projectPath}|${e.trashRel}`} className="flex items-center justify-between gap-2 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-1.5">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] text-gray-300" title={e.originalPath}>
                {e.trashRel.split('/').pop()}
              </span>
              <span className="truncate text-[12px] text-gray-500">
                {t(`panel.options.storage.kinds.${e.kind}`, { defaultValue: e.kind })}
                <span className="mx-1 text-gray-600">·</span>
                {e.projectName}
                <span className="mx-1 text-gray-600">·</span>
                {new Date(e.at).toLocaleDateString()}
                <span className="mx-1 text-gray-600">·</span>
                {formatBytes(e.bytes)}
              </span>
            </span>
            <button
              type="button"
              disabled={restoring !== null}
              onClick={() => { void handleRestore(e); }}
              className="flex shrink-0 items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.04]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /></svg>
              {restoring === e.trashRel
                ? t('panel.options.storage.restoring', { defaultValue: 'Restoring…' })
                : t('panel.options.storage.restore', { defaultValue: 'Restore' })}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-[12px] text-red-400">
          {t(`panel.options.storage.error.${error}`, { defaultValue: 'Request failed. Please try again.' })}
        </p>
      )}
    </div>
  );
}
