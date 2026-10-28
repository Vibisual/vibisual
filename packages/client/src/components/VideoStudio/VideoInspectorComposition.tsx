import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoAsset, VideoDoc, VideoItem } from '@vibisual/video';

import { StudioIcon } from './studioIcons.js';
import { ValueFieldList } from './StudioValueControls.js';
import { itemValueFields, toPropValue } from './valueFields.js';
import { CompositionDetails } from './ValueCard.js';

/** §5.13 (T-7) · (V) 37-5 — 코드 컴포지션 구역: `vibi-props` 대로 종류별 손잡이, 값 카드와 같은 부품. 새 코드 편집기 ❌(코드는 사용자 에디터나 에이전트가). */
export interface CompositionInspectorActions {
  readonly busy?: boolean;
  onReload: (asset: VideoAsset) => void;
  onStrip: (itemId: string) => void;
  onOpenFile: (path: string) => void;
}

interface Props {
  readonly doc: VideoDoc;
  readonly item: VideoItem;
  readonly asset: VideoAsset | undefined;
  readonly disabled?: boolean | undefined;
  readonly actions: CompositionInspectorActions;
  onUpdate: (patch: Partial<Omit<VideoItem, 'id'>>) => void;
  /** 값 하나를 낙관적으로(화면 먼저, 저장은 뒤에서). 없으면 바로 적는다. */
  readonly onSetProp?: ((key: string, value: unknown) => void) | undefined;
}

export function VideoInspectorComposition({ doc, item, asset, disabled, actions, onUpdate, onSetProp }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const fields = useMemo(() => itemValueFields(doc, item, t), [doc, item, t]);
  const setProp = (key: string, value: unknown): void => {
    if (onSetProp) onSetProp(key, value);
    else onUpdate({ props: { ...(item.props ?? {}), [key]: value } });
  };
  return (
    <section className="space-y-3 border-t border-white/10 pt-3">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
        <StudioIcon name="code" className="h-3.5 w-3.5 text-slate-400" />
        {t('panel.videoStudio.composition.title')}
      </h3>
      {fields.length > 0 ? (
        <ValueFieldList fields={fields} disabled={disabled === true} onChange={(field, value) => setProp(field.key, toPropValue(field, value))} />
      ) : (
        <p className="text-[12px] leading-relaxed text-slate-500">{t('panel.videoStudio.values.noDecl')}</p>
      )}
      <CompositionDetails item={item} asset={asset} disabled={disabled === true} actions={actions} onReplaceProps={(props) => onUpdate({ props })} />
    </section>
  );
}
