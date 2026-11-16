/**
 * §5.4 #36 (K) — 전용 버블의 종류 표. 앱이 레지스트리 `dedicated` 로 선언한다(§5.13 (P-4)) — 코어는 앱 이름을 모르고 이 표만 돌린다.
 * 규칙은 위에서부터 첫 일치가 이긴다. 어느 규칙에도 안 맞으면 그 앱과 무관한 것이라 전용 버블에 붙지 않는다.
 * `id` 는 체크 상태의 저장 열쇠(`<프로필>:<종류>`)다 — 바꾸면 사용자가 푼 체크가 풀린다.
 */
import type { FileFaceKind } from '@vibisual/shared';
import { fileFaceExtOf, fileFaceKindOf } from '@vibisual/shared';

export interface DedicatedRule {
  readonly category: string;
  /** 파일 종류(`fileFaceKindOf`) — `exts` 와 둘 중 하나만 맞으면 통과. */
  readonly kinds?: readonly FileFaceKind[];
  readonly exts?: readonly string[];
  /** 경로에 든 낱말 — `kinds`/`exts` 를 통과한 파일에 더 건다. 둘이 없으면 이것만으로 판정한다. */
  readonly hint?: RegExp;
  /** 명령 앱 이름. */
  readonly command?: RegExp;
  readonly anyFile?: boolean;
  readonly anyCommand?: boolean;
  readonly anyDomain?: boolean;
}

export interface DedicatedProfile {
  readonly id: string;
  /** 전용 버블 이름의 i18n 키. */
  readonly hubLabelKey: string;
  /** 체크 목록의 순서이자 종류의 전부. 이름은 `canvas.dedicated.category.<id>`. */
  readonly categories: readonly string[];
  readonly rules: readonly DedicatedRule[];
}

export type DedicatedItem =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'command'; readonly name: string }
  | { readonly kind: 'domain' };

/** 경로 어디든 낱말이 들었나. `prefix` 는 낱말 시작만(`narrationTrack`), `exact` 는 양끝까지(`vo` 가 `volume` 에 걸리지 않게), `cjk` 는 낱말 경계가 없다. */
function hint(prefix: readonly string[], exact: readonly string[] = [], cjk: readonly string[] = []): RegExp {
  const parts: string[] = [];
  if (prefix.length > 0) parts.push(`(?:^|[^a-z0-9])(?:${prefix.join('|')})`);
  if (exact.length > 0) parts.push(`(?:^|[^a-z0-9])(?:${exact.join('|')})(?:[^a-z0-9]|$)`);
  parts.push(...cjk);
  return new RegExp(parts.join('|'), 'i');
}

const SCRIPT_HINT = hint(['script', 'screenplay', 'scenario', 'storyboard', 'subtitle', 'caption', 'transcript'], [], ['대본', '각본', '시나리오', '콘티', '자막', '스크립트']);
const LYRIC_HINT = hint(['lyric', 'script', 'transcript'], [], ['가사', '대본', '스크립트']);
const VOICE_HINT = hint(['narrat', 'voice', 'vocal', 'dialog', 'dub'], ['vo', 'tts'], ['나레이션', '내레이션', '더빙', '음성', '목소리', '보컬']);
const EFFECT_HINT = hint(['effect', 'vfx', 'transition', 'shader', 'overlay', 'particle'], ['fx', 'sfx', 'lut'], ['이펙트', '효과', '트랜지션', '오버레이']);
const SFX_HINT = hint(['sfx', 'foley', 'whoosh', 'effect'], ['fx'], ['효과음']);
const PROMPT_HINT = hint(['prompt'], [], ['프롬프트']);
const RENDER_HINT = hint(['render', 'preview', 'thumb'], [], ['렌더', '미리보기']);
const SCENE_CODE_HINT = hint(['three', 'scene', 'blender', 'bpy', 'mesh', 'model'], [], ['모델', '장면']);
const ANIMATION_HINT = hint(['anim', 'mocap', 'rig'], [], ['애니메이션', '리깅']);

const VIDEO_TOOLS = /ffmpeg|ffprobe|remotion|yt-dlp|whisper|mediainfo/i;
const SOUND_TOOLS = /ffmpeg|ffprobe|sox|whisper|lame/i;
const MODEL_TOOLS = /blender|gltf|assimp|meshlab/i;
const IMAGE_TOOLS = /magick|sharp|exiftool|inkscape|gimp/i;

const VECTOR_EXTS = ['.svg', '.svgz', '.ai', '.eps'] as const;
const DESIGN_EXTS = ['.psd', '.psb', '.xcf', '.kra', '.sketch', '.fig'] as const;
const MATERIAL_EXTS = ['.mtl', '.sbs', '.sbsar', '.mat'] as const;
const LOOK_EXTS = ['.cube', '.3dl', '.lut', '.look', '.glsl', '.frag', '.vert', '.wgsl', '.hlsl'] as const;
const MIDI_EXTS = ['.mid', '.midi', '.musicxml', '.mscz', '.gp5', '.gpx', '.xm', '.it', '.s3m'] as const;

export const VIDEO_DEDICATED_PROFILE: DedicatedProfile = {
  id: 'video',
  hubLabelKey: 'canvas.dedicated.hub.video',
  categories: ['script', 'image', 'narration', 'music', 'effect', 'video', 'font', 'tool'],
  rules: [
    // 이펙트가 먼저 — `fire_fx.mp4` 는 영상이 아니라 이펙트다.
    { category: 'effect', exts: LOOK_EXTS },
    { category: 'effect', kinds: ['image', 'video', 'audio', 'code', 'data'], hint: EFFECT_HINT },
    { category: 'script', kinds: ['subtitle'] },
    { category: 'script', exts: ['.fountain'] },
    { category: 'script', kinds: ['doc'], hint: SCRIPT_HINT },
    { category: 'narration', kinds: ['audio'], hint: VOICE_HINT },
    { category: 'music', kinds: ['audio'] },
    { category: 'image', kinds: ['image'] },
    { category: 'video', kinds: ['video'] },
    { category: 'font', kinds: ['font'] },
    { category: 'tool', command: VIDEO_TOOLS },
  ],
};

export const SOUND_DEDICATED_PROFILE: DedicatedProfile = {
  id: 'sound',
  hubLabelKey: 'canvas.dedicated.hub.sound',
  categories: ['voice', 'music', 'sfx', 'midi', 'lyrics', 'tool'],
  rules: [
    { category: 'midi', exts: MIDI_EXTS },
    { category: 'sfx', kinds: ['audio'], hint: SFX_HINT },
    { category: 'voice', kinds: ['audio'], hint: VOICE_HINT },
    { category: 'music', kinds: ['audio'] },
    { category: 'lyrics', kinds: ['subtitle'] },
    { category: 'lyrics', kinds: ['doc'], hint: LYRIC_HINT },
    { category: 'tool', command: SOUND_TOOLS },
  ],
};

export const MODEL_DEDICATED_PROFILE: DedicatedProfile = {
  id: 'model',
  hubLabelKey: 'canvas.dedicated.hub.model',
  categories: ['model', 'texture', 'material', 'animation', 'render', 'sceneCode', 'tool'],
  rules: [
    { category: 'material', exts: MATERIAL_EXTS },
    { category: 'animation', exts: ['.bvh', '.anim'] },
    { category: 'animation', kinds: ['model', 'data'], hint: ANIMATION_HINT },
    { category: 'render', kinds: ['video'] },
    { category: 'render', kinds: ['image'], hint: RENDER_HINT },
    { category: 'texture', kinds: ['image'] },
    { category: 'model', kinds: ['model'] },
    { category: 'sceneCode', kinds: ['code'], hint: SCENE_CODE_HINT },
    { category: 'tool', command: MODEL_TOOLS },
  ],
};

export const IMAGE_DEDICATED_PROFILE: DedicatedProfile = {
  id: 'image',
  hubLabelKey: 'canvas.dedicated.hub.image',
  categories: ['image', 'vector', 'design', 'prompt', 'font', 'tool'],
  rules: [
    { category: 'vector', exts: VECTOR_EXTS },
    { category: 'design', exts: DESIGN_EXTS },
    { category: 'image', kinds: ['image'] },
    { category: 'prompt', kinds: ['doc'], hint: PROMPT_HINT },
    { category: 'font', kinds: ['font'] },
    { category: 'tool', command: IMAGE_TOOLS },
  ],
};

/** 앱이 이어지지 않은 말풍선 — 전부 종류별로 선다. */
export const GENERAL_DEDICATED_PROFILE: DedicatedProfile = {
  id: 'general',
  hubLabelKey: 'canvas.dedicated.hub.general',
  categories: ['doc', 'code', 'image', 'video', 'sound', 'model', 'data', 'font', 'other', 'tool', 'web'],
  rules: [
    { category: 'doc', kinds: ['doc', 'subtitle'] },
    { category: 'code', kinds: ['code'] },
    { category: 'image', kinds: ['image'] },
    { category: 'video', kinds: ['video'] },
    { category: 'sound', kinds: ['audio'] },
    { category: 'model', kinds: ['model'] },
    { category: 'data', kinds: ['data'] },
    { category: 'font', kinds: ['font'] },
    { category: 'other', anyFile: true },
    { category: 'tool', anyCommand: true },
    { category: 'web', anyDomain: true },
  ],
};

function fileRuleMatches(rule: DedicatedRule, path: string): boolean {
  if (rule.anyFile === true) return true;
  const gated = rule.kinds !== undefined || rule.exts !== undefined;
  if (gated) {
    const passes = (rule.kinds?.includes(fileFaceKindOf(path)) ?? false) || (rule.exts?.includes(fileFaceExtOf(path)) ?? false);
    if (!passes) return false;
    return rule.hint === undefined || rule.hint.test(path);
  }
  return rule.hint !== undefined && rule.hint.test(path);
}

/** 이 항목의 종류. 어느 규칙에도 안 맞으면 `null` — 그 앱과 무관하다. */
export function classifyDedicatedItem(profile: DedicatedProfile, item: DedicatedItem): string | null {
  for (const rule of profile.rules) {
    if (item.kind === 'file') {
      if (fileRuleMatches(rule, item.path.replace(/\\/g, '/'))) return rule.category;
    } else if (item.kind === 'command') {
      if (rule.anyCommand === true || rule.command?.test(item.name) === true) return rule.category;
    } else if (rule.anyDomain === true) {
      return rule.category;
    }
  }
  return null;
}
