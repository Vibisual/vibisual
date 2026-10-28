// 엔진 다리(SCENARIO §4) — 우리가 띄운 세션에만 `--plugin-dir` 로 실려 턴 시작·끝·사용량을 루프백 서버에 알린다.
// 1. 관찰만 — 선언 파일이 "Observe" 로 적는 사건만 쓰고 `next` 의 답을 그대로 돌려준다. 막을 수 있는 자리(`tool.call`·`tool.check`·`turn.step`·`prompt.submit`·`agent.spawn`)엔 훅 ❌ — 2.1.299 부터 그 훅이 사건을 못 넘기면 엔진이 동작을 거부한다.
// 2. 사건 훅은 상태만 적고 보내기는 타이머가 묶는다(`$.http.fetch` 엔 시간 제한이 없다 — 서버가 멎어도 턴이 막히면 안 된다).
// 3. 신원은 스폰 환경변수에서만(없으면 아무것도 안 한다), 루프백으로만 보낸다. 4. 어떤 실패도 던지지 않는다.
// 전선 모양 정본은 shared `engineBridge.ts` `parseEngineBridgeReport` — import 못 하니 함께 고친다. 엔진이 읽는 ES 모듈이라 Node API·`require`·`import()` ❌.

const WIRE_VERSION = 1;
/** 생존 신호 간격. 서버가 답에 `heartbeatMs` 를 실어 바꿀 수 있다. */
const DEFAULT_HEARTBEAT_MS = 30000;
/** 쌓인 사건을 확인하는 간격. 턴 가장자리는 이보다 빨리(KICK) 나간다. */
const FLUSH_TICK_MS = 2000;
/** 턴 끝과 사용량 측정이 거의 같은 순간에 오므로 잠깐 모아서 한 번에 보낸다. */
const KICK_DELAY_MS = 50;
/** 서버가 받지 않는 동안 쌓아 두는 사건 수 상한. */
const OUTBOX_MAX = 200;
/** 실패가 이어질 때 다시 보내기까지 기다리는 상한. */
const RETRY_MAX_MS = 60000;
/** 세션이 끝날 때 마지막 신고를 기다리는 시간 — 끝나는 자리는 예산이 짧다. */
const END_FLUSH_MS = 600;
/** 루프백만 허용한다. */
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?\//;

/** @type {import('claude-code').Register} */
export const register = (on) => {
  // 같은 키(세션 탭·터미널 칸)의 다른 프로세스가 보낸 늦은 신고를 서버가 가려내는 표식.
  const instance = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  /** @type {null | { url: string, token: string }} */
  let target = null;
  /** @type {Record<string, unknown>} */
  let identity = {};
  let heartbeatMs = DEFAULT_HEARTBEAT_MS;
  /** @type {null | { cancel: () => void }} */
  let ticker = null;

  /** @type {Array<Record<string, unknown>>} */
  let outbox = [];
  let sending = false;
  let lastSentAt = 0;
  let failures = 0;
  let retryAt = 0;
  let loggedFailure = false;

  /** @type {'running' | 'idle' | 'unknown'} */
  let turnState = 'unknown';
  let turnStartedAt = 0;
  let lastProgressAt = 0;
  /** @type {null | Record<string, unknown>} */
  let usage = null;
  let usageDirty = false;

  /** 첫 실패 한 번만 디버그 로그에 남긴다(대화창에는 아무것도 쓰지 않는다). */
  const debugLog = ($, text) => {
    try {
      $.ui.log(text, { to: 'debug' });
    } catch {
      // 로그를 못 남겨도 그만이다.
    }
  };

  const queue = (event) => {
    outbox.push({ ...event, at: Date.now() });
    if (outbox.length > OUTBOX_MAX) outbox = outbox.slice(outbox.length - OUTBOX_MAX);
  };

  /** 보내는 순간의 수준 상태 — 사건을 놓쳐도 서버가 바로잡는다. 도는 도구 수는 칸째 뺀다(`tool.call` 훅이 없어 모르는 값을 0 으로 적지 않게). */
  const snapshot = (now) => {
    const snap = { turnState };
    if (turnState === 'running' && turnStartedAt) snap.turnAgeMs = Math.max(0, now - turnStartedAt);
    if (lastProgressAt) snap.progressAgeMs = Math.max(0, now - lastProgressAt);
    return snap;
  };

  const flush = async ($, force) => {
    if (!target || sending) return;
    const now = Date.now();
    if (!force) {
      if (now < retryAt) return;
      const due = outbox.length > 0 || usageDirty || now - lastSentAt >= heartbeatMs;
      if (!due) return;
    }
    sending = true;
    const events = outbox;
    outbox = [];
    const sentUsage = usageDirty ? usage : null;
    usageDirty = false;
    let ok = false;
    try {
      const body = JSON.stringify({
        v: WIRE_VERSION,
        instance,
        identity,
        events: events.map(({ at, ...rest }) => ({ ...rest, ageMs: Math.max(0, now - Number(at)) })),
        snapshot: snapshot(now),
        ...(sentUsage ? { usage: sentUsage } : {}),
      });
      const res = await $.http.fetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vibisual-hook-token': target.token },
        body,
      });
      ok = res.ok === true;
      if (ok) {
        try {
          const reply = JSON.parse(res.text);
          const ms = reply && typeof reply.heartbeatMs === 'number' ? reply.heartbeatMs : NaN;
          if (ms >= 5000 && ms <= 300000) heartbeatMs = ms;
        } catch {
          // 답을 못 읽어도 보낸 것은 보낸 것이다.
        }
      } else if (!loggedFailure) {
        loggedFailure = true;
        debugLog($, `vibisual-bridge: report refused (HTTP ${res.status})`);
      }
    } catch (err) {
      if (!loggedFailure) {
        loggedFailure = true;
        const detail = err && err.message ? String(err.message).slice(0, 120) : 'unknown error';
        debugLog($, `vibisual-bridge: report failed (${detail})`);
      }
    } finally {
      sending = false;
    }
    if (ok) {
      lastSentAt = Date.now();
      failures = 0;
      retryAt = 0;
      return;
    }
    // 못 보낸 것은 앞에 되돌려 다음에 다시 보낸다 — 붙음(attach)이 맨 앞에 남아야 서버가 이 프로세스를 알아본다.
    outbox = [...events, ...outbox].slice(-OUTBOX_MAX);
    if (sentUsage && !usageDirty) {
      usage = sentUsage;
      usageDirty = true;
    }
    failures += 1;
    retryAt = Date.now() + Math.min(RETRY_MAX_MS, FLUSH_TICK_MS * 2 ** Math.min(failures, 5));
  };

  /** 턴 가장자리는 다음 틱을 기다리지 않고 곧 보낸다. 사건 훅은 그 보내기를 기다리지 않는다. */
  const kick = ($) => {
    if (!target) return;
    try {
      $.clock.after(KICK_DELAY_MS, () => { void flush($, false); });
    } catch {
      // 타이머를 못 걸면 다음 틱이 보낸다.
    }
  };

  /**
   * 스폰 환경에서 신원을 읽는다. `$.env.get` 의 이름은 문자열 그대로여야 한다
   * (`claude plugin validate` 가 이 모듈이 읽는 이름을 그대로 나열한다).
   */
  const readEnv = async ($) => {
    const termId = (await $.env.get('VIBISUAL_OWNER_TERM_ID')) || '';
    if (termId) {
      // CMD 터미널 — Vibisual 의 PTY 가 실어 준 이름들(헤드리스 이름이 섞여 있어도 이쪽을 믿는다).
      const port = (await $.env.get('VIBISUAL_HOOK_PORT')) || '';
      return {
        url: /^\d{1,5}$/.test(port) ? `http://127.0.0.1:${port}/api/engine-bridge` : '',
        token: (await $.env.get('VIBISUAL_HOOK_TOKEN')) || '',
        subAgentId: (await $.env.get('VIBISUAL_SUB_AGENT_ID')) || '',
        agentId: (await $.env.get('VIBISUAL_AGENT_ID')) || (await $.env.get('VIBISUAL_OWNER_AGENT_ID')) || '',
        termId,
      };
    }
    // 헤드리스 — 서버가 스폰 env 로 넣어 준 이름들.
    const base = ((await $.env.get('VIBISUAL_BASE')) || '').replace(/\/+$/, '');
    return {
      url: base ? `${base}/api/engine-bridge` : '',
      token: (await $.env.get('VIBISUAL_TOKEN')) || (await $.env.get('VIBISUAL_HOOK_AUTH')) || '',
      subAgentId: (await $.env.get('VIBISUAL_SUBAGENT_ID')) || '',
      agentId: (await $.env.get('VIBISUAL_OWNER_AGENT_ID')) || '',
      termId: '',
    };
  };

  const refreshSessionId = async ($) => {
    try {
      identity = { ...identity, sessionId: String(await $.session.id()) };
    } catch {
      // 모르면 그대로 둔다.
    }
  };

  const attach = async ($, e) => {
    const env = await readEnv($);
    if (!env.url || !env.token || !env.subAgentId || !LOOPBACK_URL.test(env.url)) return;
    target = { url: env.url, token: env.token };
    let sessionId = '';
    let cliVersion = '';
    try { sessionId = String(await $.session.id()); } catch { /* 모르면 비워 둔다 */ }
    try { cliVersion = String((await $.session.version()).version || ''); } catch { /* 모르면 비워 둔다 */ }
    identity = {
      subAgentId: env.subAgentId,
      agentId: env.agentId,
      termId: env.termId,
      sessionId,
      cliVersion,
      interactive: e.isInteractive === true,
      surface: typeof e.surface === 'string' ? e.surface : null,
    };
    // 다시 불러온 모듈은 턴 한가운데일 수 있다 — 모르는 것을 "안 돈다"로 적지 않는다.
    turnState = 'unknown';
    turnStartedAt = 0;
    lastProgressAt = Date.now();
    queue({ kind: 'attach' });
    if (ticker) ticker.cancel();
    ticker = $.clock.every(FLUSH_TICK_MS, () => { void flush($, false); });
    kick($);
  };

  on('session.start', async ($, e, next) => {
    const result = await next(e);
    try {
      await attach($, e);
    } catch {
      // 다리가 없어도 세션은 그대로 돈다.
    }
    return result;
  });

  on('turn.start', ($, e, next) => {
    const now = Date.now();
    // 서브에이전트·팀원의 턴은 이 세션의 턴 안(또는 메인 턴이 끝난 뒤 배경)에서 도는 일이다 — `turn.complete` 와
    //   같이 진척으로만 센다. 2.1.299 부터 `turn.start` 도 그 턴들을 알린다(`e.agentId` — 메인 루프는 없다).
    //   거르지 않으면 배경 턴 하나가 `running` 을 올리고 그 끝(agentId 있음)은 내리지 않아 다음 메인 턴까지 굳는다.
    if (e.agentId) {
      lastProgressAt = now;
      return next(e);
    }
    turnState = 'running';
    turnStartedAt = now;
    lastProgressAt = now;
    if (target) {
      queue({ kind: 'turn-start', turnId: String(e.turnId || '') });
      kick($);
    }
    return next(e);
  });

  on('turn.complete', ($, e, next) => {
    lastProgressAt = Date.now();
    // 서브에이전트의 턴은 이 세션의 턴 안에서 도는 일이다 — 진척으로만 센다.
    if (!e.agentId) {
      turnState = 'idle';
      turnStartedAt = 0;
      if (target) {
        queue({
          kind: 'turn-end',
          turnId: String(e.turnId || ''),
          reason: String(e.reason || ''),
          ...(typeof e.durationMs === 'number' ? { durationMs: e.durationMs } : {}),
        });
        kick($);
      }
    }
    return next(e);
  });

  // 도는 도구(`tool.call`)에는 훅을 걸지 않는다(위 1번) — 결과를 그대로 돌려주는 감지기였지만, 막을 수 있는
  //   자리라 2.1.299 부터 이 모드의 작업자가 멎으면 사용자의 도구 호출이 거부된다. 긴 빌드·검색이 "조용한 세션"으로
  //   오인되지 않게 하는 일은 서버가 대화록 마지막 쓰기로 맡는다(SCENARIO §4 엔진 다리 (D)①). 되살리지 마라.

  on('session.measure', ($, e, next) => {
    try {
      const ctx = e.context || {};
      const measured = {
        rateLimits: Array.isArray(e.rateLimits)
          ? e.rateLimits.slice(0, 10).map((r) => ({
              kind: String(r.kind || ''),
              percentUsed: Number(r.percentUsed),
              ...(typeof r.resetsAt === 'string' ? { resetsAt: r.resetsAt } : {}),
            }))
          : [],
      };
      if (typeof ctx.percent === 'number') measured.contextPercent = ctx.percent;
      if (typeof ctx.tokens === 'number') measured.contextTokens = ctx.tokens;
      if (typeof ctx.window === 'number') measured.contextWindow = ctx.window;
      if (e.cost && typeof e.cost.usd === 'number') measured.costUsd = e.cost.usd;
      usage = measured;
      usageDirty = true;
    } catch {
      // 사용량은 보조 정보다 — 못 읽으면 보내지 않는다.
    }
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    const reason = String(e.reason || '');
    if (target) {
      if (reason === 'clear' || reason === 'resume') {
        // 같은 프로세스가 다른 대화로 이어 간다 — 신호를 멈추지 않는다.
        turnState = 'idle';
        turnStartedAt = 0;
        queue({ kind: 'clear', reason });
        try {
          $.clock.after(1000, () => { void refreshSessionId($); });
        } catch {
          // 대화 id 는 다음 기회에 다시 읽는다.
        }
        kick($);
      } else {
        queue({ kind: 'end', reason });
        if (ticker) {
          ticker.cancel();
          ticker = null;
        }
        try {
          await Promise.race([flush($, true), $.clock.sleep(END_FLUSH_MS)]);
        } catch {
          // 끝나는 자리는 짧다 — 못 보내도 서버는 생존 신호가 끊긴 것으로 안다.
        }
      }
    }
    return next(e);
  });
};
