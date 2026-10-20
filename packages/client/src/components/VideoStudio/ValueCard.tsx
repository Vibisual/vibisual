import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedItem, VideoAsset, VideoDoc, VideoItem } from '@vibisual/video';

import { StudioTextField } from './StudioField.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { ValueControl, ValueFieldList } from './StudioValueControls.js';
import { formatClock } from './PreviewControls.js';
import { itemValueFields, toPropValue, type ValueField } from './valueFields.js';
import type { CompositionInspectorActions } from './VideoInspectorComposition.js';
import { itemKindKey } from './kindLabels.js';
import { memoLatest } from './studioMemo.js';

/**
 * §5.13 (V) 37-5 — **값 카드**: AI 패널 맨 위에 고른 것이 있을 때만 선다. 값을 손으로 바꾸거나(종류별 손잡이 — 바꾸는 즉시
 * 미리보기가 바뀐다) 아래 입력창으로 AI 에게 말하거나 — 한자리. 코드 컴포지션은 시각 맞춤 방식·검사 결과를 사람 말로
 * '코드 정보' 에, JSON 칸은 '고급' 에 접어 둔다(코드 이름을 그대로 내보이지 않는다). 전체 인스펙터는 [정밀 편집]에 있다.
 */
export interface ValueCardProps {
  readonly doc: VideoDoc;
  readonly resolved: ResolvedItem;
  readonly disabled: boolean;
  /** 값 하나 — 화면 먼저, 저장은 뒤에서(`useLocalProps`). */
  readonly onSetProp: (itemId: string, key: string, value: unknown) => void;
  /** 그 밖의 칸(길이 등) — 평소 편집 경로. */
  readonly onUpdate: (itemId: string, patch: Partial<Omit<VideoItem, 'id'>>) => void;
  readonly composition: CompositionInspectorActions;
  readonly onClose: () => void;
}

const KIND_ICON: Readonly<Record<string, StudioIconName>> = {
  composition: 'code', scene: 'sparkle', text: 'text', shape: 'parts', image: 'image', footage: 'film', audio: 'music', caption: 'captions',
};

/** 길이 손잡이 — 끄는 동안 패치가 쏟아지지 않게 잠잠해지면 한 번 적는다. */
const DURATION_SAVE_MS = 450;

/** §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). */
export const ValueCard = memoLatest(ValueCardView);

function ValueCardView(p: ValueCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const item = p.resolved.item;
  const asset = item.assetId ? p.doc.assets[item.assetId] : undefined;
  const fields = useMemo(() => itemValueFields(p.doc, item, t), [p.doc, item, t]);
  const [durationDraft, setDurationDraft] = useState<number | null>(null);
  const durationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setDurationDraft(null); }, [item.id]);
  useEffect(() => () => { if (durationTimer.current) clearTimeout(durationTimer.current); }, []);
  const durationField: ValueField | null = typeof item.duration === 'number'
    ? { key: '__duration', type: 'time', label: t('panel.videoStudio.values.duration'), value: durationDraft ?? item.duration, min: 1 / Math.max(1, p.doc.fps), step: 0.05 }
    : null;
  const title = item.label ?? (item.kind === 'scene' && item.sceneId ? t(`panel.videoStudio.editor.scene_${item.sceneId}`, { defaultValue: item.sceneId }) : t(itemKindKey(item.kind)));

  return (
    // 높이 상한 = AI 칸의 46% 이되, 짧은 칸(짧은 창·폰에서 아래로 쌓인 AI 칸)에서는 머리·입력창·대화 몫 16rem 을 남긴 만큼까지만
    //   (그래도 5.5rem 은 둔다 — 제목 줄과 손잡이 한 줄). 넘치는 손잡이는 아래 목록 안에서 스크롤한다. 키 큰 칸에서는 종전과 같다.
    <section className="flex max-h-[min(46%,max(5.5rem,calc(100%_-_16rem)))] shrink-0 flex-col border-b border-white/10 bg-vb-raised/40" aria-label={t('panel.videoStudio.values.title')}>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-slate-300">
          <StudioIcon name={KIND_ICON[item.kind] ?? 'parts'} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-slate-100" title={title}>{title}</span>
          <span className="block text-[12px] tabular-nums text-slate-500">{formatClock(p.resolved.start)} – {formatClock(p.resolved.end)}</span>
        </span>
        <button type="button" onClick={p.onClose} aria-label={t('panel.videoStudio.values.deselect')} title={t('panel.videoStudio.values.deselect')}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2.5"><StudioIcon name="close" className="h-3.5 w-3.5" /></button>
      </header>
      <div className="scrollbar-thin flex min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {fields.length > 0 ? (
          <ValueFieldList fields={fields} disabled={p.disabled} onChange={(field, value) => p.onSetProp(item.id, field.key, toPropValue(field, value))} />
        ) : item.kind === 'composition' ? (
          <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.values.noDecl')}</p>
        ) : null}
        {durationField ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-slate-400">{durationField.label}</span>
            <ValueControl field={durationField} disabled={p.disabled} onChange={(v) => {
              const next = typeof v === 'number' ? v : Number(v);
              if (!Number.isFinite(next) || next <= 0) return;
              setDurationDraft(next);
              if (durationTimer.current) clearTimeout(durationTimer.current);
              durationTimer.current = setTimeout(() => { durationTimer.current = null; p.onUpdate(item.id, { duration: next }); }, DURATION_SAVE_MS);
            }} />
          </div>
        ) : null}
        {item.kind === 'composition' ? (
          <CompositionDetails item={item} asset={asset} disabled={p.disabled} actions={p.composition}
            onReplaceProps={(props) => p.onUpdate(item.id, { props })} />
        ) : null}
      </div>
    </section>
  );
}

/** 접히는 칸 하나(제목을 누르면 열린다). */
export function Disclosure({ label, children, defaultOpen = false }: { readonly label: string; readonly children: ReactNode; readonly defaultOpen?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-white/10">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] font-semibold text-slate-400 hover:text-slate-100 pointer-coarse:py-2.5">
        <StudioIcon name="chevronDown" className={`h-3.5 w-3.5 transition-transform duration-150 ease-out ${open ? '' : '-rotate-90'}`} />
        {label}
      </button>
      {open ? <div className="flex flex-col gap-2 border-t border-white/10 p-2">{children}</div> : null}
    </div>
  );
}

const LINT_TONE: Readonly<Record<string, string>> = {
  error: 'border-rose-400/40 text-rose-200',
  warn: 'border-amber-300/40 text-amber-100',
  info: 'border-white/10 text-slate-400',
};

/**
 * §5.13 (V) 37-5 — 코드 컴포지션의 **코드 정보**(사람 말 — 시각 맞춤 방식·검사 결과·손잡이 셋)와 **고급**(JSON 칸). 값 카드와
 * [정밀 편집]의 인스펙터가 같은 부품을 쓴다.
 */
export function CompositionDetails({ item, asset, disabled, actions, onReplaceProps }: {
  readonly item: VideoItem;
  readonly asset: VideoAsset | undefined;
  readonly disabled: boolean;
  readonly actions: CompositionInspectorActions;
  readonly onReplaceProps: (props: Record<string, unknown>) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const path = asset?.source.kind === 'file' ? asset.source.path : '';
  const lint = asset?.lint ?? [];
  const problems = lint.filter((l) => l.level !== 'info').length;
  const validateJson = (text: string): string | undefined => {
    try {
      const parsed: unknown = JSON.parse(text.trim() === '' ? '{}' : text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? undefined : t('panel.videoStudio.composition.propsNotObject');
    } catch {
      return t('panel.videoStudio.composition.propsInvalid');
    }
  };
  const BUTTON = 'flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2';
  return (
    <>
      <Disclosure label={problems > 0 ? t('panel.videoStudio.values.codeInfoProblems', { count: problems }) : t('panel.videoStudio.values.codeInfo')}>
        {path ? <p className="break-all text-[12px] text-slate-500">{path}</p> : <p className="text-[12px] text-amber-200">{t('panel.videoStudio.composition.noSource')}</p>}
        <p className="text-[12px] leading-relaxed text-slate-300">
          {asset?.mode === 'forward' ? t('panel.videoStudio.values.seekForward') : t('panel.videoStudio.values.seekRandom')}
        </p>
        {asset?.duration !== undefined || (asset?.width !== undefined && asset.height !== undefined) ? (
          <p className="text-[12px] tabular-nums text-slate-500">
            {asset?.duration !== undefined ? t('panel.videoStudio.values.declaredLength', { seconds: asset.duration.toFixed(2) }) : ''}
            {asset?.width !== undefined && asset.height !== undefined ? ` · ${asset.width} × ${asset.height}` : ''}
            {asset?.responsive ? ` · ${t('panel.videoStudio.values.responsive')}` : ''}
          </p>
        ) : null}
        {lint.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {lint.map((entry) => (
              <li key={entry.code} className={`rounded border px-2 py-1 text-[12px] leading-relaxed ${LINT_TONE[entry.level] ?? LINT_TONE['info']}`}>
                {t(`panel.videoStudio.lint.${entry.code}`, { defaultValue: entry.message })}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={BUTTON} disabled={disabled || actions.busy || !asset || !path} onClick={() => asset && actions.onReload(asset)}>
            <StudioIcon name="restore" className="h-3.5 w-3.5" />{t('panel.videoStudio.composition.reload')}
          </button>
          <button type="button" className={BUTTON} disabled={actions.busy} onClick={() => actions.onStrip(item.id)}>
            <StudioIcon name="film" className="h-3.5 w-3.5" />{t('panel.videoStudio.composition.strip')}
          </button>
          <button type="button" className={BUTTON} disabled={!path} onClick={() => actions.onOpenFile(path)}>
            <StudioIcon name="code" className="h-3.5 w-3.5" />{t('panel.videoStudio.composition.openFile')}
          </button>
        </div>
      </Disclosure>
      <Disclosure label={t('panel.videoStudio.values.advanced')}>
        <StudioTextField
          label={t('panel.videoStudio.composition.props')}
          hint={t('panel.videoStudio.composition.propsHint')}
          value={JSON.stringify(item.props ?? {}, null, 2)}
          multiline
          disabled={disabled}
          validate={validateJson}
          onCommit={(text) => {
            if (validateJson(text) !== undefined) return;
            onReplaceProps(JSON.parse(text.trim() === '' ? '{}' : text) as Record<string, unknown>);
          }}
        />
      </Disclosure>
    </>
  );
}
