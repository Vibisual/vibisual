import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IME_ENTER_OWNER, isComposingKeyEvent } from '../../utils/inputComposition.js';
import { useEnterSubmit } from '../../hooks/useEnterSubmit.js';

/**
 * §5.13 (G) — 스튜디오의 **AI 와 말하는 줄**(종전 "에이전트 선택 + 이 컷 맡기기" 를 대체).
 *
 * 사용자는 보면서 고치고, 고칠 점을 AI 에게 말한다. 받는 에이전트는 이 문서에 묶인 노드에 이어진 에이전트가 먼저다(없으면
 * 프로젝트의 커스텀 에이전트 중에서 고른다). 보낼 때 지금 문서·재생 위치·고른 아이템·붙인 소재가 함께 실린다(문맥 블록 —
 * `studioAgentMessage.ts`). 붙이기는 그림·영상·소리를 **문서의 소재로** 들인다(자리 배치는 AI 가 한다). 에이전트가 고친 것은
 * 스튜디오가 저절로 다시 읽는다. 전송은 기존 명령 큐 하나다(새 전송 경로 ❌).
 */
export interface VideoAgentBarAgent {
  readonly id: string;
  readonly label: string;
  /** 이 문서에 묶인 노드에 이어진 에이전트인가. */
  readonly linked: boolean;
  /** 지금 도는가. */
  readonly running: boolean;
}

export interface VideoAgentBarProps {
  readonly agents: readonly VideoAgentBarAgent[];
  readonly agentId: string;
  readonly onAgentId: (id: string) => void;
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly attachments: readonly { readonly id: string; readonly label: string }[];
  readonly onAttach: (files: readonly File[]) => void;
  readonly onRemoveAttachment: (id: string) => void;
  /** 보낸다. 인자는 입력칸의 지금 값(조합 확정 직후 프레임에도 마지막 글자가 빠지지 않게). */
  readonly onSend: (liveText?: string) => void;
  readonly disabled: boolean;
  readonly busy: boolean;
}

const BUTTON = 'flex h-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 px-2 text-xs hover:bg-white/10 disabled:cursor-default disabled:opacity-35';

export function VideoAgentBar(p: VideoAgentBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const onEnter = useEnterSubmit((live) => p.onSend(live));
  const selected = p.agents.find((agent) => agent.id === p.agentId);
  const canSend = !p.disabled && !p.busy && p.agentId !== '' && (p.text.trim() !== '' || p.attachments.length > 0);
  const placeholder = t('panel.videoStudio.agent.placeholder', { defaultValue: 'Tell the AI what to change — e.g. make the title bigger around 2s' });
  return (
    <div className="flex min-w-0 flex-1 items-end gap-2">
      <label className="flex shrink-0 flex-col gap-0.5">
        <span className="sr-only">{t('panel.videoStudio.agent.pick', { defaultValue: 'AI agent' })}</span>
        <select className="h-8 max-w-44 rounded bg-gray-800 px-2 text-xs" value={p.agentId} onChange={(e) => p.onAgentId(e.target.value)}
          aria-label={t('panel.videoStudio.agent.pick', { defaultValue: 'AI agent' })}>
          <option value="">{t('panel.videoStudio.agent.pickPlaceholder', { defaultValue: 'Choose an agent…' })}</option>
          {p.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.linked ? t('panel.videoStudio.agent.linkedLabel', { defaultValue: '{{name}} (linked)', name: agent.label }) : agent.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {p.attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {p.attachments.map((a) => (
              <span key={a.id} className="flex max-w-48 items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] py-0.5 pl-2 pr-1 text-[12px] text-gray-200">
                <span className="truncate">{a.label}</span>
                <button type="button" className="flex h-4 w-4 items-center justify-center rounded-full text-white/60 hover:bg-white/15 hover:text-white"
                  onClick={() => p.onRemoveAttachment(a.id)}
                  aria-label={t('panel.videoStudio.agent.removeAttachment', { defaultValue: 'Remove {{name}}', name: a.label })}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          {...IME_ENTER_OWNER}
          rows={1}
          value={p.text}
          disabled={p.disabled}
          onChange={(e) => p.onText(e.target.value)}
          onKeyDown={(e) => {
            // 스튜디오의 단축키(Delete·Space·화살표)가 글을 치는 손을 가로채지 않게.
            e.stopPropagation();
            if (onEnter(e)) return;
            if (isComposingKeyEvent(e.nativeEvent)) return;
            if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          className="max-h-24 min-h-8 w-full resize-y rounded-md border border-white/10 bg-gray-950 px-2.5 py-1.5 text-xs leading-relaxed text-gray-100 outline-none placeholder:text-white/35 focus:border-violet-400 disabled:opacity-40"
        />
      </div>
      <button type="button" className={BUTTON} disabled={p.disabled || p.busy} onClick={() => fileInput.current?.click()}
        title={t('panel.videoStudio.agent.attach', { defaultValue: 'Attach images, video or audio (added to this video\'s media)' })}
        aria-label={t('panel.videoStudio.agent.attach', { defaultValue: 'Attach images, video or audio (added to this video\'s media)' })}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <input ref={fileInput} type="file" multiple className="hidden"
        accept=".mp4,.webm,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.flac,.aac,.png,.jpg,.jpeg,.webp,.gif,.avif"
        aria-label={t('panel.videoStudio.agent.attach', { defaultValue: 'Attach images, video or audio (added to this video\'s media)' })}
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length > 0) p.onAttach(files); }} />
      <button type="button" className={`${BUTTON} bg-violet-600 px-3 font-medium text-white hover:bg-violet-500`} disabled={!canSend} onClick={() => p.onSend()}>
        {t('panel.videoStudio.agent.send', { defaultValue: 'Ask AI' })}
      </button>
      {selected?.running ? (
        <span role="status" className="flex h-8 shrink-0 items-center gap-1.5 text-xs text-violet-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" aria-hidden="true" />
          {t('panel.videoStudio.agent.working', { defaultValue: 'AI is editing…' })}
        </span>
      ) : null}
    </div>
  );
}
