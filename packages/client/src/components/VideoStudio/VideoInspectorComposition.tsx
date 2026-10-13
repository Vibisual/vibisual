import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoAsset, VideoDoc, VideoItem } from '@vibisual/video';

import { StudioIcon } from './studioIcons.js';
import { ValueFieldList } from './StudioValueControls.js';
import { itemValueFields, toPropValue } from './valueFields.js';
import { CompositionDetails } from './ValueCard.js';

/**
 * §5.13 (T-7) — 아이템 패널의 **코드 컴포지션** 구역. §5.13 (V) 37-5 로 다시 지었다.
 *
 * 값은 컴포지션이 선언한 대로 종류별 손잡이(`vibi-props` → 글자 칸·끌기 숫자·원형 색 견본·글꼴·그림·시각·고르기)로 고친다.
 * 시각 맞춤 방식·검사 결과·[다시 읽기]·[프레임 띠]·[파일 열기]는 사람 말로 '코드 정보' 에, JSON 칸은 '고급' 에 접는다 —
 * 값 카드(AI 패널)와 같은 부품이다. 새 편집기를 만들지 않는다 — 코드는 사용자의 에디터나 에이전트가 고친다.
 */
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
