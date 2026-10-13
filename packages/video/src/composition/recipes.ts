/**
 * §5.13 (V) 37-2 — 시작 화면의 **레시피** 정본 (순수 — 영문, 에이전트가 읽는 요청 확장).
 *
 * 레시피는 우리가 쓴 지시문 묶음이다 — "무엇을, 어떤 장면 순서로, 어떤 부품으로". **어떻게 고치나(규약)** 는 규약 글
 * (`guide.ts`)이 맡으므로 여기에는 다시 적지 않는다(두 벌 ❌). 화면 이름·설명은 번역 키(`panel.videoStudio.recipes.<id>.*`)
 * 가 맡고, 여기 영문은 에이전트만 읽는다. 애니메이션 라이브러리 이름을 적지 않는다((B)).
 */

import type { VideoFormatId } from '../types.js';

/** 레시피가 받는 소재 갈래 — 시작 화면이 끌어 놓는 자리의 안내를 고른다. */
export type RecipeMaterial = 'text' | 'commits' | 'csv' | 'video' | 'srt' | 'images' | 'music' | 'logo' | 'screens';

export interface VideoRecipe {
  readonly id: string;
  readonly defaultFormat: VideoFormatId;
  /** 초. */
  readonly defaultLength: number;
  readonly wants: readonly RecipeMaterial[];
  /** AI 를 부르지 않는 레시피(빈 문서). */
  readonly direct?: boolean;
  /** 에이전트에게 주는 요청 확장(영문). */
  readonly prompt: string;
}

export const VIDEO_RECIPES: readonly VideoRecipe[] = [
  {
    id: 'app-intro',
    defaultFormat: 'landscape',
    defaultLength: 30,
    wants: ['screens', 'logo'],
    prompt: `Recipe "app-intro" — a short product intro of THIS project.
- Read the project (README, package.json, the main screens/components) to learn what it does and for whom. Do not invent features.
- Use the real screens attached as assets (captures of the running app / live previews) as the hero material; frame them in
  device-like or floating cards made in your compositions, with gentle camera moves done in code.
- Suggested chapters: hook (the problem in one line) → what it is (name + one-line promise) → 2–3 key features (one per chapter,
  each with a real screen and a short caption) → call to action (name, logo, where to get it).
- Use the project style variables (--vibi-accent, --vibi-bg, --vibi-fg, --vibi-font, __vibi.style.logo) so it looks like this app.`,
  },
  {
    id: 'changelog',
    defaultFormat: 'landscape',
    defaultLength: 30,
    wants: ['commits'],
    prompt: `Recipe "changelog" — a "what's new" video from commits or a PR.
- Read the commits / PR the user names (git log, git show, the PR description). If none is named, use the commits since the last tag.
- Group the changes into 2–4 user-visible themes. Skip internal refactors unless the user asks.
- Suggested chapters: title card (version / date) → one chapter per theme (short headline + 1–2 supporting lines, a code
  typing part or a screen when it helps) → closing card.
- Keep every on-screen sentence short enough to read in its chapter (the review checks reading time).`,
  },
  {
    id: 'data-story',
    defaultFormat: 'landscape',
    defaultLength: 30,
    wants: ['csv'],
    prompt: `Recipe "data-story" — explain a dataset with animated charts.
- Read the attached CSV / table. Compute the numbers in code (sums, growth, ranks); never guess a number.
- Pick the 2–3 findings that matter and give each its own chapter: a headline sentence + the right chart part (bar, line or
  donut) + a counter for the key number. Put the data into the item props (values, labels) so the user can edit them.
- Suggested chapters: question → finding 1 → finding 2 → (finding 3) → takeaway.`,
  },
  {
    id: 'caption-shorts',
    defaultFormat: 'portrait',
    defaultLength: 30,
    wants: ['video', 'srt'],
    prompt: `Recipe "caption-shorts" — a vertical short with animated captions over a talking video.
- Put the attached video as footage (cover the 9:16 frame, keep the face inside the safe area). Import the SRT as a caption item.
- Use word-highlight captions (caption props.highlight:"word", or the word captions part) placed above the bottom UI zone.
- Cut dead air by editing the transcript (GET /transcript) — cuts follow sentence boundaries computed by Vibistudio.
- Suggested chapters follow the speech: hook (first 3 seconds) → body → payoff. Add one emphasis graphic per chapter at most.`,
  },
  {
    id: 'kinetic-text',
    defaultFormat: 'landscape',
    defaultLength: 15,
    wants: ['text'],
    prompt: `Recipe "kinetic-text" — a message told with moving typography.
- Split the user's text into short beats (2–6 words each). One beat per chapter or several per chapter, timed for reading.
- Use the kinetic typography part (or your own composition) with the project style variables; vary scale, weight and
  direction between beats, keep the motion eased and readable.
- If music is attached, align beat changes to strong beats.`,
  },
  {
    id: 'photo-slideshow',
    defaultFormat: 'landscape',
    defaultLength: 30,
    wants: ['images', 'music'],
    prompt: `Recipe "photo-slideshow" — photos set to music.
- Import the attached photos and the music. Put the music on an audio track (props.role:"music").
- One photo per chapter by default; chapter boundaries and transitions land on strong beats (Vibistudio analyses the beats).
- Give each photo a slow pan/zoom done in a composition, optional short captions, and a title and closing card.`,
  },
  {
    id: 'logo-reveal',
    defaultFormat: 'landscape',
    defaultLength: 15,
    wants: ['logo'],
    prompt: `Recipe "logo-reveal" — a short logo animation.
- Use the attached logo (or the project logo from the style card). Build it in the logo reveal part or your own composition:
  a build-up, the reveal, a hold long enough to read the name, and a calm ending frame.
- Keep it to 2–3 chapters. Use the style colors; the background may stay transparent if the user wants an overlay.`,
  },
  {
    id: 'blank',
    defaultFormat: 'landscape',
    defaultLength: 30,
    wants: [],
    direct: true,
    prompt: '',
  },
];

export function findRecipe(id: string | undefined): VideoRecipe | undefined {
  return id === undefined ? undefined : VIDEO_RECIPES.find((r) => r.id === id);
}
