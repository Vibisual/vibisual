/**
 * Hook bridge (pure Node.js, no deps): stdin JSON → POST /api/hook-event → stdout. Stop 이면 대기열 다음 명령을 claude --resume 으로 실행.
 * §5.3 #12-1 — PreToolUse 는 /api/permission-check 로 동기 홀드(ask 면 최대 60s). 타임아웃·불통은 allow — 관할 밖 세션을 깨지 않게.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The packaged helper may run inside Electron's Node runtime. Its resumed Claude
// or user status-line child must not inherit Electron's helper-only launch mode.
delete process.env['ELECTRON_RUN_AS_NODE'];

// §3.6 — the installer writes --server <url> into settings.json; fallback VIBISUAL_SERVER_URL, then http://127.0.0.1:4800.
// No git-marker discovery (dev-only) — this file stays self-contained.
function readArg(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return null;
}

const BASE = (readArg('--server') ?? process.env['VIBISUAL_SERVER_URL'] ?? 'http://127.0.0.1:4800').replace(/\/+$/, '');
const SERVER_URL = `${BASE}/api/hook-event`;
const COMMANDS_URL = `${BASE}/api/commands`;
const PERMISSION_CHECK_URL = `${BASE}/api/permission-check`;
const ASK_USER_QUESTION_URL = `${BASE}/api/ask-user-question`;
// §4 — 플랜 한도 사용률의 유일한 공식 경로가 statusLine stdin JSON 이라 `--statusline` 이면 그 값만 푸시한다.
const RATE_LIMITS_URL = `${BASE}/api/rate-limits`;
// §4 — 서브에이전트 행 수집기의 토큰 사용량. BASE 에서 조립한다 — `SERVER_URL` 에 붙이면 `/api/hook-event/api/…` 가 돼 전부 404.
const SUBAGENT_STATUSLINE_URL = `${BASE}/api/subagent-statusline`;

// Per-launch token from the installer (--token <hex>). Missing (stale settings.json) → no header → 401 until an app restart rewrites it.
const TOKEN = readArg('--token');

/** §3.6 · §5.10 — 폐기된 기억 카드 주입 모드. 옛 설치문이 아직 부르므로 조용히 끝낸다 — 일반 처리하면 `PostToolUse` 가 두 번 추적돼 편집 이력이 두 벌 쌓인다. */
const BRAIN_NOTES_ONLY = process.argv.includes('--brain-notes-only');
function hookHeaders(extra) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (TOKEN) h['x-vibisual-hook-token'] = TOKEN;
  return h;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

/** 대기열에서 1번 명령 꺼내기 */
async function popCommand(sessionId) {
  try {
    const res = await fetch(`${COMMANDS_URL}/${sessionId}/pop`, { method: 'POST', headers: hookHeaders({}) });
    const data = await res.json();
    return data.command ?? null;
  } catch {
    return null;
  }
}

/** claude --resume으로 명령 실행 */
function executeCommand(sessionId, text) {
  const child = spawn('claude', ['--resume', sessionId, '-p', text], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * §5.3 #12-1 — `deny` → deny + reason · 관할 외 `allow`(not-managed/view-only) → `{continue:true}` · 관할 안 `allow` → 명시적 allow
 * (`claude -p` 의 default 모드는 ask 도구를 자동 deny 해 `{continue:true}` 면 막힌다) · `ask`(§5.3 #12-3 자물쇠 · 관할 외 세션) → ask + reason(그 CLI 의 승인 창).
 * allow 의 reason 은 비운다(무엇을 눌렀는지는 클라가 `permission_resolved` 로 그린다). 불통·에러 → `{continue:true}`.
 */

/**
 * 서버가 자동 통과시킨 (= Vibisual 관할 외) reason 집합. 이 경우엔 훅이 override 하지 않는다.
 * `codex-app-hook` — §5.25 (H) 코덱스 버블의 권한은 앱이 턴마다 싣는 훅이 따로 판정한다(전역 코덱스 훅은 비켜 선다).
 */
const SERVER_PASSTHROUGH_REASONS = new Set(['not-managed', 'view-only-agent', 'codex-app-hook']);

/**
 * §5.3 #12-4 — 서버 무응답 때의 안전망(정본 분류는 shared `verificationPolicy.ts`, 여기는 흔한 실행기·브라우저 MCP 만).
 * 우리 세션(`VIBISUAL_SUBAGENT_ID`·`VIBISUAL_OWNER_TERM_ID`)에서만 검증으로 보이면 거부한다(fail-closed) — 그 밖은 막지 않는다.
 * (J) 차단 스위치(기본 끔)는 저장된 옵션부터 읽는다 — 스폰 표식만 보면 끈 뒤에도 옛 CMD 세션이 거부한다. 못 읽을 때만 `VIBISUAL_VERIFICATION_GATE=1`.
 */
const OWNED_SESSION = Boolean(process.env.VIBISUAL_SUBAGENT_ID || process.env.VIBISUAL_OWNER_TERM_ID);
const USER_DEFAULTS_FILE = path.join(os.homedir(), '.vibisual', 'user-defaults.json');
const VERIFICATION_FALLBACK_COMMAND = /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t|lint|typecheck|type-check|check|e2e|build|verify)\b|(?:npx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)\s+(?:vitest|jest|mocha|playwright|cypress|tsc|eslint)\b|vitest\b|jest\b|mocha\b|pytest\b|playwright\s+test\b|cypress\s+(?:run|open)\b|tsc\b|eslint\b|cargo\s+(?:test|build|check|clippy)\b|go\s+(?:test|build|vet)\b|dotnet\s+(?:test|build)\b|make\s+(?:test|check|lint|build)\b)/i;
const VERIFICATION_FALLBACK_MCP_SERVER = /playwright|puppeteer|chrome[-_]?devtools|browser|claude[-_]?in[-_]?chrome|computer[-_]?use|vibisual_verify/i;

function looksLikeVerification(toolName, toolInput) {
  if (typeof toolName !== 'string') return false;
  const mcp = /^mcp__(.+?)__/.exec(toolName);
  if (mcp) return VERIFICATION_FALLBACK_MCP_SERVER.test(mcp[1]);
  const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
  return command !== '' && VERIFICATION_FALLBACK_COMMAND.test(command);
}

/** 서버 저장소와 같은 파일을 읽어, 세션을 다시 띄우지 않아도 사용자가 저장한 켬/끔을 따른다. */
function verificationGateEnabled() {
  try {
    const defaults = JSON.parse(fs.readFileSync(USER_DEFAULTS_FILE, 'utf8'));
    return defaults?.permissions?.verificationGate === true;
  } catch (error) {
    // 파일 자체가 없으면 미설정(기본 끔)이다. 접근·파싱 오류만 기존 스폰 표식으로 보완한다.
    if (error?.code === 'ENOENT') return false;
    return process.env.VIBISUAL_VERIFICATION_GATE === '1';
  }
}

/** 권한 문의가 답을 못 받았을 때의 답 — 우리 세션의 검증처럼 보이면 거부, 아니면 종전대로 통과. */
function unconfirmedAnswer(payload) {
  if (OWNED_SESSION && looksLikeVerification(payload.tool_name, payload.tool_input) && verificationGateEnabled()) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'VIBISUAL VERIFICATION POLICY: BLOCKED before it ran. Vibisual could not confirm the verification permission for this task (the app did not answer), so verification does not run (safe default). Do not retry it, do not run it another way (another command, a script, another tool or a sub-agent), and do not ask the user for permission. Finish the requested work, then say in your report which verification was not run.',
      },
    };
  }
  return { continue: true };
}

/**
 * §5.3 #12-2 — `claude -p` 는 tool_result 회신 채널이 없어 deny 하고, 고른 답을 `permissionDecisionReason` 으로 모델에 전한다.
 * `answer`·`timeout` → deny + reason · `reject`(view-only / not-managed / invalid-input)·불통·에러 → {continue:true}.
 */
async function checkAskUserQuestion(payload) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 65_000);
    // 실패 경로에서도 타이머를 걷는다 — 남으면 답을 낸 뒤에도 프로세스가 65초를 더 살고, CLI 는 훅 프로세스가
    //   끝나야 넘어가므로 앱이 꺼진 동안 모든 세션의 호출이 그만큼 멈춘다(2026-10-15 실측).
    const res = await fetch(ASK_USER_QUESTION_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({
        sessionId: payload.session_id,
        subAgentId: process.env.VIBISUAL_SUBAGENT_ID,
        parentAgentId: process.env.VIBISUAL_PARENT_AGENT_ID,
        toolInput: payload.tool_input ?? {},
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(tid));
    if (!res.ok) return { continue: true };
    const data = await res.json().catch(() => null);
    if (!data) return { continue: true };

    if (data.decision === 'answer') {
      const answers = Array.isArray(data.answers) ? data.answers : [];
      const lines = answers.map((a, i) => {
        const q = typeof a?.question === 'string' ? a.question : `Question ${i + 1}`;
        const labels = Array.isArray(a?.selectedLabels) ? a.selectedLabels : [];
        const labelStr = labels.map((l) => `"${String(l).replace(/"/g, '\\"')}"`).join(', ') || '(no selection)';
        const notePart = typeof a?.note === 'string' && a.note ? ` (note: ${a.note})` : '';
        return `Q${i + 1} "${q}": ${labelStr}${notePart}`;
      });
      const body = lines.length > 0 ? lines.join('\n') : '(no answers)';
      const reason = `USER ANSWERED via Vibisual:\n${body}\n\nTreat these as the user's answers to your AskUserQuestion call. The tool itself was intercepted and did NOT execute — do not retry it. Continue based on these answers.`;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    }

    if (data.decision === 'timeout') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'USER DID NOT ANSWER your AskUserQuestion within 60s in the Vibisual IDE card. Proceed with your best judgment or ask the user differently. Do not retry AskUserQuestion immediately.',
        },
      };
    }

    // reject (not-managed / view-only / invalid-input) → CC 기본 처리 위임
    return { continue: true };
  } catch {
    return { continue: true };
  }
}

async function checkPermission(payload) {
  try {
    const controller = new AbortController();
    // 서버 타임아웃(60s)보다 길게 — safe-deny 가 먼저 나게. 실패 경로에서도 걷는다(`.finally`) — 남으면 훅이 65초 살아
    // 모든 세션의 도구 호출이 그만큼 멈춘다(2026-10-15 실측 68.9초).
    const tid = setTimeout(() => controller.abort(), 65_000);
    const res = await fetch(PERMISSION_CHECK_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({
        sessionId: payload.session_id,
        subAgentId: process.env.VIBISUAL_SUBAGENT_ID,
        parentAgentId: process.env.VIBISUAL_PARENT_AGENT_ID,
        toolName: payload.tool_name,
        toolInput: payload.tool_input ?? {},
        cwd: payload.cwd,
        // §5.3 #12-3 — 코덱스 훅에만 있는 필드. 전역 코덱스 훅이 이 핸들러를 부를 때 서버가 엔진을 가른다
        //   (코덱스는 `ask` 를 지원하지 않아 자물쇠를 거부로 답해야 한다).
        ...(typeof payload.turn_id === 'string' && payload.turn_id ? { turnId: payload.turn_id } : {}),
        // §5.3 #12-4 — 우리 CMD 터미널에서 뜬 CLI 만 터미널 id 를 갖는다. 서버가 그 턴의 검증 범위로 판정한다.
        ...(process.env.VIBISUAL_OWNER_AGENT_ID ? { ownerAgentId: process.env.VIBISUAL_OWNER_AGENT_ID } : {}),
        ...(process.env.VIBISUAL_OWNER_TERM_ID ? { ownerTermId: process.env.VIBISUAL_OWNER_TERM_ID } : {}),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(tid));
    // §5.3 #12-4 — 답을 못 받으면 우리 세션의 검증은 거부한다(그 밖은 종전대로 통과).
    if (!res.ok) return unconfirmedAnswer(payload);
    const data = await res.json().catch(() => null);
    if (!data) return unconfirmedAnswer(payload);

    // §5.3 #12-3 — 자물쇠에 닿은 관할 밖 세션. 우리 팝업 대신 **그 CLI 자신의 승인 창**을 띄운다
    //   (bypassPermissions 에서도 뜬다 — 2.1.291 실측). 답할 사람이 없는 `-p` 실행이면 CLI 가 거부하고
    //   모델이 이 사유를 읽는다.
    if (data.decision === 'ask') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: typeof data.message === 'string' && data.message
            ? data.message
            : 'Vibisual lock: this path is locked by the user, so this access needs their approval.',
        },
      };
    }

    if (data.decision === 'deny') {
      const reason = data.reason === 'timeout'
        ? 'USER PERMISSION DECISION: DENY (auto). No response within 60s in the Vibisual approval popup, so it was auto-denied (safe default). This tool was blocked and NOT executed. Tell the user verbatim that their permission decision was recorded as "DENY (timed out, no response)", then stop and ask how they want to proceed.'
        // §4 (CLI 사양 추종) — permissionMode='dontAsk' 정책 거부. 팝업은 뜨지도 않았으므로
        //   "사용자가 Deny 를 눌렀다"고 말하면 거짓이 된다 — 정책 때문임을 그대로 알린다.
        : data.reason === 'dont-ask'
        ? 'PERMISSION POLICY: DENY. This agent runs in permission mode "dontAsk" (do not prompt; deny anything not pre-approved), so the tool was blocked WITHOUT asking the user. No one pressed anything. Tell the user which tool was blocked and that the agent\'s permission mode must be changed (or the command pre-approved) to run it. Do not retry the same tool.'
        // §5.3 #12-1-B — 카드가 답을 받기 전에 닫혔다(에이전트 중지 등). 아무도 누르지 않았다.
        : data.reason === 'cancelled'
        ? 'PERMISSION REQUEST CANCELLED. The Vibisual approval popup was closed before anyone answered (the agent was stopped), so this tool was NOT executed. No one pressed Allow or Deny. Do not retry the tool; stop and wait for the user\'s next instruction.'
        // §5.3 #12-1-B — 이 에이전트의 금지 목록(disallowedTools)에 있는 도구. 팝업은 뜨지 않았다.
        : data.reason === 'disallowed'
        ? 'PERMISSION POLICY: DENY. This tool is on this agent\'s disallowed-tools list in Vibisual, so it was blocked WITHOUT asking the user. Do not retry this tool; use a different approach, or tell the user it must be removed from the disallowed list in the agent settings.'
        // §5.3 #12-3 — 자물쇠 거부(묻지 않는 모드 · ask 를 못 쓰는 엔진). 어느 경로가 잠겼는지는 서버가 문구에 싣는다.
        : data.reason === 'locked'
        ? (typeof data.message === 'string' && data.message
          ? data.message
          : 'Vibisual lock: this path is locked by the user, so this tool was blocked and NOT executed. Ask the user to unlock it in Vibisual if access is needed. Do not retry it or work around it with another command.')
        // §5.3 #12-4 — 검증 정책 거부. 무엇으로 읽혔는지·우회하지 말라는 문구는 서버가 짓는다. 아무도 누르지 않았다.
        : data.reason === 'verification'
        ? (typeof data.message === 'string' && data.message
          ? data.message
          : 'VIBISUAL VERIFICATION POLICY: BLOCKED before it ran. The user did not ask for verification in this task. Do not retry it, do not run it another way, and do not ask the user for permission. Finish the requested work, then say which verification was not run.')
        : `USER PERMISSION DECISION: DENY. The user pressed "Deny" in the Vibisual approval popup. This tool was blocked and NOT executed.${data.reason ? ` User note: ${data.reason}.` : ''} In your reply, state this explicitly to the user — e.g. 'You selected: Deny — the command was not run.' Do not retry the tool unless the user explicitly asks.`;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    }

    if (data.decision === 'allow') {
      // 관할 외 — CC 기본 정책에 위임 (메인 Claude Code 세션을 우리가 가로채면 안 됨).
      if (SERVER_PASSTHROUGH_REASONS.has(data.reason)) {
        return { continue: true };
      }
      // 관할 안 — print 모드 default 가 자동 deny 로 떨어지지 않도록 명시적 allow.
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      };
    }

    // 알 수 없는 decision — 보수적으로 continue(§5.3 #12-4 — 우리 세션의 검증만은 거부).
    return unconfirmedAnswer(payload);
  } catch {
    return unconfirmedAnswer(payload);
  }
}

/**
 * §4 — statusLine 모드: CLI 가 렌더마다(최대 300ms) 세션 JSON 을 주고 그 `rate_limits` 가 한도 사용률의 유일한 공식 경로다.
 * 값이 바뀌었거나 최소 간격이 지났을 때만 푸시한다. 상태줄은 보관된 사용자 원래 명령이 있으면 같은 stdin 으로 passthrough.
 * 어떤 실패도 CLI 를 막지 않는다 — 늘 한 줄 내고 끝낸다.
 */
const STATUSLINE_STATE_FILE = path.join(os.homedir(), '.vibisual', 'statusline-state.json');
const STATUSLINE_MIN_POST_INTERVAL_MS = 20_000;

/** 마지막 전송 값·시각. 초당 3회 POST → 전체 스냅샷 브로드캐스트 폭주를 막는 스로틀. */
function readStatusLineState() {
  try {
    return JSON.parse(fs.readFileSync(STATUSLINE_STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeStatusLineState(state) {
  try {
    fs.mkdirSync(path.dirname(STATUSLINE_STATE_FILE), { recursive: true });
    fs.writeFileSync(STATUSLINE_STATE_FILE, JSON.stringify(state), 'utf-8');
  } catch {
    // 상태 파일은 최적화용 — 못 써도 동작엔 지장 없다(매번 전송될 뿐).
  }
}

/**
 * 보관된 "사용자 원본"이 실은 우리 명령인가 — CLI 가 settings.json 을 다시 쓰면 `_vibisualManaged` 가 사라져 우리 명령이 원본으로 보관될 수 있고,
 * 그러면 자기 자신을 passthrough 하는 무한 사슬(상태줄 멈춤·프로세스 누적)이 된다.
 */
function isOwnStatusLineCommand(command) {
  if (typeof command !== 'string') return false;
  if (!command.includes('handler.mjs')) return false;
  // 인스톨러가 조립하는 모양이 `node "…handler.mjs" --statusline …` 이라 앞 공백까지 함께 본다.
  return command.includes(' --statusline') || command.includes(' --subagent-statusline');
}

/** `~/.claude/settings.json` 에 보관된 사용자 원래 statusLine 명령 (설치 시 인스톨러가 저장). */
function readPassthroughCommand() {
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const prev = parsed?.statusLine?._vibisualPrevStatusLine;
    if (typeof prev?.command !== 'string' || !prev.command) return null;
    if (isOwnStatusLineCommand(prev.command)) return null; // 자기 자신 재귀 차단
    return prev.command;
  } catch {
    return null;
  }
}

/** 보관된 사용자 명령을 같은 stdin 으로 실행하고 stdout 을 그대로 돌려준다. */
function runPassthrough(command, input) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let out = '';
      const done = (v) => resolve(v);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } done(null); }, 2000);
      child.stdout.on('data', (c) => { out += c.toString('utf-8'); });
      child.on('error', () => { clearTimeout(timer); done(null); });
      child.on('close', () => { clearTimeout(timer); done(out.replace(/\n+$/, '')); });
      child.stdin.on('error', () => { /* 자식이 stdin 을 안 읽고 끝낼 수 있다 */ });
      child.stdin.end(input);
    } catch {
      resolve(null);
    }
  });
}

/** passthrough 가 없을 때 쓰는 기본 상태줄. 이모지 ❌ — 터미널 폭·폰트 흔들림 방지. */
function buildDefaultStatusLine(payload, five, seven) {
  const parts = [];
  const model = payload?.model?.display_name;
  if (typeof model === 'string' && model) parts.push(model);
  const dir = payload?.workspace?.current_dir;
  if (typeof dir === 'string' && dir) parts.push(path.basename(dir));
  const ctx = payload?.context_window?.used_percentage;
  if (typeof ctx === 'number') parts.push(`ctx ${Math.round(ctx)}%`);
  if (typeof five === 'number') parts.push(`5h ${Math.round(five)}%`);
  if (typeof seven === 'number') parts.push(`7d ${Math.round(seven)}%`);
  return parts.join('  ·  ');
}

async function runStatusLine(input) {
  let payload = null;
  try {
    payload = JSON.parse(input);
  } catch {
    payload = null;
  }

  const rl = payload?.rate_limits ?? null;
  const five = typeof rl?.five_hour?.used_percentage === 'number' ? rl.five_hour.used_percentage : undefined;
  const seven = typeof rl?.seven_day?.used_percentage === 'number' ? rl.seven_day.used_percentage : undefined;
  // resets_at 은 epoch **초** — Vibisual 의 RateLimitInfo.resetAt* 는 epoch ms 라 여기서 환산.
  const fiveReset = typeof rl?.five_hour?.resets_at === 'number' ? rl.five_hour.resets_at * 1000 : undefined;
  const sevenReset = typeof rl?.seven_day?.resets_at === 'number' ? rl.seven_day.resets_at * 1000 : undefined;

  // 먼저 화면부터 채운다 — 서버가 죽어 있어도 상태줄은 정상 동작해야 한다.
  const passthrough = readPassthroughCommand();
  const line = passthrough
    ? (await runPassthrough(passthrough, input)) ?? buildDefaultStatusLine(payload, five, seven)
    : buildDefaultStatusLine(payload, five, seven);
  process.stdout.write(line + '\n');

  if (five === undefined && seven === undefined) return; // Pro/Max 구독이 아니거나 첫 응답 전

  const prev = readStatusLineState();
  const changed = !prev || prev.five !== five || prev.seven !== seven;
  const stale = !prev || Date.now() - (prev.at ?? 0) >= STATUSLINE_MIN_POST_INTERVAL_MS;
  if (!changed && !stale) return;

  const body = {};
  if (five !== undefined) body.used5h = five;
  if (seven !== undefined) body.used7d = seven;
  if (fiveReset !== undefined) body.resetAt5h = fiveReset;
  if (sevenReset !== undefined) body.resetAt7d = sevenReset;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 500);
    const res = await fetch(RATE_LIMITS_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => null).finally(() => clearTimeout(tid));
    // 실제로 도달했을 때만 스로틀 상태를 기록한다. 앱이 꺼져 있던 동안의 실패를
    // "보냈다" 로 남기면 앱을 켠 뒤 최대 20초간 값이 비어 보인다.
    if (res && res.ok) writeStatusLineState({ five, seven, at: Date.now() });
  } catch {
    // 앱이 꺼져 있으면 조용히 통과 — 다음 렌더에서 다시 시도한다.
  }
}

/**
 * §4 — `subagentStatusLine`: 틱마다 서브에이전트 행(`tasks[]`)을 서버로 넘긴다(실시간 토큰 사용량의 유일한 경로).
 * stdout 에 쓰지 않는다 — 쓰면 그 행의 렌더를 우리가 가져간다.
 */
async function runSubagentStatusLine(input) {
  if (!input) return;
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : null;
  if (!tasks || tasks.length === 0) return;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    await fetch(SUBAGENT_STATUSLINE_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({ sessionId: payload.session_id, cwd: payload.cwd, tasks }),
      signal: controller.signal,
    }).catch(() => null).finally(() => clearTimeout(tid));
  } catch {
    // 앱이 꺼져 있으면 조용히 통과 — 다음 틱에서 다시 시도한다.
  }
}

async function main() {
  // §4 — 사용량 probe(`claude -p "/usage"`)가 띄운 세션의 훅은 **즉시 빠져나간다.**
  // 그 실행은 사용량을 재려고 서버가 5분마다 도는 계측이라, 캔버스에 버블·활동으로 남으면
  // 사용자가 자기 화면에서 유령 세션을 보게 된다. 서버가 그 세션에만 이 표시를 실어 보낸다.
  if (process.env['VIBISUAL_USAGE_PROBE'] === '1') return;

  const input = await readStdin();

  // §4 — statusLine 모드는 훅 이벤트가 아니라 세션 JSON 을 받는다(별도 경로).
  if (process.argv.includes('--statusline')) {
    await runStatusLine(input);
    return;
  }

  // §4 — 서브에이전트 행 수집기. 별도 경로, stdout 을 쓰지 않는다.
  if (process.argv.includes('--subagent-statusline')) {
    await runSubagentStatusLine(input);
    return;
  }

  // stdin 비면 기본 continue
  if (input.length === 0) {
    process.stdout.write('{"continue":true}\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.stdout.write('{"continue":true}\n');
    return;
  }

  const isPreToolUse = payload.hook_event_name === 'PreToolUse';
  const isStop = payload.hook_event_name === 'Stop';
  // §5.11 — 켠 플러그인의 집행을 이 세션에 싣는 유일한 통로(`/api/hook-event` 응답의 additionalContext).
  const isUserPromptSubmit = payload.hook_event_name === 'UserPromptSubmit';

  // §4 — 우리 CMD 의 claude 는 VIBISUAL_OWNER_AGENT_ID 를 물려받아 `_vibisualOwnerAgentId` 로 그 CMD 버블에 귀속된다(별개 Hook 버블 ❌).
  // 시각 귀속 전용 — 권한 검사는 건드리지 않는다(인터랙티브 권한은 CLI 기본 정책).
  const ownerAgentId = process.env.VIBISUAL_OWNER_AGENT_ID;
  // §4 — termId 도 싣는다 — 서버가 termId 별 sessionId 를 기록해 재시작 뒤 `claude --resume` 으로 잇는다.
  const ownerTermId = process.env.VIBISUAL_OWNER_TERM_ID;
  // §5.1 #1-1 (D) — 이 이벤트를 낸 우리 sub. 서버가 소유자 태그로 세션 키를 주인 버블 것으로 바꿔 쓴 뒤에도 앱 작업
  //   귀속이 그 sub 를 잃지 않게 명시로 싣는다(HTTP 훅은 같은 값을 `x-vibisual-subagent-id` 헤더로 보낸다).
  const subAgentId = process.env.VIBISUAL_SUBAGENT_ID;
  const trackingBody = (ownerAgentId || ownerTermId || subAgentId)
    ? JSON.stringify({
        ...payload,
        ...(ownerAgentId ? { _vibisualOwnerAgentId: ownerAgentId } : {}),
        ...(ownerTermId ? { _vibisualOwnerTermId: ownerTermId } : {}),
        ...(subAgentId ? { _vibisualSubAgentId: subAgentId } : {}),
      })
    : input;

  let response;
  if (isPreToolUse) {
    if (payload.tool_name === 'AskUserQuestion') {
      response = await checkAskUserQuestion(payload);
    } else {
      // 동기 홀드 — 서버가 Vibisual 관할 + ask 모드면 사용자 승인까지 대기.
      response = await checkPermission(payload);
    }
  } else if (isUserPromptSubmit) {
    /*
     * §5.11 — 프롬프트 전에 서버에 물어 켜 둔 플러그인 집행을 그 턴에 얹는다(직접 띄운 세션에도).
     * 이 이벤트만 stdout 을 응답 뒤에 쓰므로 1초로 끊고 어떤 실패도 통과시킨다 — 서버가 꺼져도 프롬프트는 나가야 한다.
     */
    response = { continue: true };
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => null).finally(() => clearTimeout(tid));
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      const extra = data && data.hookSpecificOutput && data.hookSpecificOutput.additionalContext;
      if (typeof extra === 'string' && extra.trim() !== '') {
        response = {
          continue: true,
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: extra },
        };
      }
    } catch {
      // 서버 불통 — 종전과 똑같이 통과.
    }
    process.stdout.write(JSON.stringify(response) + '\n');
    return; // 트래킹 전송을 이미 마쳤다(위 fetch 가 그 역할을 겸한다).
  } else {    // 기존 fire-and-forget 경로 — 즉시 continue 응답.
    response = { continue: true };
  }
  // Write stdout BEFORE the tracking fetch so Claude Code unblocks immediately.
  process.stdout.write(JSON.stringify(response) + '\n');

  // §5.10 — 옛 `--brain-notes-only` 엔트리는 **한 건도 내보내지 않는다.** 같은 이벤트에
  //   붙은 HTTP 엔트리가 추적을 이미 맡고 있어, 여기서 또 보내면 편집 이력이 두 벌로 쌓인다.
  if (BRAIN_NOTES_ONLY) return;

  // 트래킹 /api/hook-event 는 모든 이벤트에 보낸다. Stop 은 fire-and-forget, Stop·PreToolUse 가 아닌 이벤트는 500ms timeout(훅마다 3s 를 더하지 않게) — 불통이면 건너뛴다.
  if (isStop) {
    if (payload.session_id) {
      const cmd = await popCommand(payload.session_id);
      if (cmd) {
        executeCommand(payload.session_id, cmd.text);
      }
    }
    // Fire and forget — do not await.
    fetch(SERVER_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: trackingBody,
    }).catch(() => {});
  } else if (!isPreToolUse) {
    // Non-PreToolUse, non-Stop: short await so the event reaches the server before exit.
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 500);
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(tid));
    } catch {
      // ignore
    }
  } else {
    // PreToolUse path: tracking fetch runs after permission decision already written.
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 500);
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(tid));
    } catch {
      // ignore
    }
  }
}

main().catch(() => {});
