import type { TFunction } from 'i18next';

/**
 * §5.13 (V) 37-23 (J) — 입력창 위 '다음에 시킬 말' 칩을 **코드로** 뽑는다(모델 호출 ❌). 같은 재료면 같은 칩이다.
 * 순서: 바퀴 끝 보고의 제안 → 검수 점수 → 배치 요약 → 열린 메모 → 방금 바뀐(아직 결정하지 않은) 장면·기획만 있는 장면.
 */

/** 칩 최대 수. */
export const NEXT_ASKS_MAX = 5;

/** `GET /doc/:docId/review/score` 에서 칩이 쓰는 몫만. */
export interface NextAskScore {
  readonly introduced: number;
  /** 기준 판 대비 점수 변화(내렸으면 음수). 기준 판이 없으면 null. */
  readonly scoreChange: number | null;
  /** 남은 문제 중 가장 무거운 것(오류 먼저). */
  readonly heaviest: { readonly code: string; readonly values?: Readonly<Record<string, string | number>> } | null;
}

/** `GET /doc/:docId/layout?format=json&inner=0` 의 `flags` 수. */
export interface NextAskLayout {
  readonly overlap: number;
  readonly covered: number;
  readonly clipped: number;
  readonly offscreen: number;
  readonly unsafe: number;
  readonly lowContrast: number;
}

export interface NextAskInput {
  readonly suggestions: readonly string[];
  readonly score: NextAskScore | null;
  readonly layout: NextAskLayout | null;
  readonly openNotes: number;
  /** 바퀴가 바꿨고 아직 받거나 되돌리지 않은 장면(번호 순). */
  readonly undecidedScenes: readonly { readonly n: number; readonly title: string }[];
  /** 기획만 있고 아직 짓지 않은 장면. */
  readonly planScenes: readonly { readonly n: number; readonly title: string }[];
}

const LAYOUT_ORDER: readonly (keyof NextAskLayout)[] = ['overlap', 'covered', 'clipped', 'offscreen', 'unsafe', 'lowContrast'];

export function buildNextAsks(t: TFunction, input: NextAskInput, max = NEXT_ASKS_MAX): string[] {
  const out: string[] = [];
  const push = (text: string): void => { const s = text.trim(); if (s !== '' && !out.includes(s)) out.push(s); };

  for (const s of input.suggestions) push(s);

  const score = input.score;
  if (score) {
    if (score.introduced > 0) push(t('panel.videoStudio.nextAsks.introduced', { count: score.introduced }));
    if (score.scoreChange !== null && score.scoreChange < 0) push(t('panel.videoStudio.nextAsks.scoreDrop', { drop: Math.round(-score.scoreChange) }));
    if (score.heaviest) {
      const what = t(`panel.videoStudio.review.${score.heaviest.code}`, { ...(score.heaviest.values ?? {}), defaultValue: score.heaviest.code });
      push(t('panel.videoStudio.review.fixRequest', { what }));
    }
  }

  const layout = input.layout;
  if (layout) {
    const flag = LAYOUT_ORDER.find((k) => layout[k] > 0);
    if (flag) push(t(`panel.videoStudio.nextAsks.layout_${flag}`, { count: layout[flag] }));
  }

  if (input.openNotes > 0) push(t('panel.videoStudio.notes.handoffRequest', { count: input.openNotes }));

  const scene = input.undecidedScenes[0];
  if (scene) push(t('panel.videoStudio.nextAsks.refineScene', { n: scene.n, title: scene.title }));
  const plan = input.planScenes[0];
  if (plan) push(t('panel.videoStudio.nextAsks.buildScene', { n: plan.n, title: plan.title }));

  return out.slice(0, max);
}

/** 점수 응답 → 칩 재료. 모양이 어긋나면 null(칩이 서지 않을 뿐이다). */
export function nextAskScoreOf(body: unknown): NextAskScore | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as {
    delta?: { score?: unknown; introduced?: unknown } | null;
    findings?: readonly { code?: unknown; level?: unknown; introduced?: unknown; values?: Record<string, string | number> }[];
  };
  const findings = Array.isArray(b.findings) ? b.findings : [];
  const rank = (level: unknown): number => (level === 'error' ? 0 : level === 'warn' ? 1 : 2);
  // '그 밖의 남은 문제' — 이번에 새로 생긴 것은 위 칩이 이미 말한다. info 는 칩으로 세우지 않는다.
  const rest = findings.filter((f) => typeof f.code === 'string' && f.introduced !== true && rank(f.level) < 2)
    .sort((x, y) => rank(x.level) - rank(y.level));
  const top = rest[0];
  return {
    introduced: typeof b.delta?.introduced === 'number' ? b.delta.introduced : 0,
    scoreChange: typeof b.delta?.score === 'number' ? b.delta.score : null,
    heaviest: top ? { code: top.code as string, ...(top.values ? { values: top.values } : {}) } : null,
  };
}

export function nextAskLayoutOf(body: unknown): NextAskLayout | null {
  const flags = (body as { flags?: Partial<NextAskLayout> } | null)?.flags;
  if (!flags || typeof flags !== 'object') return null;
  const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0);
  return { overlap: n(flags.overlap), covered: n(flags.covered), clipped: n(flags.clipped), offscreen: n(flags.offscreen), unsafe: n(flags.unsafe), lowContrast: n(flags.lowContrast) };
}
