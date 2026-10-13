import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrchestraPreparation } from '@vibisual/shared';
import type { VideoEngineKind } from '@vibisual/video';

import { EngineIcon } from '../Engine/engineIcons.js';
import { ScrollFade } from '../ScrollFade.js';
import { StudioIcon } from './studioIcons.js';
import { StudioSteps } from './StudioSteps.js';
import { StudioComposer, type StudioComposerProps } from './StudioComposer.js';
import type { StudioChatLine } from './useStudioConversation.js';

/**
 * §5.13 (V) 37-1 — 오른쪽 **AI 패널**. 위: 엔진 칩 + 에이전트 이름 + 지금 하는 일(어느 장면을 만지는지). 그 아래 고른 것이 있으면
 * 값 카드(37-5). 가운데: 대화(내 말 / AI 의 말 — IDE 스트림을 읽는다) + "이번에 바뀐 것" 카드. 아래: 입력창 + 칩 + 제안 칩.
 * 전체 대화는 [IDE 에서 보기].
 */
export interface StudioAiPanelProps {
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly engine: VideoEngineKind;
  readonly onEngine: (engine: VideoEngineKind) => void;
  readonly preparation: Readonly<Record<VideoEngineKind, OrchestraPreparation | null>>;
  readonly onPrepare: (engine: VideoEngineKind) => void;
  readonly prepareElsewhere: boolean;
  readonly agentName: string | null;
  readonly running: boolean;
  readonly activityText: string | null;
  readonly valueCard: ReactNode | null;
  readonly lines: readonly StudioChatLine[];
  readonly changeCard: ReactNode | null;
  /** 아래 입력창 위에 붙는 일(예: [고칠 점 n개 맡기기], Codex 그림 허용). */
  readonly actions: ReactNode | null;
  readonly composer: StudioComposerProps;
  readonly onOpenIde: (() => void) | null;
}

const ENGINES: readonly VideoEngineKind[] = ['claude', 'codex'];

export function StudioAiPanel(p: StudioAiPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  // 새 말이 오면 맨 아래로(사람이 위를 읽는 중이어도 새 말 한 줄 단위로만 — 렌더마다 끌어내리지 않는다).
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = p.lines[p.lines.length - 1]?.id ?? '';
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [lastId]);
  if (p.collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-white/10 bg-vb-card py-2">
        <button type="button" onClick={p.onToggleCollapsed} aria-label={t('panel.videoStudio.ai.expand')} title={t('panel.videoStudio.ai.expand')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-white/10">
          <EngineIcon kind={p.engine} className="h-4 w-4" />
        </button>
        {p.running ? <span className="h-1.5 w-1.5 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-[var(--vs-accent)]" /> : null}
      </aside>
    );
  }
  const prep = p.preparation[p.engine];
  return (
    <aside className="flex w-[clamp(300px,27vw,380px)] shrink-0 animate-[vs-in-right_160ms_ease-out] flex-col border-l border-white/10 bg-vb-card" aria-label={t('panel.videoStudio.ai.title')}>
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-full border border-white/10 p-0.5" role="radiogroup" aria-label={t('panel.videoStudio.engines.label')}>
            {ENGINES.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={e === p.engine} onClick={() => p.onEngine(e)}
                title={p.preparation[e] ? t(`panel.videoStudio.engines.need_${p.preparation[e]?.action ?? 'refresh'}`, { engine: t(`panel.videoStudio.engines.${e}`) }) : t(`panel.videoStudio.engines.${e}`)}
                className={`flex h-6 items-center gap-1 rounded-full px-2 text-[12px] transition-colors duration-150 ease-out ${e === p.engine ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-400 hover:text-slate-100'}`}>
                <EngineIcon kind={e} className="h-3.5 w-3.5" />
                <span className={p.preparation[e] ? 'opacity-60' : ''}>{t(`panel.videoStudio.engines.${e}`)}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {p.onOpenIde ? (
            <button type="button" onClick={p.onOpenIde} title={t('panel.videoStudio.ai.openIde')} aria-label={t('panel.videoStudio.ai.openIde')}
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100">
              <StudioIcon name="ide" className="h-3.5 w-3.5" />{t('panel.videoStudio.ai.ide')}
            </button>
          ) : null}
          <button type="button" onClick={p.onToggleCollapsed} aria-label={t('panel.videoStudio.ai.collapse')} title={t('panel.videoStudio.ai.collapse')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/10 hover:text-slate-100">
            <StudioIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${p.running ? 'animate-[vs-breathe_1.2s_ease-in-out_infinite] bg-[var(--vs-accent)]' : 'bg-white/20'}`} aria-hidden="true" />
          <span className="truncate font-semibold text-slate-200">{p.agentName ?? t('panel.videoStudio.ai.noAgentYet')}</span>
          <span className="truncate text-slate-500">{p.activityText ?? (p.running ? t('panel.videoStudio.ai.working') : t('panel.videoStudio.ai.idle'))}</span>
        </div>
        {prep ? (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
            <StudioIcon name="info" className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1">{p.prepareElsewhere
              ? t('panel.videoStudio.engines.prepareInMain', { engine: t(`panel.videoStudio.engines.${p.engine}`) })
              : t(`panel.videoStudio.engines.need_${prep.action}`, { engine: t(`panel.videoStudio.engines.${p.engine}`) })}</span>
            {!p.prepareElsewhere ? (
              <button type="button" onClick={() => p.onPrepare(p.engine)} className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[12px] text-slate-200 hover:bg-white/10">{t('panel.videoStudio.engines.prepare')}</button>
            ) : null}
          </p>
        ) : null}
      </header>
      {p.valueCard}
      <ScrollFade fill className="flex-1">
        <div className="flex flex-col gap-2.5 p-3">
          {p.lines.length === 0 && !p.changeCard ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <StudioSteps step={0} compact />
              <p className="max-w-60 text-[13px] leading-relaxed text-slate-500">{t('panel.videoStudio.ai.empty')}</p>
            </div>
          ) : null}
          {p.lines.map((line) => (
            <div key={line.id} className={line.who === 'me' ? 'self-end' : 'self-start'}>
              <p className={`max-w-[18rem] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${line.who === 'me' ? 'rounded-br-md bg-white/10 text-slate-100' : 'rounded-bl-md border border-white/10 text-slate-200'}`}>
                {line.text}
              </p>
            </div>
          ))}
          {p.changeCard}
          <div ref={endRef} aria-hidden="true" />
        </div>
      </ScrollFade>
      {p.actions ? <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 px-3 pt-2.5">{p.actions}</div> : null}
      <StudioComposer {...p.composer} />
    </aside>
  );
}
