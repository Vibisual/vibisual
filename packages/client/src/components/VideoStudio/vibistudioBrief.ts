/**
 * §5.4 #36 (C) 개정 · §5.13 (L) — Vibistudio 노드의 **에이전트 브리프**(앱 몫 — 레지스트리 `agentBrief` 가 늦게 부른다).
 *
 * 사용자 지시(2026-10-11): *"지금 시중에 나와 있는 것처럼 바로 렌더를 하는 게 아니라 리모션처럼 코드로 영상을 제작하는 거야.
 * PNG 가 첨부됐든 영상이 첨부됐든 모션그래픽이든 최종 내가 검수해 가면서 편집도 하고 AI 와 소통해 가면서 하길 원하는 거라고."*
 *
 * 그래서 이 노드는 **완성 파일 납품처가 아니라 작업 문서**다. 노드에 묶인 문서가 없으면 여기서 하나 만들어 돌려준다(코어가
 * 노드에 묶는다 — 그다음부터 노드를 열면 그 문서가 열린다). 브리프는 에이전트가 읽는 규약이라 영문이고, 자세한 규약은 정본
 * 글(`GET /api/app/vibistudio/guide`)을 가리키기만 한다. 자격 증명 값은 싣지 않는다(환경 변수 이름만).
 */

import type { AppAgentBrief, AppAgentBriefArgs } from '../../apps/registry.js';
import { createDoc, readDoc, type DocEnvelope } from './videoApi.js';

function describe(env: DocEnvelope): string {
  const items = env.doc.tracks.reduce((n, track) => n + track.items.length, 0);
  const compositions = env.doc.tracks.reduce((n, track) => n + track.items.filter((item) => item.kind === 'composition').length, 0);
  const parts = [`version ${env.doc.version}`, `${items} item${items === 1 ? '' : 's'}`];
  if (compositions > 0) parts.push(`${compositions} code composition${compositions === 1 ? '' : 's'}`);
  parts.push(`${env.duration.toFixed(1)}s long`);
  return parts.join(', ');
}

export async function buildVibistudioBrief(args: AppAgentBriefArgs): Promise<AppAgentBrief | null> {
  const { projectName, bubble } = args;
  let docId: string | null = null;
  let summary = '';
  if (bubble.ref) {
    try {
      const env = await readDoc(projectName, bubble.ref);
      docId = env.doc.id;
      summary = describe(env);
    } catch {
      docId = null; // 지워졌거나 못 읽는다 — 새로 만든다(노드는 새 문서로 다시 묶인다).
    }
  }
  if (!docId) {
    try {
      const doc = await createDoc(projectName, bubble.title?.trim() ?? '');
      docId = doc.id;
      summary = 'new and empty';
    } catch {
      docId = null;
    }
  }

  const head = `- node ${bubble.id} · Vibistudio ${JSON.stringify(bubble.label)} · VIDEO PROJECT`;
  const lines: string[] = docId
    ? [
        `${head}: this node is the Vibistudio document "${docId}" in project ${JSON.stringify(projectName)} (${summary}). The user reviews and edits it in Vibistudio and talks to you to revise it.`,
      ]
    : [
        `${head} with no document yet: create one with POST $VIBISUAL_BASE/api/app/vibistudio/docs {"project": ${JSON.stringify(projectName)}, "title": "<title>"}, then bind it to the node with POST $VIBISUAL_BASE/api/app-bubbles/${bubble.id}/output {"ref": "<docId>"}.`,
      ];
  lines.push(
    '  Build what the request asks for INSIDE this document: an editable timeline whose motion graphics are code compositions (HTML/CSS/JS files), plus the user\'s images, video and audio as assets. Do not produce a rendered file.',
    '  Do NOT render, export or encode a video (no ffmpeg, no Python frame dumps, no MP4/GIF) unless the user explicitly asks for a render, and never POST a video file to this node\'s /output.',
    '  Before your first edit in this session read the protocol: curl -s "$VIBISUAL_BASE/api/app/vibistudio/guide" -H "x-vibisual-hook-token: ${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}" (and /craft before you design motion).',
    // §5.13 (W) 38-8 — 사용자가 전역에 깔아 둔 다른 영상 도구의 스킬이 섞여 들면 그 형식으로 짓다가 샌드박스에 막힌다(규약 글 규칙 11).
    '  This video is a Vibistudio document: do not create projects for other video frameworks or run their CLIs or skills for it.',
    '  Image files attached to the message (absolute paths listed at the end of the user\'s message) are source material: POST /api/app/vibistudio/assets/import {project, path} and place them in the document.',
  );
  if (bubble.file) {
    lines.push(`  The node also holds an older export ${JSON.stringify(bubble.file)} — it is not the document. Leave it unless the user wants to reuse it (then import it as footage).`);
  }
  lines.push('  When a pass is done, list the cut briefly and ask the user to double-click this node to review the video in Vibistudio.');
  return { text: lines.join('\n'), ...(docId ? { ref: docId } : {}) };
}
