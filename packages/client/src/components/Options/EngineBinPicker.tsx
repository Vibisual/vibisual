import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedEngineStatus } from '@vibisual/shared';

/**
 * §4 (앱 전용 엔진) ④⑨ — Version 탭 실행본 고르기(Claude·코덱스 공용). 기본 = 앱 전용, 나머지 = 보조가 구조로 보여야 한다.
 * 첫 줄 = 앱 전용(기본·자동 업데이트, 사용자 지정 없음). 아래 = 다른 설치본(보조) — 앱 전용 판은 다시 싣지 않고, 기본인데 다른 것이 쓰이는 동안은 `임시`.
 * `active`·`selected` 는 서버 판정 그대로(§3.1).
 */

export interface EngineBinRow {
  binPath: string;
  source: string;
  version: string | null;
  detectError?: string;
  active: boolean;
  selected: boolean;
}

/** 같은 모양의 작은 칩 — 출처 배지 곁에 붙는다. */
function Chip({ tone, children }: { tone: 'default' | 'temporary' | 'active'; children: React.ReactNode }): React.JSX.Element {
  const cls = tone === 'default'
    ? 'bg-indigo-500/20 text-indigo-200'
    : tone === 'temporary'
      ? 'bg-amber-500/20 text-amber-200'
      : 'bg-emerald-500/20 text-emerald-300';
  return <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider ${cls}`}>{children}</span>;
}

export function DefaultChip(): React.JSX.Element {
  const { t } = useTranslation();
  return <Chip tone="default">{t('panel.options.version.defaultBadge', { defaultValue: 'Default' })}</Chip>;
}

export function TemporaryChip(): React.JSX.Element {
  const { t } = useTranslation();
  return <Chip tone="temporary">{t('panel.options.version.temporaryBadge', { defaultValue: 'Temporary' })}</Chip>;
}

/** 라디오 동그라미 — 두 묶음이 같은 꼴을 쓴다. */
function Radio({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-blue-400' : 'border-gray-600'}`}>
      {on && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
    </span>
  );
}

export function EngineBinPicker({
  managed,
  isDefault,
  rows,
  saving,
  onSelect,
  renderSource,
}: {
  /** 앱 전용 사본의 상태(서버가 폴더를 훑어 만든 그대로) — 아직 모르면 없음. */
  managed: ManagedEngineStatus | undefined;
  /** 사용자 지정이 없는가(= 기본 · 앱 전용). */
  isDefault: boolean;
  /** 설치본 전부 — 앱 전용(`source === 'managed'`)은 기본 줄이 맡으므로 다른 설치본 묶음에서 뺀다. */
  rows: readonly EngineBinRow[];
  saving: boolean;
  /** null = 기본(앱 전용)으로. */
  onSelect: (binPath: string | null) => void;
  renderSource: (source: string) => React.JSX.Element;
}): React.JSX.Element {
  const { t } = useTranslation();
  const others = rows.filter((r) => r.source !== 'managed');
  const managedActive = rows.some((r) => r.source === 'managed' && r.active);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('panel.options.version.chooseBinary', { defaultValue: 'Which binary to use' })}
      </span>
      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 p-2">
        {/* 기본 — Vibisual 전용 */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          disabled={saving || isDefault}
          className={`flex items-start gap-2 rounded border px-2.5 py-2 text-left text-xs ${
            isDefault ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/60 hover:bg-white/[0.04]'
          } disabled:cursor-default`}
        >
          <Radio on={isDefault} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-gray-100">
                {t('panel.options.version.defaultManaged', { defaultValue: 'App-managed (default · auto-updated)' })}
              </span>
              <DefaultChip />
              {managedActive && (
                <Chip tone="active">{t('panel.options.version.activeBadge', { defaultValue: 'active' })}</Chip>
              )}
            </span>
            <span className="text-[12px] text-gray-400">
              {managed?.active
                ? t('panel.options.version.defaultManagedReady', {
                    version: managed.active.version,
                    defaultValue: 'Using {{version}} — downloaded from the official source and switched in only after passing Vibisual\'s checks.',
                  })
                : t('panel.options.version.defaultManagedPending', {
                    defaultValue: 'Not ready yet — once it is downloaded and checked, Vibisual switches to it right away.',
                  })}
            </span>
          </span>
        </button>

        {/* 보조 — 다른 설치본 */}
        <span className="mt-1 px-0.5 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
          {t('panel.options.version.otherInstalls', { defaultValue: 'Other installations (secondary)' })} ({others.length})
        </span>
        {others.length === 0 && (
          <span className="px-0.5 text-[12px] text-gray-600">
            {t('panel.options.version.otherInstallsNone', { defaultValue: 'No other installations found on this PC.' })}
          </span>
        )}
        {others.map((row) => (
          <button
            key={row.binPath}
            type="button"
            onClick={() => onSelect(row.binPath)}
            disabled={saving || row.selected}
            className={`flex items-start gap-2 rounded border px-2.5 py-1.5 text-left text-xs ${
              row.selected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/60 hover:bg-white/[0.04]'
            } disabled:cursor-default`}
          >
            <Radio on={row.selected} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono font-medium text-gray-200">{row.version ?? t('panel.options.version.unknownVer', { defaultValue: 'unknown' })}</span>
                {renderSource(row.source)}
                {row.active && (isDefault
                  ? <TemporaryChip />
                  : <Chip tone="active">{t('panel.options.version.activeBadge', { defaultValue: 'active' })}</Chip>)}
              </span>
              <span className="break-all font-mono text-[12px] text-gray-500">{row.binPath}</span>
              {row.detectError && <span className="text-[12px] text-red-400/80">{row.detectError}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 기본(앱 전용)인데 아직 다른 설치본이 쓰이는 동안의 한 줄 — 받는 중이면 진행, 실패면 사유와 다음 재시도 시각,
 * 그 밖이면 "준비되면 바로 쓴다". 다시 받는 손잡이는 아래 업데이트 칸의 [지금 업데이트] 하나다(두 번째 손잡이 ❌).
 */
export function ManagedPendingNotice({
  managed,
  running,
  lastLine,
  engineName,
}: {
  managed: ManagedEngineStatus | undefined;
  /** 지금 받기가 도는가(실시간 진행 — WS). */
  running: boolean;
  /** 진행 칸의 마지막 줄. */
  lastLine?: string;
  engineName: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const updateNow = t('panel.options.version.claudeAutoUpdate.updateNow', { defaultValue: 'Update now' });

  if (running || managed?.updating) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5 rounded border border-blue-500/30 bg-blue-500/5 px-2.5 py-1.5 text-[12px] text-blue-200">
        <span>{t('panel.options.version.pending.downloading', { defaultValue: 'Preparing the app-managed copy — downloading and checking…' })}</span>
        {lastLine && <span className="truncate font-mono text-blue-300/80">{lastLine}</span>}
      </div>
    );
  }
  if (managed?.deferred === 'not-in-use') {
    return (
      <div className="rounded border border-gray-700/60 bg-gray-900/40 px-2.5 py-1.5 text-[12px] text-gray-400">
        {t('panel.options.version.managed.deferred', { engine: engineName, defaultValue: "Not downloaded — this PC doesn't use {{engine}} yet. It is downloaded when you install it." })}
      </div>
    );
  }
  const failure = managed?.failedProbes && managed.failedProbes.length > 0
    ? t('panel.options.version.managed.rejected', {
        version: managed.latest ?? '?',
        options: managed.failedProbes.join(', '),
        defaultValue: 'Not switched in — {{version}} rejected: {{options}}',
      })
    : managed?.lastError ?? null;
  if (failure) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
        <span className="break-words">{t('panel.options.version.pending.failed', { error: failure, defaultValue: "The app-managed copy couldn't be prepared: {{error}}" })}</span>
        <span className="text-amber-200/80">
          {managed?.nextRetryAt
            ? `${t('panel.options.version.pending.retryAt', { time: new Date(managed.nextRetryAt).toLocaleTimeString(i18n.language), defaultValue: 'Retrying automatically at {{time}}.' })} `
            : ''}
          {t('panel.options.version.pending.tryNow', { updateNow, defaultValue: 'Use "{{updateNow}}" below to try again now.' })}
        </span>
      </div>
    );
  }
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
      {t('panel.options.version.pending.waiting', { defaultValue: "The app-managed copy isn't ready yet, so this installation is used for now. It is downloaded automatically." })}
    </div>
  );
}
