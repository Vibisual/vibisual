/**
 * §5.13 (G)(V) 37-16 — 스튜디오에서 AI 에게 보내는 말에 붙이는 **문맥 블록**(순수 — 영문, 에이전트가 읽는 데이터).
 *
 * 사용자는 스튜디오에서 보며 고친다 — "2초쯤 제목을 더 크게", "이 그림을 넣어 줘", 핀 두 개, 화면에서 가리킨 글자. 그 말만
 * 보내면 에이전트는 어느 문서의 어디를 말하는지 모른다. 그래서 지금 문서·판본·바퀴 id·바퀴 종류·재생 위치·고른 것·가리킨 것·
 * 메모·첨부·장면 범위·레시피를 **데이터로** 싣는다. 규약(어떻게 고치나 — 기획 먼저·값 선언·passId·바퀴 보고)은 정본 글
 * (`GET …/guide`)이 말하고, 여기서는 가리키기만 한다(두 벌 ❌). 엔진이 Claude 든 Codex 든 같은 글이다.
 */

import type { ResolvedItem, VideoAsset, VideoDoc, VideoFormatId } from '@vibisual/video';

/** 블록이 시작되는 표식 — 같은 블록이 두 번 붙지 않게(전송 실패로 초안에 되돌아온 글을 다시 보낼 때). */
export const STUDIO_CONTEXT_MARK = '[Vibistudio editor context]';

/** 바퀴의 성격 — 규약 글이 각각 무엇을 할지 말한다. */
export type StudioPassMode = 'plan' | 'build' | 'revise' | 'chapter' | 'notes' | 'review' | 'variant';

/** §5.13 (V) 37-6 — 화면에서 가리킨 것. */
export interface StudioPointed {
  readonly itemId: string;
  readonly t: number;
  readonly kind: string;
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
  for (const p of ctx.pointed ?? []) {
    const parts = [`item "${p.itemId}" (${p.kind}) at ${seconds(p.t)}`];
    if (p.file) parts.push(`file ${p.file}`);
    if (p.path) parts.push(`element ${quote(p.path, 200)}`);
    if (p.prop) parts.push(`bound to prop "${p.prop}"`);
    if (p.text) parts.push(`text ${quote(p.text, 120)}`);
    lines.push(`- Pointed at: ${parts.join(', ')}.`);
  }
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
