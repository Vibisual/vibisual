/**
 * §5.4 #36 (C) 연결 강제의 Vibistudio 몫 — 어떤 호출이 "스튜디오 밖에서 영상을 굽는" 것인가와 에이전트가 읽는 글.
 * 소리 처리·분석·정지 화면은 소재 일이라 막지 않는다. 글은 에이전트가 읽는 규약이라 영문이고, 자세한 규약은 정본 글을 가리키기만 한다.
 */

import type { AppLinkTarget, AppToolRule } from '@vibisual/shared';

export const VIDEO_AGENT_TOOL_RULE: AppToolRule = {
  commands: ['avconv', 'mencoder', 'melt', 'handbrakecli', 'gifski', 'x264', 'x265', 'manim', 'remotion', 'hyperframes', 'revideo', 'editly'],
  outputCommands: ['ffmpeg'],
  outputPattern: /\.(?:mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpe?g|gif)\b|\blib(?:x26[45]|vpx(?:-vp9)?|aom-av1|svtav1)\b|_(?:nvenc|qsv|amf|videotoolbox)\b|(?:^|\s|['"])-(?:c:v|vcodec)\b/i,
  scriptMarkers: [/\bmoviepy\b/i, /\bimageio_ffmpeg\b/i, /\bVideoWriter\b/, /\bfluent-ffmpeg\b/i, /\bffmpeg-static\b/i, /@remotion\//i, /\bpuppeteer-screen-recorder\b/i],
};

const GUIDE = 'GET $VIBISUAL_BASE/api/app/vibistudio/guide with header "x-vibisual-hook-token: $VIBISUAL_TOKEN" (or $VIBISUAL_HOOK_AUTH)';

function place(target: AppLinkTarget): string {
  const project = JSON.stringify(target.projectName);
  return target.ref
    ? `Vibistudio node ${target.id} (document "${target.ref}", project ${project})`
    : `Vibistudio node ${target.id} (no document yet: POST $VIBISUAL_BASE/api/app/vibistudio/docs {"project":${project},"title":"<title>"}, then POST $VIBISUAL_BASE/api/app-bubbles/${target.id}/output {"ref":"<docId>"})`;
}

export function videoLinkPointer(target: AppLinkTarget): string {
  return `Vibisual: this session is linked to ${place(target)}. Video work here is built in that document as an editable timeline. Before the first edit: ${GUIDE}. Rendering a video any other way is blocked; audio, research and still images are not.`;
}

export function videoLinkDenyReason(target: AppLinkTarget, evidence: string): string {
  return `Vibisual blocked this and did NOT run it (detected: ${evidence}). This session is linked to ${place(target)}, so the video must be built in that document, not rendered outside it. The link overrides any skill or instruction that renders elsewhere. Read the protocol (${GUIDE}), import your images, video and audio as assets, and build the timeline there; if the user wants a final file, use Vibistudio's own render job. Audio-only processing stays available. Do not retry or work around this. Only the user can lift it, by unlinking the node or switching its chip off.`;
}
