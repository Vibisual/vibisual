import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { VideoDoc } from '@vibisual/video';

import { buildNextAsks, nextAskLayoutOf, nextAskScoreOf, type NextAskLayout, type NextAskScore } from './nextAsks.js';
import type { PassChange } from './usePassChange.js';

/** 판본·재생 머리가 바뀐 뒤 잠잠하기를 기다리는 시간(ms) — 연달아 고치는 동안 되풀이해 묻지 않게. */
const NEXT_ASKS_SETTLE_MS = 1200;
const BASE = '/api/app/vibistudio';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

export interface NextAsksDeps {
  readonly t: TFunction;
  readonly project: string;
  readonly doc: VideoDoc | null;
  readonly playhead: number;
  readonly playing: boolean;
  /** AI 패널을 접었으면 묻지 않는다. */
  readonly paused: boolean;
  readonly passChange: PassChange;
  readonly openNotes: number;
}

/**
 * §5.13 (V) 37-23 (J) — '다음에 시킬 말' 칩. 일꾼을 부르지 않는 값만 묻는다(`frames` 없이 · `inner=0`). 재생 중·패널을 접은 동안에는
 * 묻지 않고 마지막 값을 그대로 둔다.
 */
export function useNextAsks(d: NextAsksDeps): readonly string[] {
  const [score, setScore] = useState<NextAskScore | null>(null);
  const [layout, setLayout] = useState<NextAskLayout | null>(null);
  const docId = d.doc?.id ?? '';
  const version = d.doc?.version ?? -1;
  // 재생 머리는 밀리초 단위로 흔들린다 — 10분의 1초로 묶어 묻는다.
  const at = Math.round(d.playhead * 10) / 10;

  useEffect(() => { setScore(null); setLayout(null); }, [d.project, docId]);

  useEffect(() => {
    if (docId === '' || d.playing || d.paused) return;
    let alive = true;
    const q = `project=${encodeURIComponent(d.project)}`;
    const path = `${BASE}/doc/${encodeURIComponent(docId)}`;
    const timer = setTimeout(() => {
      getJson(`${path}/review/score?${q}`).then((b) => { if (alive) setScore(nextAskScoreOf(b)); }).catch(() => { if (alive) setScore(null); });
      getJson(`${path}/layout?${q}&t=${encodeURIComponent(String(at))}&inner=0&format=json`)
        .then((b) => { if (alive) setLayout(nextAskLayoutOf(b)); }).catch(() => { if (alive) setLayout(null); });
    }, NEXT_ASKS_SETTLE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [d.project, docId, version, at, d.playing, d.paused]);

  const { t, doc, passChange, openNotes } = d;
  return useMemo(() => {
    if (!doc) return [];
    const undecidedScenes = passChange.scenes.scenes
      .filter((s) => s.state !== 'removed' && !passChange.decided[s.chapterId])
      .map((s) => ({ n: s.n, title: s.title }));
    const planScenes = (doc.chapters ?? []).flatMap((c, i) => (c.status === 'plan' ? [{ n: i + 1, title: c.title }] : []));
    return buildNextAsks(t, {
      suggestions: passChange.report?.suggestions ?? [],
      score, layout, openNotes, undecidedScenes, planScenes,
    });
  }, [t, doc, passChange.scenes, passChange.decided, passChange.report, score, layout, openNotes]);
}
