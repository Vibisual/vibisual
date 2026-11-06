/**
 * localAssist.ts — §5.19 (J) All Model 끝까지 돕기의 순수 판정(서버·화면 공통, 부수 효과 0).
 * 이 모듈은 최상위에서 상수를 읽지 않는다 — `constants.ts` 와 서로 가져오는 사이라 함수 안에서만 쓴다.
 */
import type {
  LocalAssistOptions, LocalAssistPreset, LocalKvCacheType, LocalMoeOffload, LocalPlanItem,
  LocalTidyMethod, LocalToolOutputCap,
} from './types.js';
import {
  LOCAL_ASSIST_PRESETS,
  LOCAL_CHARS_PER_TOKEN_MAX,
  LOCAL_CHARS_PER_TOKEN_MIN,
  LOCAL_KEEP_LOADED_CHOICES,
  LOCAL_MODEL_IDLE_UNLOAD_MS,
  LOCAL_PLAN_ITEM_TEXT_MAX,
  LOCAL_RELAY_MAX_ROUNDS_LIMIT,
  LOCAL_RELAY_VERIFY_COMMAND_MAX,
  LOCAL_SAFE_CACHE_RAM_MAX_MIB,
  LOCAL_TIDY_AT_CHOICES,
} from './constants.js';

const KV_TYPES: readonly LocalKvCacheType[] = ['f16', 'q8_0', 'q4_0'];
const MOE_OFFLOADS: readonly LocalMoeOffload[] = ['auto', 'cpu'];
const TIDY_METHODS: readonly LocalTidyMethod[] = ['mask', 'summarize', 'handoff', 'ask'];
const OUTPUT_CAPS: readonly LocalToolOutputCap[] = ['short', 'normal', 'long'];
const PRESET_NAMES: readonly LocalAssistPreset[] = ['off', 'lowSpec', 'balanced', 'longTask', 'custom'];
const BOOLEAN_KEYS = ['lowSpecSafe', 'keepFullOutput', 'planFirst', 'relay', 'resume'] as const;

function pick<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** 요청 본문 `provider.assist` 좁히기. 모르는 값은 버리고, 남는 칸이 없으면 `undefined`(종전 동작). */
export function normalizeLocalAssist(value: unknown): LocalAssistOptions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: LocalAssistOptions = {};
  const preset = pick(PRESET_NAMES, raw['preset']);
  if (preset) out.preset = preset;
  const kv = pick(KV_TYPES, raw['kvCache']);
  if (kv) out.kvCache = kv;
  const moe = pick(MOE_OFFLOADS, raw['moeOffload']);
  if (moe) out.moeOffload = moe;
  const tidy = pick(TIDY_METHODS, raw['tidyMethod']);
  if (tidy) out.tidyMethod = tidy;
  const cap = pick(OUTPUT_CAPS, raw['toolOutputCap']);
  if (cap) out.toolOutputCap = cap;
  const tidyAt = raw['tidyAt'];
  if (typeof tidyAt === 'number' && (LOCAL_TIDY_AT_CHOICES as readonly number[]).includes(tidyAt)) out.tidyAt = tidyAt;
  const keep = raw['keepLoadedMinutes'];
  if (typeof keep === 'number' && (LOCAL_KEEP_LOADED_CHOICES as readonly number[]).includes(keep)) out.keepLoadedMinutes = keep;
  const rounds = raw['relayMaxRounds'];
  if (typeof rounds === 'number' && Number.isFinite(rounds) && rounds >= 1) {
    out.relayMaxRounds = Math.min(LOCAL_RELAY_MAX_ROUNDS_LIMIT, Math.floor(rounds));
  }
  const verify = raw['relayVerifyCommand'];
  if (typeof verify === 'string' && verify.trim()) out.relayVerifyCommand = verify.trim().slice(0, LOCAL_RELAY_VERIFY_COMMAND_MAX);
  // 꺼진 스위치는 싣지 않는다 — 없는 칸과 같은 뜻이라 두 표기가 갈리면 비교가 틀린다.
  for (const key of BOOLEAN_KEYS) if (raw[key] === true) out[key] = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 프리셋을 누른 결과 — 칸을 통째로 갈아 끼운다(남은 칸이 섞이면 무엇을 고른 것인지 알 수 없다). */
export function applyLocalAssistPreset(preset: Exclude<LocalAssistPreset, 'custom'>): LocalAssistOptions {
  return preset === 'off' ? {} : { ...LOCAL_ASSIST_PRESETS[preset], preset };
}

/** 칸 하나를 바꾼 결과. 프리셋 이름은 `custom` 으로 내려가고, 꺼진·빈 칸은 걷는다. */
export function patchLocalAssist(
  current: LocalAssistOptions | undefined,
  patch: Partial<LocalAssistOptions>,
): LocalAssistOptions {
  const merged: Record<string, unknown> = { ...(current ?? {}), ...patch, preset: 'custom' };
  return normalizeLocalAssist(merged) ?? {};
}

/** 하나라도 종전 동작과 다르게 켜져 있는가(활동바 점등). 프리셋 이름만으로는 켜진 것이 아니다. */
export function isLocalAssistActive(a: LocalAssistOptions | undefined): boolean {
  if (!a) return false;
  return (a.kvCache !== undefined && a.kvCache !== 'f16')
    || a.moeOffload === 'cpu'
    || a.lowSpecSafe === true
    || (a.tidyAt ?? 0) > 0
    || (a.toolOutputCap !== undefined && a.toolOutputCap !== 'normal')
    || a.keepFullOutput === true
    || a.planFirst === true
    || a.relay === true
    || a.resume === true
    || (a.keepLoadedMinutes !== undefined && a.keepLoadedMinutes * 60_000 !== LOCAL_MODEL_IDLE_UNLOAD_MS);
}

/** 엔진 인자 한 묶음. 묶음 단위로 함께 빠진다(KV 양자화와 `-fa on` 은 짝이다). */
export interface LocalEngineArgGroup {
  id: string;
  args: string[];
}

/** 이 PC 의 사실 — 서버가 `os` 에서 읽어 넘긴다(함수는 OS 를 직접 묻지 않는다). */
export interface LocalHostFacts {
  totalRamBytes: number;
  logicalCpus: number;
}

/** §5.19 (J) ② 엔진 묶음 — 옵션이 비면 빈 배열(종전 인자 그대로). */
export function localAssistEngineArgs(a: LocalAssistOptions | undefined, host: LocalHostFacts): LocalEngineArgGroup[] {
  const out: LocalEngineArgGroup[] = [];
  if (!a) return out;
  if (a.kvCache && a.kvCache !== 'f16') {
    out.push({ id: 'kv-cache', args: ['-ctk', a.kvCache, '-ctv', a.kvCache, '-fa', 'on'] });
  }
  if (a.moeOffload === 'cpu') out.push({ id: 'cpu-moe', args: ['--cpu-moe'] });
  if (a.lowSpecSafe) {
    const sixteenthMib = Math.floor(host.totalRamBytes / 16 / (1024 * 1024));
    const mib = Math.max(0, Math.min(LOCAL_SAFE_CACHE_RAM_MAX_MIB, sixteenthMib));
    out.push({ id: 'cache-ram', args: ['--cache-ram', String(mib)] });
    out.push({ id: 'threads', args: ['-t', String(Math.max(1, Math.floor(host.logicalCpus / 2)))] });
    out.push({ id: 'prio', args: ['--prio', '-1'] });
  }
  return out;
}

/** 같은 모델이라도 이 값이 다르면 엔진을 다시 띄운다(뜬 뒤에는 바꿀 수 없는 인자들). */
export function localAssistEngineProfile(a: LocalAssistOptions | undefined, slotSave: boolean): string {
  return [
    `kv=${a?.kvCache ?? 'f16'}`,
    `moe=${a?.moeOffload ?? 'auto'}`,
    `safe=${a?.lowSpecSafe ? 1 : 0}`,
    `slots=${slotSave ? 1 : 0}`,
  ].join(';');
}

/** 유휴 해제까지(ms). */
export function localAssistIdleMs(a: LocalAssistOptions | undefined): number {
  return a?.keepLoadedMinutes ? a.keepLoadedMinutes * 60_000 : LOCAL_MODEL_IDLE_UNLOAD_MS;
}

/** 직전 왕복이 보낸 글자 수와 엔진이 센 토큰 수로 잰 글자/토큰 비. 셀 수 없으면 `null`. */
export function calibrateCharsPerToken(promptChars: number, promptTokens: number): number | null {
  if (!(promptChars > 0) || !(promptTokens > 0)) return null;
  return Math.min(LOCAL_CHARS_PER_TOKEN_MAX, Math.max(LOCAL_CHARS_PER_TOKEN_MIN, promptChars / promptTokens));
}

/** 보낼 프롬프트가 정리선을 넘었는가. `tidyAt` 이 없거나 0 이면 늘 아니다. */
export function shouldTidyContext(estimatedPromptTokens: number, contextSize: number, tidyAt: number | undefined): boolean {
  if (!tidyAt || tidyAt <= 0 || contextSize <= 0) return false;
  return estimatedPromptTokens >= Math.floor((contextSize * tidyAt) / 100);
}

/** 대화 한 줄 중 정리가 읽는 칸만(서버의 엔진 메시지 모양과 맞는다). */
export interface TidyMessage {
  role: string;
  content: string;
  tool_calls?: readonly unknown[];
  tool_call_id?: string;
}

const MASK_HEAD = '[earlier tool output omitted to save context';
const SAVED_POINTER_RE = /\[full output saved to [^\]\n]+\]/;

/** 원문 보관 경로를 결과 끝에 적는 한 줄 — 가리기가 이 줄만은 살린다(그래야 나중에 다시 읽는다). */
export function savedOutputPointer(relativePath: string): string {
  return `[full output saved to ${relativePath} — Read it with offset/limit if you need the omitted part]`;
}

/**
 * 최근 도구 왕복 `keepRecentGroups` 개를 뺀 나머지 도구 결과를 자리표시로 바꾼 **새 배열**(입력은 그대로).
 * 한 번에 몰아서 바꾼다 — 왕복마다 하나씩 바꾸면 그때마다 앞부분이 달라져 엔진 캐시가 매번 깨진다.
 */
export function maskOldToolResults<T extends TidyMessage>(
  messages: readonly T[],
  keepRecentGroups: number,
  minChars: number,
): { messages: T[]; masked: number; freedChars: number } {
  const starts: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0) starts.push(i);
  });
  if (starts.length <= keepRecentGroups) return { messages: [...messages], masked: 0, freedChars: 0 };
  const protectFrom = starts[starts.length - Math.max(0, keepRecentGroups)] ?? messages.length;
  let masked = 0;
  let freedChars = 0;
  const out = messages.map((m, i) => {
    if (i >= protectFrom || m.role !== 'tool' || m.content.length < minChars || m.content.startsWith(MASK_HEAD)) return m;
    const pointer = SAVED_POINTER_RE.exec(m.content)?.[0];
    const content = `${MASK_HEAD} — ${String(m.content.length)} chars. Re-run the tool if you need it again.]${pointer ? `\n${pointer}` : ''}`;
    masked += 1;
    freedChars += m.content.length - content.length;
    return { ...m, content };
  });
  return { messages: out, masked, freedChars };
}

const CHECK_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X|-)\]\s+(.*\S)\s*$/;
const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+(.*\S)\s*$/;

/**
 * 마크다운 체크리스트(`- [ ]`·`- [x]`·`- [-]`)를 읽는다. 체크박스가 없는 줄은 항목이 아니다.
 * `[-]` 는 해 보고 못 한 항목 — 남은 일로 세지 않는다(세면 릴레이가 같은 항목만 붙잡고 헛돈다).
 */
export function parseChecklist(markdown: string): LocalPlanItem[] {
  const items: LocalPlanItem[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = CHECK_LINE_RE.exec(line);
    if (!m || !m[2]) continue;
    const item: LocalPlanItem = { text: m[2].slice(0, LOCAL_PLAN_ITEM_TEXT_MAX), done: m[1] !== ' ' };
    if (m[1] === '-') item.skipped = true;
    items.push(item);
  }
  return items;
}

/** 파일을 쓰지 않고 답에 목록을 쓴 작은 모델의 계획을 건진다 — 체크박스가 먼저, 없으면 두 줄 이상의 번호 목록. */
export function extractPlanItemsFromAnswer(text: string): string[] {
  const boxes = parseChecklist(text).map((i) => i.text);
  if (boxes.length > 0) return boxes;
  const numbered: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = NUMBERED_LINE_RE.exec(line);
    if (m && m[1]) numbered.push(m[1].slice(0, LOCAL_PLAN_ITEM_TEXT_MAX));
  }
  return numbered.length >= 2 ? numbered : [];
}

/** 계획 파일 본문. */
export function renderChecklist(title: string, items: readonly string[]): string {
  return [`# ${title}`, '', ...items.map((t) => `- [ ] ${t}`), ''].join('\n');
}

/** 계획 먼저 — 시스템 프롬프트 끝(가변부)에 붙는 지시. 모델이 읽는 글이라 영문. */
export function planFirstInstruction(planFile: string): string {
  return [
    'PLAN-FIRST MODE is on for this session.',
    `Before changing anything, write a checklist for the user's request to \`${planFile}\` using this exact format, one line per step:`,
    '- [ ] <one concrete action> — done when: <how to check it>',
    'Keep each step small enough to finish and verify on its own. You may read files to plan.',
    'Do not edit other files or run shell commands yet: changes start only after the user approves the plan.',
    'When the checklist is written, reply with a short summary of the plan and stop.',
  ].join('\n');
}

/** 릴레이 없이 승인했을 때 한 번 보내는 본문 — 끝까지 못 가면 다음 메시지가 파일에서 잇는다. */
export function executePlanCommand(planFile: string, verifyCommand?: string): string {
  const verify = verifyCommand?.trim() ? ` and run \`${verifyCommand.trim()}\` before checking an item off` : '';
  return [
    `The user approved the plan in \`${planFile}\`. Carry it out now, step by step.`,
    `For each line that is still \`- [ ]\`: do it, verify it${verify}, then change it to \`- [x]\` with a short note under it.`,
    'If you cannot finish everything in this turn, stop after the current step — the next message continues from the file.',
  ].join('\n');
}

/** 릴레이 회차 본문 — 회차마다 대화가 비워지므로(`/clear`) 이 글과 계획 파일이 기억의 전부다. */
export function relayRoundCommand(planFile: string, verifyCommand?: string): string {
  const verify = verifyCommand?.trim()
    ? `After the change, run \`${verifyCommand.trim()}\` and only mark the item done if it passes.`
    : 'After the change, verify it with the check written on that line (run it if it is a command).';
  return [
    `Continue the approved plan in \`${planFile}\`.`,
    'Read that file first. Take the first line that is still `- [ ]`, do only that one item, and nothing else.',
    verify,
    'Then edit the plan file: change that line to `- [x]` and add a short note under it (what changed, how it was checked).',
    'If the item cannot be done after a real attempt, change it to `- [-]`, write the reason under it, and stop.',
  ].join('\n');
}
