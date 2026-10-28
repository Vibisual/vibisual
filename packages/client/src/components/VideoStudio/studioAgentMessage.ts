/**
 * §5.13 (G)(V) 37-16 — 스튜디오에서 AI 에게 보내는 말에 붙이는 문맥 블록(순수 — 영문, 에이전트가 읽는 데이터).
 * 말만 가면 에이전트는 어느 문서의 어디인지 모른다 — 지금 문서·판본·바퀴 id·바퀴 종류·재생 위치·고른 것·가리킨 것·메모·첨부·장면 범위·레시피를 데이터로 싣는다.
 * 규약(기획 먼저·값 선언·passId·바퀴 보고)은 정본 글(`GET …/guide`)이 말하고 여기서는 가리키기만 한다(두 벌 ❌). 엔진이 Claude 든 Codex 든 같은 글이다.
 */

import { VIDEO_DIR, type ResolvedItem, type VideoAsset, type VideoDoc, type VideoFormatId } from '@vibisual/video';

/** 블록이 시작되는 표식 — 같은 블록이 두 번 붙지 않게(전송 실패로 초안에 되돌아온 글을 다시 보낼 때). */
export const STUDIO_CONTEXT_MARK = '[Vibistudio editor context]';

/** 바퀴의 성격 — 규약 글이 각각 무엇을 할지 말한다. */
export type StudioPassMode = 'plan' | 'build' | 'revise' | 'chapter' | 'notes' | 'review' | 'variant';

/** §5.13 (V) 37-6 — 화면에서 가리킨 것. */
export interface StudioPointed {
  readonly bounds?: { x: number; y: number; width: number; height: number };
  readonly objectId?: string;
  readonly adapter?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source?: { readonly id: string; readonly revision: number; readonly appId: string };
  readonly itemId: string;
  readonly t: number;
  readonly kind: string;
  /** 기본 씬이면 그 씬 이름(`title` · `bulletList` …) — 어느 그리기 함수의 글자인지 에이전트가 안다. */
  readonly scene?: string | undefined;
  readonly file?: string | undefined;
  readonly path?: string | undefined;
  readonly text?: string | undefined;
  readonly prop?: string | null | undefined;
}

/** §5.13 (V) 37-7 — 맡기는 메모 핀. */
export interface StudioNoteRef {
  readonly id: string;
  readonly n: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly itemId?: string | undefined;
  readonly path?: string | undefined;
}

export interface StudioAgentContext {
  readonly projectName: string;
  readonly doc: Pick<VideoDoc, 'id' | 'title' | 'version'> & { readonly size?: VideoDoc['size'] };
  readonly playhead: number;
  readonly duration: number;
  /** 이 요청의 바퀴 id — 에이전트는 모든 patch 와 바퀴 보고에 싣는다. */
  readonly passId: string;
  readonly mode: StudioPassMode;
  /** 고른 아이템(해소된 시각 포함). */
  readonly selected?: ResolvedItem | undefined;
  /** 이번 말과 함께 문서에 들인 소재들. */
  readonly attached?: readonly VideoAsset[] | undefined;
  /** §5.13 (V) 37-2 — 소재 아닌 재료(CSV·JSON·글·SVG) — 프로젝트 기준 경로. */
  readonly materials?: readonly string[] | undefined;
  /** 이 장면만(구슬 메뉴·검수 고치기). */
  readonly chapter?: { readonly id: string; readonly title: string; readonly start: number; readonly end: number } | undefined;
  readonly pointed?: readonly StudioPointed[] | undefined;
  readonly notes?: readonly StudioNoteRef[] | undefined;
  /** 시작 화면의 레시피(요청 확장 — 영문 정본 `recipes.ts`). */
  readonly recipe?: { readonly id: string; readonly prompt: string } | undefined;
  readonly format?: VideoFormatId | undefined;
  readonly lengthSec?: number | undefined;
  /** §5.13 (V) 37-14 — Codex 내장 그림 생성 허용(사용자가 켤 때만). undefined 면 말하지 않는다(Claude). */
  readonly imageGeneration?: boolean | undefined;
  /** §5.13 (V) 37-14 — 같은 장면을 엔진마다 짓는 갈래. */
  readonly variant?: { readonly chapterId: string; readonly variantId: string; readonly engine: string } | undefined;
  /** §5.13 (V) 37-9 — 고치라고 맡긴 검수 결과. */
  readonly finding?: { readonly code: string; readonly t: number; readonly message: string; readonly itemId?: string | undefined } | undefined;
}

function seconds(t: number): string {
  return `${(Number.isFinite(t) ? Math.max(0, t) : 0).toFixed(2)}s`;
}

function quote(s: string, max = 160): string {
  return JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);
}

/**
 * §5.13 (V) 37-6 — 가리킨 것 한 줄(에이전트가 읽는 데이터). 가리키기 칩의 문맥 블록과 Alt 인스펙터 복사(§5.4 #15 (C))가 **같은
 * 말**을 쓴다 — 두 벌이면 한쪽만 고쳐져 같은 것을 두 가지로 말하게 된다.
 */
export function describePointed(p: StudioPointed): string {
  const parts = [`item "${p.itemId}" (${p.kind}${p.scene ? ` "${p.scene}"` : ''}) at ${seconds(p.t)}`];
  if (p.file) parts.push(`file ${p.file}`);
  if (p.path) parts.push(`element ${quote(p.path, 200)}`);
  if (p.objectId) parts.push(`object id ${quote(p.objectId)}, adapter ${p.adapter ?? 'custom'}`);
  if (p.bounds) {
    const b = p.bounds;
    parts.push(`selection bounds ${JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })}`);
  }
  if (p.properties) parts.push(`object properties ${JSON.stringify(p.properties)}`);
  if (p.source) parts.push(`editable source ${p.source.id} revision ${p.source.revision} (${p.source.appId}); modify this source with its baseRevision, preserve other objects, then selectively update linked video items`);
  if (p.prop) parts.push(`bound to prop "${p.prop}"`);
  if (p.text) parts.push(`text ${quote(p.text, 120)}`);
  return parts.join(', ');
}

/** 이 문서가 프로젝트 안 어디에 있나(프로젝트 기준 경로). */
export function studioDocFile(docId: string): string {
  return `.vibisual/${VIDEO_DIR}/${docId}.json`;
}

/**
 * §5.4 #15 (C) — Alt 인스펙터로 미리보기 안을 집었을 때 복사하는 글. 받는 쪽은 스튜디오 밖의 에이전트일 수도 있어(사용자가
 * 아무 대화에나 붙여 넣는다) 문서·판본·프로젝트·파일 자리를 함께 싣고, 고치는 길(규약 글)을 한 줄로 알린다.
 */
export function buildStudioPickClipboard(ctx: {
  readonly projectName: string;
  readonly doc: Pick<VideoDoc, 'id' | 'title' | 'version'> & { readonly size?: VideoDoc['size'] };
  readonly duration: number;
}, p: StudioPointed): string {
  const size = ctx.doc.size ? `, ${ctx.doc.size.width}x${ctx.doc.size.height}` : '';
  return [
    `[Video] document "${ctx.doc.id}" (${quote(ctx.doc.title)}, version ${ctx.doc.version}, ${seconds(ctx.duration)}${size}) in project ${quote(ctx.projectName)} — file ${studioDocFile(ctx.doc.id)}`,
    `[Pointed] ${describePointed(p)}`,
    '[Hint] This is video document data, not app code. Change it through the Vibistudio API (guide: GET $VIBISUAL_BASE/api/app/vibistudio/guide); GET the document before you patch.',
  ].join('\n');
}

/**
 * §5.4 #15 (C) — 프레임 띠의 칸 하나(그 아이템의 그 시각)를 Alt 인스펙터로 집었을 때의 복사 글(띠는 그림 한 장이라 칸을 모르면 통째로 집힌다).
 * 아이템을 모르면 undefined — 그림 그대로 DOM 으로 집힌다.
 */
export function stripPickClipboard(
  projectName: string,
  doc: VideoDoc | null,
  duration: number,
  itemId: string | undefined,
): ((t: number, frame: number, count: number) => string) | undefined {
  if (!doc || !itemId) return undefined;
  const item = doc.tracks.flatMap((track) => track.items).find((entry) => entry.id === itemId);
  if (!item) return undefined;
  return (t, frame, count) => buildStudioPickClipboard({ projectName, doc, duration }, {
    itemId, t, kind: item.kind, path: `frame strip, frame ${frame} of ${count}`,
  });
}

export function buildStudioAgentContext(ctx: StudioAgentContext): string {
  const size = ctx.doc.size ? `, ${ctx.doc.size.width}x${ctx.doc.size.height}` : '';
  const lines = [
    '---',
    `${STUDIO_CONTEXT_MARK} The user sent the note above from Vibistudio while reviewing video document "${ctx.doc.id}" (${quote(ctx.doc.title)}, version ${ctx.doc.version}, ${seconds(ctx.duration)}${size}) in project ${quote(ctx.projectName)}.`,
    `- Pass: ${ctx.passId} (mode: ${ctx.mode}). Send "passId": "${ctx.passId}" with every patch (and "focus": <chapterId> while you work on a chapter), then finish with POST /doc/${ctx.doc.id}/pass.`,
    `- Playhead: ${seconds(ctx.playhead)}.`,
  ];
  if (ctx.format) lines.push(`- Format: ${ctx.format}${ctx.lengthSec ? `, target length ${ctx.lengthSec}s` : ''}.`);
  if (ctx.chapter) lines.push(`- Scope: only chapter "${ctx.chapter.id}" (${quote(ctx.chapter.title)}, ${seconds(ctx.chapter.start)}–${seconds(ctx.chapter.end)}). Leave other chapters as they are.`);
  if (ctx.variant) lines.push(`- Variant: build chapter "${ctx.variant.chapterId}" as variant "${ctx.variant.variantId}" (${ctx.variant.engine}) — every item you add carries "variantId": "${ctx.variant.variantId}" and "chapterId": "${ctx.variant.chapterId}". Do not touch other variants.`);
  if (ctx.selected) {
    const item = ctx.selected.item;
    lines.push(`- Selected item: "${item.id}" (${item.kind}${item.label ? `, ${quote(item.label, 80)}` : ''}) at ${seconds(ctx.selected.start)}–${seconds(ctx.selected.end)}.`);
  }
  for (const p of ctx.pointed ?? []) lines.push(`- Pointed at: ${describePointed(p)}.`);
  for (const n of ctx.notes ?? []) {
    const where = `${seconds(n.t)}, x ${n.x.toFixed(2)} y ${n.y.toFixed(2)}${n.itemId ? `, item "${n.itemId}"` : ''}${n.path ? `, element ${quote(n.path, 160)}` : ''}`;
    lines.push(`- Note #${n.n} (id "${n.id}") at ${where}: ${quote(n.text, 400)}`);
  }
  if ((ctx.notes?.length ?? 0) > 0) lines.push('  When a note is fixed, list its id in "notesFixed" of the pass report.');
  for (const asset of ctx.attached ?? []) {
    const path = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
    lines.push(`- Attached asset (already in the document, not placed yet): "${asset.id}" (${asset.kind}, ${path}).`);
  }
  for (const path of ctx.materials ?? []) {
    lines.push(`- Material file (read it from the project): ${path}`);
  }
  if (ctx.finding) {
    lines.push(`- Review finding to fix: ${ctx.finding.code} at ${seconds(ctx.finding.t)}${ctx.finding.itemId ? ` on item "${ctx.finding.itemId}"` : ''}: ${quote(ctx.finding.message, 300)}`);
  }
  if (ctx.imageGeneration === true) {
    lines.push('- Image generation is ALLOWED for this request: you may use your built-in image generation to make still backgrounds or illustrations; save them as PNG in the project and import them with POST /assets/import.');
  } else if (ctx.imageGeneration === false) {
    lines.push('- Do not generate images for this request.');
  }
  lines.push(
    'Follow the Vibistudio protocol: if you have not read it in this session, GET $VIBISUAL_BASE/api/app/vibistudio/guide (header x-vibisual-hook-token: ${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}). GET the document before you patch.',
    'Do not render or export a video unless the user asks — the editor reloads your changes by itself.',
  );
  return lines.join('\n');
}

/** 사용자의 말 + (레시피) + 문맥 블록. 이미 블록이 붙은 글이면 그대로 둔다. */
export function withStudioAgentContext(text: string, ctx: StudioAgentContext): string {
  if (text.includes(STUDIO_CONTEXT_MARK)) return text;
  const recipe = ctx.recipe && ctx.recipe.prompt.trim() !== '' ? `\n\n${ctx.recipe.prompt.trim()}` : '';
  return `${text.trimEnd()}${recipe}\n\n${buildStudioAgentContext(ctx)}`;
}

/** 대화에 보일 때는 문맥 블록을 걷는다(사용자가 쓴 말만). */
export function stripStudioContext(text: string): string {
  const at = text.indexOf(STUDIO_CONTEXT_MARK);
  if (at < 0) return text;
  const head = text.slice(0, at).replace(/\n-{3}\s*$/, '').trimEnd();
  const recipeAt = head.search(/\n\nRecipe "[a-z-]+" —/);
  return (recipeAt >= 0 ? head.slice(0, recipeAt) : head).trimEnd();
}
