import type { TFunction } from 'i18next';
import { DIFF_LINE_LIMIT } from '@vibisual/video';

import { formatMediaDuration } from '../../apps/appThumbnails.js';
import { formatSince } from '../../formatSince.js';
import { diffLineText } from './diffText.js';
import { changeNote } from './glanceView.js';
import type { VideoGlance } from './videoGlance.js';

/**
 * §5.4 #36 (J) ③⑥ — 멈춘 동안의 조작줄 글자: 바뀐 것 한 줄(보고 요약 → 이번에 바뀐 것의 첫 줄 + 그 밖에 n개 — 스튜디오 카드와 같은 문구)
 * · 때("AI · 2분 전" — 지금 판본이 바퀴의 것일 때만 AI). 바뀐 것이 없으면 길이.
 */

export interface GlanceNoteText {
  readonly text: string;
  /** 툴팁 — 보고 요약 + 바뀐 것 줄들(카드 한도까지). */
  readonly title?: string | undefined;
}

export function glanceNote(t: TFunction, glance: VideoGlance | null, opts: { readonly failed: boolean; readonly liveFailed: boolean }): GlanceNoteText {
  if (opts.liveFailed) return { text: t('panel.apps.canvas.unavailable', { defaultValue: '여기서는 열 수 없습니다 — 에디터에서 여세요' }) };
  if (!glance) return { text: opts.failed ? t('panel.apps.canvas.docUnreadable', { defaultValue: 'Could not read the document — open the editor' }) : '' };
  const change = changeNote(glance);
  const lines = glance.lines.slice(0, DIFF_LINE_LIMIT).map((l) => diffLineText(t, l));
  const title = [change?.kind === 'report' ? change.text : null, ...lines].filter((x): x is string => !!x).join('\n') || glance.info.title;
  if (change?.kind === 'report') return { text: change.text, title };
  const first = glance.lines[0];
  if (change?.kind === 'lines' && first) {
    const more = glance.lines.length - 1;
    const head = diffLineText(t, first);
    return { text: more > 0 ? `${head} · ${t('panel.videoStudio.ai.moreChanges', { count: more })}` : head, title };
  }
  return { text: formatMediaDuration(glance.timeline.duration), title };
}

export function glanceWhen(t: TFunction, glance: VideoGlance | null, now: number): string | null {
  if (!glance) return null;
  const when = formatSince(glance.info.updatedAt, t, now);
  return glance.byAi ? t('panel.apps.canvas.whenAi', { when }) : when;
}
