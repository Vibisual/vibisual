import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  Conti,
  ContiFrame,
  ContiElement,
  ContiElementType,
} from '@vibisual/shared';
import { CONTI_DEFAULTS, STAMP_CATALOG } from '@vibisual/shared';
import { logger } from '../logger.js';
import { resolveClaudeBin } from './claudeBin.js';

/** §5.3 #28 v1.62 — patch sub-agent 가 spawn 할 claude 바이너리 경로. */
const CLAUDE_BIN_PATH = resolveClaudeBin().binPath;

const TIMEOUT_MS = 120_000;

/** §5.3 #28 v1.60 — `stamp` 포함 5종. */
const VALID_TYPES: readonly ContiElementType[] = ['rect', 'circle', 'text', 'line', 'stamp'];
const VALID_BADGE_KINDS = ['add', 'mod', 'evt'] as const;

/** §5.3 #28 v1.60 — STAMP_CATALOG 키 집합 (lookup 빠르게). */
const STAMP_NAMES = new Set<string>(Object.keys(STAMP_CATALOG));

function rid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampNum(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * LLM 응답 element 1개 → 안전하게 정규화 (geometry 클램프, type 검증).
 *
 * §5.3 #28 v1.60 — `type==='stamp'` 인 경우:
 *   - `stampName` 이 STAMP_CATALOG 키가 아니면 element 통째로 reject (LLM 환각 차단).
 *   - `stampVariant` 가 카탈로그의 variants 에 없으면 drop (stamp 자체는 유지, 기본 variant 사용).
 *   - `w`/`h` 미지정 시 카탈로그 defaultW/defaultH 자동 채움.
 */
function coerceElement(raw: unknown, fallbackId?: string): ContiElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = VALID_TYPES.includes(o['type'] as ContiElementType) ? o['type'] as ContiElementType : null;
  if (!type) return null;
  const w = CONTI_DEFAULTS.viewBoxWidth;
  const h = CONTI_DEFAULTS.viewBoxHeight;

  // §5.3 #28 v1.60 — stamp 사전 검증: 카탈로그에 없는 이름은 통째로 drop
  let stampSpec: typeof STAMP_CATALOG[keyof typeof STAMP_CATALOG] | null = null;
  if (type === 'stamp') {
    const name = typeof o['stampName'] === 'string' ? (o['stampName'] as string) : '';
    if (!name || !STAMP_NAMES.has(name)) {
      logger.warn(`contiManager.coerce: unknown stampName="${name}", dropping element`);
      return null;
    }
    stampSpec = STAMP_CATALOG[name as keyof typeof STAMP_CATALOG] ?? null;
  }

  const el: ContiElement = {
    id: typeof o['id'] === 'string' && o['id'] ? (o['id'] as string) : (fallbackId ?? rid('el')),
    type,
    x: clampNum(o['x'], 0, -10, w + 10),
    y: clampNum(o['y'], 0, -10, h + 10),
  };
  if (o['w'] !== undefined) {
    el.w = clampNum(o['w'], stampSpec?.defaultW ?? 0, 0, w + 10);
  } else if (stampSpec) {
    el.w = stampSpec.defaultW;
  }
  if (o['h'] !== undefined) {
    el.h = clampNum(o['h'], stampSpec?.defaultH ?? 0, 0, h + 10);
  } else if (stampSpec) {
    el.h = stampSpec.defaultH;
  }
  if (typeof o['label'] === 'string') el.label = o['label'].slice(0, 200);
  if (typeof o['stroke'] === 'string') el.stroke = o['stroke'].slice(0, 64);
  if (typeof o['fill'] === 'string') el.fill = o['fill'].slice(0, 64);
  // v1.59 — viewBox 320×180 표준화에 맞춰 strokeWidth/fontSize 범위 확대
  if (typeof o['strokeWidth'] === 'number') el.strokeWidth = clampNum(o['strokeWidth'], CONTI_DEFAULTS.defaultStrokeWidth, 1, 14);
  if (typeof o['dash'] === 'string') el.dash = o['dash'].slice(0, 32);
  if (typeof o['fontSize'] === 'number') el.fontSize = clampNum(o['fontSize'], CONTI_DEFAULTS.defaultFontSize, 8, 48);

  // §5.3 #28 v1.60 — stamp 식별/variant
  if (stampSpec) {
    el.stampName = o['stampName'] as string;
    const variant = typeof o['stampVariant'] === 'string' ? (o['stampVariant'] as string) : '';
    if (variant && (stampSpec.variants as readonly string[]).includes(variant)) {
      el.stampVariant = variant;
    } else if (variant) {
      // 카탈로그에 없는 variant — stamp 자체는 유지, variant 만 무시 (기본 모양으로 렌더)
      logger.warn(`contiManager.coerce: unknown variant="${variant}" for stamp="${el.stampName}", using default`);
    }
  }
  return el;
}

/**
 * §5.3 #28 v1.62 — 체크포인트에서 복원된 Conti 의 frames/elements 를 재정규화.
 *
 * 이전 버전(또는 외부 경로) 로 디스크에 박혀 있던 NaN 좌표/문자열 숫자/빠진 stamp 정보를
 * 클라이언트로 흘려보내면 `<circle r={NaN}>` 같은 SVG 오류가 매 리렌더마다 콘솔에 쌓인다.
 * 로드 시 한 번 coerceElement 를 다시 돌려서 디스크 데이터의 위생 보장.
 */
export function sanitizeContiOnLoad(c: Conti): Conti {
  const frames: ContiFrame[] = c.frames.map((f) => {
    const elements: ContiElement[] = [];
    for (const el of f.elements) {
      const fixed = coerceElement(el, el.id);
      if (fixed) elements.push(fixed);
    }
    return { ...f, elements };
  });
  return { ...c, frames };
}

function coerceFrame(raw: unknown): ContiFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const elementsArr = Array.isArray(o['elements']) ? o['elements'] : [];
  const elements: ContiElement[] = [];
  for (const er of elementsArr) {
    const el = coerceElement(er);
    if (el) elements.push(el);
  }
  const badges = Array.isArray(o['badges'])
    ? o['badges']
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => {
          const kindRaw = b['kind'];
          const kind = (VALID_BADGE_KINDS as readonly string[]).includes(toStr(kindRaw))
            ? (toStr(kindRaw) as 'add' | 'mod' | 'evt')
            : 'evt';
          return { kind, text: toStr(b['text']).slice(0, 80) };
        })
    : undefined;
  return {
    id: typeof o['id'] === 'string' && o['id'] ? (o['id'] as string) : rid('frame'),
    title: toStr(o['title']).slice(0, 200) || '(untitled)',
    action: toStr(o['action']).slice(0, 400),
    elements,
    ...(badges && badges.length > 0 ? { badges } : {}),
  };
}

/** 맨 처음 `{` 부터 매칭되는 마지막 `}` 까지 추출. 코드펜스 제거. */
function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const payload = fenceMatch?.[1] ?? trimmed;
  const start = payload.indexOf('{');
  const end = payload.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(payload.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Claude CLI 서브프로세스 단발 호출.
 *
 * **반드시 부모 에이전트 세션에 `--resume` 으로 붙는다** — 별도 새 세션 ❌.
 * 부모가 이미 들고 있는 컨텍스트(파일·tool_use 이력)를 그대로 활용하므로
 * 호출 측에서 추가 컨텍스트 압축·재요약 불필요. spawn cwd 도 부모 cwd 로 맞춘다.
 *
 * 사용자 세션 쿼터 재사용 — Anthropic SDK 직접 호출 ❌.
 */
function callClaude(
  prompt: string,
  opts: { sessionId: string; cwd: string; model?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const args = ['-p', prompt, '--resume', opts.sessionId];
    if (opts.model) args.push('--model', opts.model);

    let stdout = '';
    let stderr = '';
    // 보안: shell:false + 해석된 CLAUDE_BIN_PATH (runPatchAgent 와 동일 패턴).
    // shell:true + 'claude' 는 win32 cmd.exe 가 args 를 재파싱해 sessionId/model 경유
    // 셸 인젝션이 가능했음 — argv 형태로 차단.
    const child = spawn(CLAUDE_BIN_PATH, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });

    const timer = setTimeout(() => {
      logger.warn('contiManager.callClaude: timeout, killing claude process');
      try { child.kill(); } catch { /* ignore */ }
      settle(null);
    }, TIMEOUT_MS);

    child.stdout?.on('data', (buf: Buffer) => { stdout += buf.toString('utf8'); });
    child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString('utf8'); });

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.warn(`contiManager.callClaude: spawn error: ${err.message}`);
      settle(null);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.warn(`contiManager.callClaude: claude exited code=${code}, stderr=${stderr.slice(0, 300)}`);
        settle(null);
        return;
      }
      settle(stdout);
    });
  });
}

/**
 * generateConti / patchContiElement 호출 입력. 부모 세션에 resume 으로 붙으므로
 * recentEvents/recentCommands 같은 컨텍스트 재요약은 **불필요** — 부모가 이미 들고 있다.
 * agentLabel 만 prompt 에 echo 해 모델이 자기 정체성을 한 줄로 잡게 한다.
 */
export interface ContiContextInput {
  /** 부모 에이전트의 sessionId — `claude --resume <sessionId>` 인자 */
  sessionId: string;
  /** 부모 에이전트의 cwd — spawn cwd */
  cwd: string;
  /** 부모 에이전트 라벨 — prompt 에 1회 표시용 */
  agentLabel: string;
}

/**
 * §5.3 #28 v1.60 — STAMP_CATALOG 를 LLM 프롬프트용 인라인 텍스트로 렌더.
 * 카탈로그 항목 추가/제거는 shared/constants.ts 만 수정하면 자동 반영.
 */
function buildStampCatalogText(): string {
  const lines: string[] = [];
  const byCategory: Record<string, string[]> = {};
  for (const [name, spec] of Object.entries(STAMP_CATALOG)) {
    const variantStr = spec.variants.length > 0 ? ` variants: [${spec.variants.join(', ')}]` : '';
    const entry = `  - "${name}" (${spec.defaultW}×${spec.defaultH})${variantStr} — ${spec.summary}`;
    (byCategory[spec.category] ??= []).push(entry);
  }
  const order: Array<keyof typeof byCategory> = ['window', 'input', 'button', 'actor', 'content', 'indicator'];
  for (const cat of order) {
    const entries = byCategory[cat];
    if (!entries) continue;
    lines.push(`[${cat}]`);
    lines.push(...entries);
  }
  return lines.join('\n');
}

const STAMP_CATALOG_TEXT = buildStampCatalogText();

const GENERATE_INSTRUCTIONS = `You are a UX storyboard generator. Convert recent AI-agent activity into a comic-strip "conti" of 4-8 frames.
Each frame is a wireframe sketch inside a **320x180 (16:9)** viewBox — standard storyboard aspect.
Focus on what changed visually or what user-facing action happened. One frame = one beat.
Use 'add' badges for new artifacts, 'mod' for modifications, 'evt' for user events (clicks, saves).
Keep titles under 70 chars and actions under 200. Do not invent details — base every frame on the supplied events.

# STAMP-FIRST RULE (v1.60) — MANDATORY for legibility
**ALL UI components MUST be drawn as \`stamp\` elements, NEVER as composed rect/circle/line.**
Do NOT synthesize buttons, windows, inputs, avatars, arrows, etc. from raw primitives — the result is inconsistent and unreadable.

Priority order per frame:
1. **stamp** — every UI component (window/button/input/avatar/icon/bubble/arrow). Use \`stampName\` from the catalog below.
2. **text** — short captions/labels only (when a stamp's built-in label is insufficient).
3. **rect/circle/line** — only for residuals stamps cannot express: background fills, dividers, small marker dots. **Max 4 total per frame.**

Stamp coordinates: \`x,y\` is top-left, \`w,h\` is bounding box. Omit \`w,h\` to use catalog defaults.

# DENSITY RULE (v1.60) — Fill the frame, do NOT leave it empty
**Each frame MUST have at least 5 stamps.** Sparse frames (1-3 stamps floating in empty canvas) look amateurish.

Required composition per frame:
- **1 hero stamp** — the focal element (large window/modal/avatar). Usually 60-80% of frame area.
- **3-6 supporting stamps** — context inside or around the hero (buttons inside a window, an avatar pointing at it, a cursor, an arrow, a chat bubble).
- **0-3 text/rect captions** — labels, hints, or annotation arrows. Keep raw rect/circle/line ≤ 4 total.

Concrete frame skeletons (pick one per beat and adapt):
- **"user clicks button" beat**: \`browser-window\` (hero) + \`cursor-pointer\` over a \`button-primary\` inside + caption text below.
- **"agent thinks" beat**: \`app-window\` (hero) + \`agent-avatar\` (variant=\`thinking\`) + \`spinner\` + \`chat-bubble\` (variant=\`agent\`).
- **"settings panel opens" beat**: \`app-window\` (hero) + \`modal-dialog\` or \`side-panel\` inside + 2-3 \`dropdown\`/\`text-input\`/\`toggle-switch\` rows + \`button-primary\`/\`button-secondary\` footer pair.
- **"file/data flows"**: \`file-card\` + \`arrow\` (variant=\`right\`) + \`terminal\` or \`code-block\` + \`badge-pill\` status.
- **"two parties chat"**: \`user-avatar\` + \`chat-bubble\` (user) + \`agent-avatar\` + \`chat-bubble\` (agent).

Forbid empty frames: A frame with only 1-2 stamps and a single label is REJECTED — pack it with supporting stamps from the catalog.

# STAMP_CATALOG (only these names are accepted — others are dropped server-side)
${STAMP_CATALOG_TEXT}

# DESIGN SYSTEM (v1.61) — Dark 3-layer + semantic colors
The board renders on a dark theme. Use ONLY these tokens for fill/stroke. Never use light backgrounds or non-semantic accents.

3-layer dark backgrounds (canvas fills only):
- "#0F1117" outer · "#1A1D26" card · "#242833" demo · "#2D3140" chrome

Semantic accent colors (use with strict intent):
- "#A78BFA" = action (보라) — triggers and user actions: cursor target, user-pressed button, Agent bubble, the cause side of a flow.
- "#00E5A0" = result (민트) — outcomes and creations: new artifacts, the result side of a flow, success states, the destination of an arrow caption.

Text: "#E8E8E8" primary · "#9CA3AF" secondary/caption · "#4B5563" tertiary.
Border: "rgba(255,255,255,0.06)" subtle · "rgba(255,255,255,0.05)" faint.

Flow caption pattern (recommended in EVERY frame's bottom-right):
- text label1 in secondary "#9CA3AF" — the action word
- arrow stamp variant=right — the connector
- text label2 in result "#00E5A0" — the outcome word

Rules of semantics (viewers learn these subconsciously — keep strict):
- Purple = trigger only. Mint = outcome only. Never swap.
- At most TWO accent positions per frame (one trigger + one result).
- Never introduce a third accent color.

# Output Schema (ONE JSON object only, no markdown, no prose, no code fences):
{
  "title": "short title under 70 chars",
  "frames": [
    {
      "title": "frame title",
      "action": "one-sentence action description",
      "elements": [
        { "type": "rect", "x": 0, "y": 0, "w": 320, "h": 180, "fill": "#242833", "stroke": "none" },
        { "type": "stamp", "stampName": "browser-window", "stampVariant": "default", "x": 20, "y": 14, "w": 280, "h": 140, "label": "vibisual.app" },
        { "type": "stamp", "stampName": "agent-avatar", "x": 140, "y": 60, "w": 40, "h": 40, "label": "Agent" },
        { "type": "stamp", "stampName": "cursor-pointer", "x": 178, "y": 86, "w": 14, "h": 18 },
        { "type": "text", "x": 190, "y": 168, "label": "click", "fontSize": 11, "fill": "#9CA3AF" },
        { "type": "stamp", "stampName": "arrow", "stampVariant": "right", "x": 222, "y": 160, "w": 18, "h": 12 },
        { "type": "text", "x": 246, "y": 168, "label": "new agent", "fontSize": 11, "fill": "#00E5A0" }
      ],
      "badges": [ { "kind": "add|mod|evt", "text": "..." } ]
    }
  ]
}

Geometry: x in 0..320, y in 0..180. Aim for 5~10 stamps + 0~4 text/rect residuals per frame. Avoid attaching to canvas edges (margin >= 16). **First element MUST be a full rect with fill="#242833" to lock the dark canvas tone.**

Forbidden:
- Composing buttons / windows / avatars from rect+text — USE THE STAMP.
- Inventing stampName values not in the catalog above — server will drop them.
- More than 4 raw rect/circle/line elements per frame.
- Light backgrounds (#ffffff, #f9fafb, #f3f4f6) — DARK ONLY.
- Accent colors other than #A78BFA (action) and #00E5A0 (result). No blue/yellow/red/green.
- Mixing the semantics: purple for results or mint for triggers.
- Markdown, code fences, prose. JSON only.`;


/**
 * §5.3 #28 v1.47 — 콘티 1건 생성.
 *
 * **부모 에이전트 세션에 `claude --resume` 으로 붙어 호출한다.** 부모가 자기 작업 이력
 * (파일·tool_use·assistant 메시지 등)을 이미 들고 있으므로 별도 컨텍스트 압축 ❌.
 * 결과는 storage 로직 없이 ContiFrame[] + title 만 반환 — 호출부가 Conti 레코드 조립.
 */
export async function generateContiFrames(input: ContiContextInput): Promise<{ title?: string; frames: ContiFrame[] } | null> {
  const prompt = `${GENERATE_INSTRUCTIONS}\n\n---\n\nYou are agent "${input.agentLabel}". Reflect on YOUR OWN recent work in this session and emit a ${CONTI_DEFAULTS.defaultFrameCount}-frame conti as a single JSON object only.`;

  for (const model of [CONTI_DEFAULTS.primaryModel, CONTI_DEFAULTS.fallbackModel]) {
    const out = await callClaude(prompt, { sessionId: input.sessionId, cwd: input.cwd, model });
    if (!out) continue;
    const parsed = extractJson(out);
    if (!parsed || typeof parsed !== 'object') {
      logger.warn(`contiManager.generate: model=${model} unparseable: ${out.slice(0, 200)}`);
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    const framesArr = Array.isArray(obj['frames']) ? obj['frames'] : [];
    const frames: ContiFrame[] = [];
    for (const fr of framesArr) {
      const f = coerceFrame(fr);
      if (f) frames.push(f);
    }
    if (frames.length === 0) {
      logger.warn(`contiManager.generate: empty frames from model=${model}`);
      continue;
    }
    const title = typeof obj['title'] === 'string' ? (obj['title'] as string).slice(0, 200) : undefined;
    return { ...(title ? { title } : {}), frames };
  }
  return null;
}

/**
 * §5.3 #28 v1.62 — patch sub-agent 가 받을 룰. tmpdir 안에 REQUEST.md 로 저장된다.
 * - 도구는 Read/Edit 만 허용되고 cwd 는 격리된 tmpdir → 다른 파일/네트워크/Bash 다 차단.
 * - 모델은 직접 element.json 을 Edit. 우리는 응답 텍스트가 아니라 파일을 다시 읽어 검증한다.
 */
const PATCH_REQUEST_RULES = `# Element patch task

You are a precise JSON element patcher for a 2D storyboard tool.
The file \`element.json\` in this directory is an SVG-like primitive used in a comic-strip frame.

## STRICT rules (must follow)

1. Use the Edit tool **exactly once** on \`element.json\`. Do not read or edit any other file.
2. NEVER change the \`id\` field. NEVER add fields outside the schema below.
3. You MAY modify only these fields:
   \`type\`, \`x\`, \`y\`, \`w\`, \`h\`, \`stroke\`, \`fill\`, \`strokeWidth\`, \`dash\`, \`label\`, \`fontSize\`, \`stampName\`, \`stampVariant\`.
4. The \`type\` field must remain one of: \`rect\`, \`circle\`, \`line\`, \`text\`, \`stamp\`.
5. Keep coordinates inside x ∈ [0, ${CONTI_DEFAULTS.viewBoxWidth}], y ∈ [0, ${CONTI_DEFAULTS.viewBoxHeight}].
6. If the element is (or should become) a UI component, prefer \`type: "stamp"\` with a \`stampName\` from STAMP_CATALOG below. Composing primitives to mimic a known UI is forbidden.
7. After saving, reply with the single word **DONE** on its own line. No prose, no diff, no explanation.

## Schema

\`\`\`json
{ "id": "<preserved>", "type": "stamp|rect|circle|text|line", "stampName"?: "<from catalog>", "stampVariant"?: "<from variants>", "x": 0, "y": 0, "w": 80, "h": 50, "label": "...", "stroke": "#374151", "fill": "none", "strokeWidth": 2, "dash": "6 4", "fontSize": 14 }
\`\`\`

## STAMP_CATALOG (only these stampName values are valid)

${STAMP_CATALOG_TEXT}
`;

/** 일회용 patch sub-agent 1회 실행. tmpdir 안에서 element.json 을 직접 Edit 한다.
 *  - prompt 는 positional 한 줄로 — Windows shell 인자 mangling 회피.
 *  - shell:false — claudeBin 은 절대 .exe 경로라 shell 거칠 필요 없음. shell 거치면 newline/quote 처리 깨짐.
 *  - 자세한 규칙은 cwd/REQUEST.md 로 분리. */
function runPatchAgent(tmpdir: string, userPrompt: string, model: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: { ok: boolean; stdout: string; stderr: string }): void => { if (!settled) { settled = true; resolve(v); } };
    let stdout = '';
    let stderr = '';
    // 한 줄 프롬프트 — userPrompt 도 newline 제거해서 안전하게.
    const safeUserPrompt = userPrompt.replace(/[\r\n]+/g, ' ').slice(0, 500);
    const promptArg = `Read REQUEST.md and element.json in this cwd, then use the Edit tool exactly once on element.json to apply this user request: "${safeUserPrompt}". Follow REQUEST.md rules. Reply DONE.`;
    const args = [
      '-p',
      '--tools', 'Read,Edit',
      '--permission-mode', 'acceptEdits',
      '--model', model,
      promptArg,
    ];
    const child = spawn(CLAUDE_BIN_PATH, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: tmpdir,
    });
    const timer = setTimeout(() => {
      logger.warn(`contiManager.patch: timeout (model=${model}), killing claude`);
      try { child.kill(); } catch { /* ignore */ }
      settle({ ok: false, stdout, stderr });
    }, TIMEOUT_MS);
    child.stdout?.on('data', (buf: Buffer) => { stdout += buf.toString('utf8'); });
    child.stderr?.on('data', (buf: Buffer) => { stderr += buf.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      logger.warn(`contiManager.patch: spawn error (model=${model}): ${err.message}`);
      settle({ ok: false, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.warn(`contiManager.patch: exit code=${code} (model=${model}), stderr=${stderr.slice(0, 300)}, stdout=${stdout.slice(0, 200)}`);
        settle({ ok: false, stdout, stderr });
        return;
      }
      settle({ ok: true, stdout, stderr });
    });
  });
}

/**
 * §5.3 #28 v1.62 — 단일 element 패치 (harness sub-agent 방식).
 *   - tmpdir 격리 + Read/Edit 만 허용 + 부모 세션 미부착 → 결정성/속도/안전성.
 *   - 결과: 교체될 element 1개 (id 는 기존 유지). 실패 시 null.
 */
export async function patchContiElement(
  current: ContiElement,
  userPrompt: string,
  frameContext?: { title: string; action: string },
): Promise<ContiElement | null> {
  const tmpdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vibisual-conti-patch-'));
  try {
    const elementPath = path.join(tmpdir, 'element.json');
    const requestPath = path.join(tmpdir, 'REQUEST.md');
    const ctxNote = frameContext
      ? `\n## Frame context (for understanding only — do NOT write into the element)\n\n- Frame title: ${frameContext.title}\n- Frame action: ${frameContext.action}\n`
      : '';
    await fsp.writeFile(elementPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    await fsp.writeFile(requestPath, PATCH_REQUEST_RULES + ctxNote, 'utf8');
    logger.info(`contiManager.patch: tmpdir=${tmpdir} elementId=${current.id} prompt="${userPrompt.slice(0, 80)}"`);

    for (const model of [CONTI_DEFAULTS.primaryModel, CONTI_DEFAULTS.fallbackModel]) {
      const result = await runPatchAgent(tmpdir, userPrompt, model);
      logger.info(`contiManager.patch: model=${model} exit-ok=${result.ok} stdout="${result.stdout.slice(0, 200).replace(/\n/g, '\\n')}"`);
      if (!result.ok) continue;
      // sub-agent 가 element.json 을 직접 Edit 했어야 함. 다시 읽어서 검증.
      let raw: string;
      try {
        raw = await fsp.readFile(elementPath, 'utf8');
      } catch (e) {
        logger.warn(`contiManager.patch: read-back failed (model=${model}): ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 일부 모델은 element.json 에 잡문/코드펜스를 같이 적기도 함 → 한 번 더 시도.
        parsed = extractJson(raw);
      }
      if (!parsed || typeof parsed !== 'object') {
        logger.warn(`contiManager.patch: unparseable element.json (model=${model}): ${raw.slice(0, 200)}`);
        continue;
      }
      const next = coerceElement(parsed, current.id);
      if (!next) {
        logger.warn(`contiManager.patch: coerce rejected (model=${model})`);
        continue;
      }
      next.id = current.id; // id 는 기존 유지 — 모델이 바꾸려 했어도 강제 복구.
      logger.info(`contiManager.patch: success model=${model} elementId=${current.id}`);
      return next;
    }
    return null;
  } finally {
    fsp.rm(tmpdir, { recursive: true, force: true }).catch((e: unknown) => {
      logger.warn(`contiManager.patch: tmpdir cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

/** 빈 콘티 1건 (bootstrap 용). LLM 호출 ❌ — agentConfig customMode='conti' 저장 직후. */
export function createEmptyConti(agentId: string): Conti {
  const now = Date.now();
  return {
    id: rid('conti'),
    agentId,
    createdAt: now,
    updatedAt: now,
    workId: '', // §5.3 #28 (L) v1.58 — bootstrap 은 작업이 아니므로 빈 workId. 첫 실제 응답이 들어오면 신규로 분기됨.
    title: '(empty)',
    frames: [
      {
        id: rid('frame'),
        title: 'New conti — press "새 콘티 생성"',
        action: 'Click the generate button on the panel to fill this in based on recent activity.',
        elements: [
          {
            id: rid('el'),
            type: 'rect',
            x: 32,
            y: 32,
            w: 256,
            h: 116,
            stroke: '#9ca3af',
            fill: '#f9fafb',
            strokeWidth: 2,
            dash: '6 4',
          },
          {
            id: rid('el'),
            type: 'text',
            x: 160,
            y: 96,
            label: 'placeholder',
            fill: '#9ca3af',
            fontSize: 16,
          },
        ],
      },
    ],
  };
}

/** rid 외부 노출 — index.ts 에서 신규 frame/element 만들 때 같은 prefix 컨벤션 유지. */
export const contiId = {
  conti: () => rid('conti'),
  frame: () => rid('frame'),
  element: () => rid('el'),
};

/**
 * §5.3 #28 (K) v1.48 — 콘티 모드 에이전트의 응답 텍스트를 conti 페이로드로 파싱.
 * 코드펜스/잡설을 관용적으로 무시하고 첫 `{`~마지막 `}` 슬라이스 → JSON.parse → frames 정규화.
 * 실패 시 null 반환(호출부가 무시).
 */
export function parseContiResponse(raw: string): { title?: string; frames: ContiFrame[] } | null {
  if (!raw || typeof raw !== 'string') return null;
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const framesArr = Array.isArray(obj['frames']) ? obj['frames'] : [];
  const frames: ContiFrame[] = [];
  for (const fr of framesArr) {
    const f = coerceFrame(fr);
    if (f) frames.push(f);
  }
  if (frames.length === 0) return null;
  const title = typeof obj['title'] === 'string' ? (obj['title'] as string).slice(0, 200) : undefined;
  return { ...(title ? { title } : {}), frames };
}
