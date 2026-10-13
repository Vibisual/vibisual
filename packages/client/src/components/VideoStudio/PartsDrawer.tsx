import { useTranslation } from 'react-i18next';

import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/**
 * §5.13 (V) 37-11 — **부품 서랍**. '기본'(장면 6종·글자·도형·빈 코드 컴포지션 — 종전 라이브러리, [제목 추가] 는 여기 '제목' 하나)
 * · 우리가 쓴 부품(썸네일 = 그 부품의 실제 정지 화면) · 전환(고른 이음매에 입힌다) · 내 부품([부품으로 저장]한 장면).
 * 무지개 그라데이션 타일은 없다.
 */
export interface DrawerPart {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** 구운 정지 화면(data URL 또는 주소). 굽는 중이면 null. */
  readonly thumb: string | null;
  readonly mine?: boolean;
}

export interface PartsDrawerProps {
  readonly disabled: boolean;
  readonly onAddScene: (sceneId: string) => void;
  readonly onAddText: () => void;
  readonly onAddShape: () => void;
  readonly onAddComposition: () => void;
  readonly parts: readonly DrawerPart[];
  readonly onUsePart: (partId: string) => void;
  readonly transitions: readonly { readonly kind: string }[];
  readonly onTransition: (kind: string) => void;
  /** 전환을 입힐 이음매가 정해졌나(고른 장면의 앞 이음매). */
  readonly seamReady: boolean;
}

const SCENES: ReadonlyArray<{ readonly id: string; readonly icon: StudioIconName }> = [
  { id: 'title', icon: 'text' }, { id: 'lowerThird', icon: 'captions' }, { id: 'bulletList', icon: 'transcript' },
  { id: 'codeBlock', icon: 'code' }, { id: 'quote', icon: 'kinetic' }, { id: 'solid', icon: 'blank' },
];

const TILE = 'flex flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-white/[0.06] disabled:opacity-40';

export function PartsDrawer(p: PartsDrawerProps): React.JSX.Element {
  const { t } = useTranslation();
  const groups = [...new Set(p.parts.map((part) => (part.mine ? 'mine' : part.category)))];
  return (
    <ScrollFade fill className="flex-1">
      <div className="flex flex-col gap-4 p-3">
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.parts.basic')}</h3>
          <div className="grid grid-cols-3 gap-1">
            {SCENES.map((s) => (
              <button key={s.id} type="button" disabled={p.disabled} onClick={() => p.onAddScene(s.id)} className={TILE}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-300"><StudioIcon name={s.icon} /></span>
                <span className="text-[12px] leading-tight text-slate-300">{t(`panel.videoStudio.editor.scene_${s.id}`)}</span>
              </button>
            ))}
            <button type="button" disabled={p.disabled} onClick={p.onAddText} className={TILE}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-300"><StudioIcon name="text" /></span>
              <span className="text-[12px] text-slate-300">{t('panel.videoStudio.editor.addText')}</span>
            </button>
            <button type="button" disabled={p.disabled} onClick={p.onAddShape} className={TILE}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-300"><StudioIcon name="parts" /></span>
              <span className="text-[12px] text-slate-300">{t('panel.videoStudio.editor.addShape')}</span>
            </button>
            <button type="button" disabled={p.disabled} onClick={p.onAddComposition} className={TILE} title={t('panel.videoStudio.editor.addCompositionHint')}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-300"><StudioIcon name="code" /></span>
              <span className="text-[12px] text-slate-300">{t('panel.videoStudio.editor.addComposition')}</span>
            </button>
          </div>
        </section>
        {groups.map((group) => (
          <section key={group}>
            <h3 className="mb-1.5 text-[12px] font-semibold text-slate-500">{t(`panel.videoStudio.parts.group_${group}`)}</h3>
            <div className="grid grid-cols-2 gap-2">
              {p.parts.filter((part) => (part.mine ? 'mine' : part.category) === group).map((part) => (
                <button key={part.id} type="button" disabled={p.disabled} onClick={() => p.onUsePart(part.id)}
                  className="group flex flex-col gap-1 rounded-lg border border-white/10 p-1.5 text-left hover:border-white/20 disabled:opacity-40">
                  <span className="relative block aspect-video overflow-hidden rounded-md bg-black">
                    {part.thumb ? <img src={part.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                      : <span className="absolute inset-0 flex items-center justify-center"><span className="h-2 w-2 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-white/40" /></span>}
                  </span>
                  <span className="truncate px-0.5 text-[12px] text-slate-300 group-hover:text-slate-50">{part.name}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {p.transitions.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.parts.transitions')}</h3>
            {!p.seamReady ? <p className="mb-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.parts.pickSeam')}</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {p.transitions.map((tr) => (
                <button key={tr.kind} type="button" disabled={p.disabled || !p.seamReady} onClick={() => p.onTransition(tr.kind)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-40">
                  {t(`panel.videoStudio.transitions.${tr.kind}`)}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </ScrollFade>
  );
}
