import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WEB_GROUP_DEFAULTS,
  WEB_GROUP_MAX_BOUNDS,
  WEB_OPEN_TARGETS,
  WEB_OPEN_TARGET_DEFAULT,
  normalizeWebGroupSettings,
  normalizeWebOpenTarget,
  sameWebGroupSettings,
  type WebGroupSettings,
  type WebOpenTarget,
} from '@vibisual/shared';
import { useWebOpenTargetStore } from '../../stores/webOpenTarget.js';
import { NumberStepper } from './NumberStepper.js';

/**
 * §5.23 웹 버블 묶기 — 에이전트가 읽은 웹을 **무엇으로, 몇 개까지** 묶어 보일지의 손잡이 셋.
 *
 *  (A) 같은 사이트끼리 — `docs.github.com` · `github.com` 처럼 등록 도메인이 같은 호스트를 버블 하나로.
 *  (B) 비슷한 종류끼리 — 넘친 것을 문서·코드 저장소·패키지·질문… 종류로 묶는다.
 *  (C) 에이전트마다 따로 세울 웹 버블 수 — 넘친 만큼만 묶고, 가장 최근에 읽은 곳부터 따로 선다.
 *      `1` 이 종전 [에이전트마다 웹 버블 하나로 접기]다 — 그 체크박스를 이 숫자가 흡수했다(같은 기능에 손잡이 두 벌 ❌).
 *      `0` 은 상한 없음.
 *
 * 묶는 것은 서버가 스냅샷을 실어 보내기 직전에 하는 **보기**라 기록은 하나도 바뀌지 않는다 — 두 칸을 끄고 0 으로 두면
 * 종전처럼 도메인마다 버블이 선다. 고정한 도메인은 묶이지 않고 개수에도 세지 않는다.
 *
 * 설정은 **머신 단위**(`AppState.webGroup`, 기본 켬)라 프로젝트를 옮겨도 같다 — `ExternalFolderSection` 과 같은
 * 문법으로 자기 REST(`/api/web-fold`)를 직접 읽고 쓰고, 미저장만 창에 올린다.
 *
 * §5.23 「더블클릭」 — 같은 칸에 **[더블클릭하면 열 곳]**(`AppState.webOpenTarget`)도 있다. 기본은 바깥 브라우저, 고르면 앱 안
 * iframe 탭(인터넷 페이지는 격리 웹뷰). 같은 저장 단추·같은 기본값 되돌리기를 탄다(칸 하나 = 창구 하나 = 단추 하나).
 */

const API_BASE = '';

interface WebFoldSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface WebFoldResponse {
  group?: unknown;
  openTarget?: unknown;
}

export function WebFoldSection({ onDirtyChange }: WebFoldSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<WebGroupSettings>({ ...WEB_GROUP_DEFAULTS });
  const [saved, setSaved] = useState<WebGroupSettings>({ ...WEB_GROUP_DEFAULTS });
  const [draftTarget, setDraftTarget] = useState<WebOpenTarget>(WEB_OPEN_TARGET_DEFAULT);
  const [savedTarget, setSavedTarget] = useState<WebOpenTarget>(WEB_OPEN_TARGET_DEFAULT);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const radioName = useId();

  const dirty = !sameWebGroupSettings(draft, saved) || draftTarget !== savedTarget;

  /** 화면은 **서버가 돌려준 그 값**을 따라간다 — 서버가 범위 밖 값을 접어 돌려줄 수 있다. */
  const adopt = useCallback((data: WebFoldResponse) => {
    const group = normalizeWebGroupSettings(data.group);
    setDraft(group);
    setSaved(group);
    const target = normalizeWebOpenTarget(data.openTarget);
    setDraftTarget(target);
    setSavedTarget(target);
    // 이 창의 더블클릭도 곧바로 새 값을 쓴다(다른 창은 WS `web_open_target_updated` 가 맞춘다).
    useWebOpenTargetStore.getState().apply(target);
  }, []);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/web-fold`);
      if (!res.ok) throw new Error(String(res.status));
      adopt(await res.json() as WebFoldResponse);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, [adopt]);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      // 칸을 **늘 함께** 보낸다 — 서버는 빠진 칸을 지금 값으로 지키지만, 화면이 아는 완성본을 보내는 쪽이 어긋날 일이 없다.
      const res = await fetch(`${API_BASE}/api/web-fold`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: draft, openTarget: draftTarget }),
      });
      if (!res.ok) throw new Error(String(res.status));
      adopt(await res.json() as WebFoldResponse);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [draft, draftTarget, adopt]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const maxLabel = t('panel.options.advanced.webGroupMaxLabel', {
    defaultValue: 'Web bubbles shown separately per agent',
  });
  const openTargetLabel = t('panel.options.advanced.webOpenTargetLabel', { defaultValue: 'Double-click opens in' });
  const openTargetText: Record<WebOpenTarget, { label: string; description: string }> = {
    external: {
      label: t('panel.options.advanced.webOpenTargetExternal', { defaultValue: 'Your browser' }),
      description: t('panel.options.advanced.webOpenTargetExternalDesc', {
        defaultValue: 'The default. Opens in the browser you normally use.',
      }),
    },
    iframe: {
      label: t('panel.options.advanced.webOpenTargetIframe', { defaultValue: 'In-app iframe tab' }),
      description: t('panel.options.advanced.webOpenTargetIframeDesc', {
        defaultValue: 'Opens a web tab in the tab bar so you can read it inside the app. Internet pages run in a separate sandboxed view with no permissions, and sign-ins are cleared when the app closes.',
      }),
    },
  };
  const disabled = busy !== null;

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.webFoldTitle', { defaultValue: 'Web bubbles' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.webFoldIntro', {
          defaultValue: 'When an agent reads the web, every domain it reads becomes a bubble, so one agent researching can cover the canvas. These settings group them — nothing is deleted, and clicking a group lists its domains one by one.',
        })}
      </p>

      <WebGroupCheckbox
        checked={draft.sameSite}
        disabled={disabled}
        onChange={(sameSite) => setDraft((d) => ({ ...d, sameSite }))}
        label={t('panel.options.advanced.webGroupSameSite', { defaultValue: 'Group domains of the same site' })}
        description={t('panel.options.advanced.webGroupSameSiteDesc', {
          defaultValue: 'Subdomains of one site, like docs.github.com and github.com, share a single bubble named after the site.',
        })}
      />
      {/* "그 밖의 웹" 은 캔버스 버블의 제목이라 번역된 그 이름을 받아 적는다(docs/rules/i18n.md — 라벨은 보간으로). */}
      <WebGroupCheckbox
        checked={draft.byKind}
        disabled={disabled}
        onChange={(byKind) => setDraft((d) => ({ ...d, byKind }))}
        label={t('panel.options.advanced.webGroupByKind', { defaultValue: 'Group similar kinds of sites' })}
        description={t('panel.options.advanced.webGroupByKindDesc', {
          other: t('canvas.webFold.rest'),
          defaultValue: 'When there are more than the number below, sites of the same kind — docs, code, packages, Q&A and so on — share one bubble. Sites whose kind is unclear go into "{{other}}".',
        })}
      />

      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="text-xs text-gray-200">{maxLabel}</label>
        <NumberStepper
          value={draft.maxPerAgent}
          onChange={(maxPerAgent) => setDraft((d) => ({ ...d, maxPerAgent }))}
          min={WEB_GROUP_MAX_BOUNDS.MIN}
          max={WEB_GROUP_MAX_BOUNDS.MAX}
          step={1}
          disabled={disabled}
          widthClassName="w-20"
          ariaLabel={maxLabel}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.webGroupMaxDesc', {
            defaultValue: 'Up to this many stand on their own, the most recently read first; the rest are grouped. 1 folds everything an agent read into one bubble, and 0 means no limit. Pinned domains always keep their own bubble and do not count.',
          })}
        </p>
      </div>

      {/* §5.23 「더블클릭」 — 웹 버블을 더블클릭하면 마지막으로 읽은 주소를 어디서 여는가. 기본은 바깥 브라우저(사용자 지시). */}
      <div
        role="radiogroup"
        aria-label={openTargetLabel}
        className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5"
      >
        <span className="text-xs text-gray-200">{openTargetLabel}</span>
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.webOpenTargetDesc', {
            defaultValue: 'Double-clicking a web bubble opens the last address it read (for the search bubble, the last search).',
          })}
        </p>
        {WEB_OPEN_TARGETS.map((target) => (
          <label
            key={target}
            className={`flex items-start gap-2.5 rounded px-1 py-1 ${disabled ? 'opacity-40' : 'cursor-pointer hover:bg-white/[0.03]'}`}
          >
            <input
              type="radio"
              name={radioName}
              value={target}
              checked={draftTarget === target}
              disabled={disabled}
              onChange={() => setDraftTarget(target)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-gray-200">{openTargetText[target].label}</span>
              <span className="text-[12px] leading-snug text-gray-500">{openTargetText[target].description}</span>
            </span>
          </label>
        ))}
      </div>

      {/* 오류 문구는 바로 위 섹션과 원문이 같아 그 키를 그대로 쓴다 — 같은 원문에 키를 새로 파면
          로케일마다 번역이 갈린다(docs/rules/i18n.md 「같은 원문이 여러 곳에 쓰이면 단일 키」). */}
      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.advanced.externalBudgetLoadError', { defaultValue: 'Could not read the current setting.' })
            : t('panel.options.advanced.externalBudgetSaveError', { defaultValue: 'Could not save. Nothing was changed.' })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={!dirty || disabled}
          onClick={() => { void save(); }}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-500"
        >
          {busy === 'save'
            ? t('panel.options.storage.saving', { defaultValue: 'Saving…' })
            : t('panel.options.storage.save', { defaultValue: 'Save' })}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDraft({ ...WEB_GROUP_DEFAULTS });
            setDraftTarget(WEB_OPEN_TARGET_DEFAULT);
          }}
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
  );
}

/** 체크 칸 한 줄 — 종전 접어 보기 칸과 같은 모양(테두리 상자 · 위에 이름 · 아래 설명). */
function WebGroupCheckbox({
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
}): React.JSX.Element {
  return (
    <label
      className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
        disabled ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-gray-200">{label}</span>
        <span className="text-[12px] leading-snug text-gray-500">{description}</span>
      </span>
    </label>
  );
}
