import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppBubble } from '@vibisual/shared';

import { getInternalApp } from '../../apps/registry.js';
import { useAppInstall } from '../../apps/useAppInstall.js';
import { useGraphStore } from '../../stores/graphStore.js';

interface Props {
  bubble: AppBubble;
}

/**
 * §5.13 (M) v4.68 — 앱 버블 전용 DetailPanel 섹션.
 *
 * 종전에 **우클릭 메뉴에만** 있던 조작(열기·설치·이름 바꾸기·고정·삭제)을 다른 버블처럼
 * "선택 → 우측 옵션 패널"로도 낸다. 메뉴를 없애지는 않는다 — 캔버스에서 바로 쓰는 손과
 * 패널에서 차분히 고치는 손은 다르고, 둘 다 **store 의 같은 함수**를 부르므로 갈라지지 않는다.
 *
 * 특정 앱을 알지 않는다. 색·아이콘·이름·설명·용량·여는 방법은 전부 `appId` 로 레지스트리에서
 * 꺼내므로, 앱이 늘어도 이 파일은 그대로다(§5.13 (P) 독립 규약).
 */
export function AppBubbleDetail({ bubble }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(bubble.appId);
  const projects = useGraphStore((s) => s.projects);
  const renameAppBubble = useGraphStore((s) => s.renameAppBubble);
  const setAppBubblePin = useGraphStore((s) => s.setAppBubblePin);
  const deleteAppBubble = useGraphStore((s) => s.deleteAppBubble);
  const { isInstalled, setInstalled, busy: installBusy } = useAppInstall();
  const installed = isInstalled(bubble.appId);
  const isPinned = bubble.preservePinned === true;

  // 이름 입력 — 타이핑 중에는 로컬 값이 권위다(매 글자 PATCH ❌). 저장은 Enter·포커스 아웃에서.
  const [draft, setDraft] = useState(bubble.title ?? '');
  useEffect(() => {
    setDraft(bubble.title ?? '');
  }, [bubble.id, bubble.title]);

  const commitName = useCallback((): void => {
    if (draft.trim() === (bubble.title ?? '').trim()) return;
    renameAppBubble(bubble.id, draft);
  }, [draft, bubble.title, bubble.id, renameAppBubble]);

  const open = useCallback((): void => {
    if (!app) return;
    const info = Object.values(projects).find((p) => p.name === bubble.projectName);
    const projectId = info?.path ?? bubble.projectName;
    void app.open({ projectId, ref: bubble.ref });
  }, [app, projects, bubble.projectName, bubble.ref]);

  const appName = app ? t(app.nameKey, { defaultValue: app.name }) : bubble.appId;

  return (
    <div className="flex flex-col gap-5">
      {/* 무슨 앱인가 — 아이콘·이름·설명·설치 상태 */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t('panel.apps.detail.app', { defaultValue: '앱' })}</SectionLabel>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-200"
            style={app ? { backgroundColor: `${app.color}66`, color: app.glow } : undefined}
          >
            {app ? <app.icon /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-semibold text-gray-100">{appName}</span>
            {app ? (
              <span className="truncate text-[10px] text-gray-500">
                {t(app.descKey, { defaultValue: '' })}
              </span>
            ) : null}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              installed ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.06] text-gray-400'
            }`}
          >
            {installed
              ? t('panel.apps.detail.installed', { defaultValue: '설치됨' })
              : t('panel.apps.notInstalledBadge', { defaultValue: '설치 필요' })}
          </span>
        </div>
        {app ? (
          <div className="flex gap-2">
            <GhostButton
              onClick={open}
              disabled={!installed}
              tone="accent"
              label={t('panel.apps.open', { defaultValue: '열기' })}
            >
              <path d="M15 3h6v6" /><path d="M10 14 21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </GhostButton>
            <GhostButton
              onClick={() => { void setInstalled(bubble.appId, !installed); }}
              disabled={installBusy}
              label={
                installed
                  ? t('panel.apps.uninstallApp', { defaultValue: '앱 삭제(제거)' })
                  : `${t('panel.apps.installApp', { defaultValue: '앱 설치' })} · ${app.install.sizeHint}`
              }
            >
              {installed
                ? <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>
                : <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></>}
            </GhostButton>
          </div>
        ) : (
          <p className="text-[10px] leading-snug text-amber-300/80">
            {t('panel.apps.detail.unknownHint', {
              defaultValue: '이 앱은 지금 버전에 없습니다. 버블은 지울 수 있습니다.',
            })}
          </p>
        )}
        {!installed && app ? (
          <p className="text-[10px] leading-snug text-gray-500">
            {t('panel.apps.detail.installHint', {
              defaultValue: '설치해야 열 수 있습니다. 캔버스에서 버블을 더블클릭해도 설치됩니다.',
            })}
          </p>
        ) : null}
      </section>

      {/* 이 버블 — 이름 */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t('panel.apps.detail.bubble', { defaultValue: '이 버블' })}</SectionLabel>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setDraft(bubble.title ?? '');
          }}
          placeholder={appName}
          className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-2 text-xs text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-sky-400/60"
        />
        <p className="text-[10px] leading-snug text-gray-500">
          {t('panel.apps.detail.nameHint', { defaultValue: '비우면 앱 이름으로 돌아갑니다.' })}
        </p>
      </section>

      {/* 보호 — 고정 */}
      <section className="flex flex-col gap-2.5">
        <SectionLabel>{t('panel.apps.detail.protection', { defaultValue: '보호' })}</SectionLabel>
        <SwitchRow
          label={t('panel.apps.pin', { defaultValue: '고정' })}
          hint={t('panel.apps.detail.pinHint', {
            defaultValue: '켜면 Delete 키·삭제로 지워지지 않습니다.',
          })}
          checked={isPinned}
          onChange={(v) => setAppBubblePin(bubble.id, v)}
        />
      </section>

      {/* 위험 구역 — 삭제 */}
      <div className="mt-1 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          disabled={isPinned}
          title={isPinned
            ? t('panel.apps.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' })
            : undefined}
          onClick={() => { void deleteAppBubble(bubble.id); }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs text-rose-300 transition-colors hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-100 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.02] disabled:text-gray-600 disabled:hover:bg-white/[0.02]"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
          {t('panel.apps.detail.deleteBubble', { defaultValue: '이 버블 삭제' })}
        </button>
        <p className="mt-1.5 text-center text-[10px] leading-snug text-gray-500">
          {isPinned
            ? t('panel.apps.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' })
            : t('panel.apps.detail.deleteHint', { defaultValue: 'Delete 키로도 지울 수 있습니다. 앱은 지워지지 않습니다.' })}
        </p>
      </div>
    </div>
  );
}

/** 섹션 머리 라벨 — 캡처 버블 패널과 같은 톤(작은 대문자 + 액센트 점). */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1 w-1 rounded-full bg-sky-400" />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</span>
    </div>
  );
}

interface GhostButtonProps {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'accent';
  disabled?: boolean;
  children: React.ReactNode;
}

/** 아이콘 + 라벨 고스트 버튼. */
function GhostButton({ label, onClick, tone = 'default', disabled = false, children }: GhostButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.02] disabled:text-gray-600 ${
        tone === 'accent'
          ? 'border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20'
          : 'border-white/[0.07] bg-white/[0.03] text-gray-300 hover:border-sky-400/40 hover:bg-white/[0.06] hover:text-sky-200'
      }`}
    >
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** 라벨 + 설명 + 스위치 한 줄 — 캡처 버블 패널과 같은 토글. */
function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-gray-300">{label}</span>
        {hint && <span className="text-[10px] leading-snug text-gray-500">{hint}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className={`block h-4 w-7 rounded-full transition-colors ${checked ? 'bg-sky-400' : 'bg-white/[0.12]'}`} />
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${checked ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </label>
  );
}
