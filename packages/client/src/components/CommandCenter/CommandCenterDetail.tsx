import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { contextLevel, elapsedParts, type CommandCenterItem } from './commandCenterModel.js';

// SCENARIO.md §5.12 (H) v4.44 — 상세 패널.
//
// 카드 한 장을 고르면 그 세션이 **왜 이 레인에 있는지의 원문**을 펼친다. 목록 카드는 한 줄
// 미리보기라 "질문이 뭐였는지" 를 알려면 결국 메인 창까지 가야 했다 — 그 왕복을 없애는 것이
// 이 패널의 존재 이유다.
//
// 여기 그리는 값은 전부 `item.detail`(= 이미 창에 와 있는 스냅샷 파생)이다. **스트림은 그리지
// 않는다** — 그건 §5.12 (G) 대로 메인 창 IDE 의 몫이다.

export interface CommandCenterDetailHandle {
  /** `c` 단축키 — 명령 입력창으로 포커스. */
  focusComposer(): void;
}

export interface CommandCenterDetailProps {
  /**
   * v4.56 — **고른 카드가 있을 때만** 이 패널이 산다(빈 상태 화면 없음). 보드가 선택이 풀린 뒤에도
   * 미끄러져 나가는 동안 마지막 항목을 그대로 넘겨 주므로 여기서 null 을 다룰 일이 없다.
   */
  item: CommandCenterItem;
  projectId: string;
  now: number;
  onClose: () => void;
}

export const CommandCenterDetail = forwardRef<CommandCenterDetailHandle, CommandCenterDetailProps>(
  function CommandCenterDetail({ item, projectId, now, onClose }, ref): React.JSX.Element {
    const { t } = useTranslation();
    const [draft, setDraft] = useState('');
    const [sent, setSent] = useState(false);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focusComposer: (): void => composerRef.current?.focus(),
    }), []);

    // 다른 카드로 옮기면 쓰던 초안은 그 카드의 것이 아니므로 비운다.
    const itemKey = item.key;
    useEffect(() => {
      setDraft('');
      setSent(false);
    }, [itemKey]);

    const handleJump = useCallback((): void => {
      void window.api?.command?.revealInMain({
        projectId,
        agentId: item.agentId,
        subAgentId: item.subAgentId,
      });
    }, [item, projectId]);

    const handleSend = useCallback((): void => {
      const text = draft.trim();
      if (!text) return;
      useGraphStore.getState().addCommand(item.agentId, text, item.subAgentId);
      setDraft('');
      setSent(true);
      window.setTimeout(() => setSent(false), 1600);
    }, [draft, item]);

    const { detail } = item;
    const ctx = contextLevel(item.contextUsed, item.contextMax);
    const elapsed = (at: number): string => {
      const { unit, value } = elapsedParts(now - at);
      if (unit === 'now') return t('commandCenter.time.now');
      if (unit === 'min') return t('commandCenter.time.min', { count: value });
      if (unit === 'hour') return t('commandCenter.time.hour', { count: value });
      return t('commandCenter.time.day', { count: value });
    };

    return (
      <aside className="flex h-full w-full min-w-0 flex-col border-l border-white/[0.07] bg-gray-950/60">
        {/* 머리 */}
        <header className="flex flex-shrink-0 items-start gap-2 border-b border-white/[0.07] px-4 py-3">
          <span
            className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-black/40"
            style={{ backgroundColor: item.agentColor }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-gray-100">{item.agentLabel}</p>
            <p className="mt-0.5 truncate text-[12px] text-gray-500">
              {item.subAgentId ? item.sessionLabel : t('commandCenter.mainSession')}
              {item.lastActivityAt > 0 && <span className="tabular-nums"> · {elapsed(item.lastActivityAt)}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={handleJump}
            className="flex flex-shrink-0 items-center gap-1 rounded-md bg-white/[0.07] px-2 py-1 text-[12px] text-gray-200 transition-colors hover:bg-white/[0.14]"
            title={t('commandCenter.jumpHint')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
            {t('commandCenter.jump')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
            title={t('commandCenter.detail.close')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/* 본문 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {ctx && (
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                  {t('commandCenter.detail.context')}
                </span>
                <span className={`text-[12px] tabular-nums ${ctx.level === 'critical' ? 'text-red-300' : ctx.level === 'warn' ? 'text-amber-300' : 'text-gray-400'}`}>
                  {Math.round(ctx.ratio * 100)}%
                </span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                <span
                  className={`block h-full rounded-full ${ctx.level === 'critical' ? 'bg-red-400' : ctx.level === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.round(ctx.ratio * 100)}%` }}
                />
              </span>
            </div>
          )}

          {detail.permission && (
            <Section title={t('commandCenter.detail.permission')} tone="rose">
              <p className="font-mono text-[12px] text-rose-100">{detail.permission.toolName}</p>
              <ToolInputPreview input={detail.permission.toolInput} />
            </Section>
          )}

          {detail.question && (
            <Section title={t('commandCenter.detail.question')} tone="rose">
              {detail.question.items.map((q, idx) => (
                <div key={idx} className={idx > 0 ? 'mt-3' : ''}>
                  {q.header && <p className="text-[12px] font-semibold text-rose-200">{q.header}</p>}
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200">{q.question}</p>
                  {q.prompts.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <span className="text-[12px] uppercase tracking-wider text-gray-500">
                        {t('commandCenter.detail.suggested')}
                      </span>
                      {q.prompts.map((prompt, pIdx) => (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => { setDraft(prompt); composerRef.current?.focus(); }}
                          className="rounded border border-rose-400/25 bg-rose-500/10 px-2 py-1.5 text-left text-[12px] leading-snug text-rose-100 transition-colors hover:bg-rose-500/20"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {detail.review && (
            <Section title={t('commandCenter.detail.review')} tone="violet">
              {detail.review.instruction && (
                <p className="mb-1.5 text-[12px] italic text-gray-400">{detail.review.instruction}</p>
              )}
              <Bullets label={t('commandCenter.detail.changes')} items={detail.review.changes} />
              <Bullets label={t('commandCenter.detail.checkpoints')} items={detail.review.checkpoints} />
            </Section>
          )}

          {detail.report && (
            <Section title={t('commandCenter.detail.report')} tone="amber">
              <Bullets label={t('commandCenter.detail.userActions')} items={detail.report.userActions} strong />
              <Bullets label={t('commandCenter.detail.did')} items={detail.report.did} />
              <Bullets label={t('commandCenter.detail.nextSteps')} items={detail.report.nextSteps ?? []} />
            </Section>
          )}

          {detail.queuedTexts.length > 0 && (
            <Section title={t('commandCenter.detail.queued')} tone="sky">
              <ol className="space-y-1">
                {detail.queuedTexts.map((text, idx) => (
                  <li key={idx} className="flex gap-1.5 text-[12px] leading-snug text-gray-300">
                    <span className="flex-shrink-0 tabular-nums text-gray-600">{idx + 1}.</span>
                    <span className="min-w-0 break-words">{text}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {!detail.permission && !detail.question && !detail.review && !detail.report && (
            <Section title={t('commandCenter.detail.lastActivity')} tone="gray">
              {detail.lastCommand && (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-300">{detail.lastCommand}</p>
              )}
              {detail.lastResult && (
                <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-500">{detail.lastResult}</p>
              )}
              {!detail.lastCommand && !detail.lastResult && (
                <p className="text-[12px] text-gray-600">{t('commandCenter.detail.nothingYet')}</p>
              )}
            </Section>
          )}
        </div>

        {/* 명령 입력창 — 기존 큐 경로 그대로(§5.12 (D)).
            §5.5 #17-29 — 훅 버블의 세션이면 입력창 대신 읽기 전용 안내만 남는다. */}
        {item.readOnly ? (
          <div className="flex-shrink-0 border-t border-white/[0.07] px-3 py-2.5">
            <p className="text-[12px] leading-relaxed text-gray-600">{t('ide.mainArea.readOnly')}</p>
          </div>
        ) : (
        <div className="flex-shrink-0 border-t border-white/[0.07] px-3 py-2.5">
          <textarea
            ref={composerRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // 보드의 j/k 이동 단축키가 타이핑을 가로채지 않게.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === 'Escape') { e.preventDefault(); composerRef.current?.blur(); }
            }}
            placeholder={t('commandCenter.commandPlaceholder')}
            className="w-full resize-none rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-[12px] leading-snug text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[12px] text-gray-600">
              {sent ? t('commandCenter.detail.queuedIt') : t('commandCenter.detail.composerHint')}
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim()}
              className="rounded-md bg-sky-600/80 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-gray-600"
            >
              {t('commandCenter.send')}
            </button>
          </div>
        </div>
        )}
      </aside>
    );
  },
);

const SECTION_TONE: Record<string, string> = {
  rose: 'border-rose-400/25 bg-rose-500/[0.06]',
  violet: 'border-violet-400/25 bg-violet-500/[0.06]',
  amber: 'border-amber-400/25 bg-amber-500/[0.06]',
  sky: 'border-sky-400/25 bg-sky-500/[0.06]',
  gray: 'border-white/[0.08] bg-white/[0.02]',
};

function Section({ title, tone, children }: { title: string; tone: keyof typeof SECTION_TONE; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className={`rounded-lg border px-3 py-2.5 ${SECTION_TONE[tone] ?? SECTION_TONE['gray']}`}>
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ label, items, strong }: { label: string; items: string[]; strong?: boolean }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 first:mt-0">
      <p className="text-[12px] uppercase tracking-wider text-gray-500">{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((text, idx) => (
          <li key={idx} className={`flex gap-1.5 text-[12px] leading-snug ${strong ? 'text-gray-100' : 'text-gray-300'}`}>
            <span className="mt-[6px] h-1 w-1 flex-shrink-0 rounded-full bg-current opacity-50" />
            <span className="min-w-0 break-words">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 권한 요청의 도구 입력 — 한 줄 미리보기. 전문은 메인 창 승인 팝업의 몫이라 여기선 짧게. */
function ToolInputPreview({ input }: { input: Record<string, unknown> }): React.JSX.Element | null {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1 space-y-0.5">
      {entries.slice(0, 4).map(([k, v]) => (
        <div key={k} className="flex gap-1.5 text-[12px] leading-snug">
          <dt className="flex-shrink-0 text-gray-500">{k}</dt>
          <dd className="min-w-0 truncate font-mono text-gray-300">
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
