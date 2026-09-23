import { WebSocket } from 'ws';
import {
  CHAT_DISCORD_API_BASE, CHAT_DISCORD_HEARTBEAT_MISS_MAX, CHAT_DISCORD_INTENTS,
  CHAT_DISCORD_MESSAGE_MAX, CHAT_DISCORD_PAIR_COMMAND, CHAT_DISCORD_ZOMBIE_CLOSE_CODE,
  CHAT_RECONNECT_MAX_MS, CHAT_RECONNECT_MIN_MS,
} from '@vibisual/shared';
import type { ChatCard } from '@vibisual/shared';
import { chunk, escapeDiscordMarkdown, renderCard } from './cards';
import type { ChatChannel, ChatChannelContext, ChatPairLink, ChatVerifyResult } from './types';

// §4 메신저 원격제어 브리지 — 디스코드 드라이버 (판올림 번호 발급 대기)
//
// 텔레그램과 방식은 다르지만(long-poll vs Gateway WebSocket) **방향은 같다** — 우리가 나가서
// 붙는다. 그래서 이 축의 이점(포트 개방 0·인증서 0·CGNAT 무관)이 그대로 유지된다.
//
// 텔레그램과 다른 셋만 여기서 흡수한다:
//   ① DM 딥링크가 없다 → 초대 URL 을 QR 로 주고 `!vibisual pair <token>` 한 줄로 마무리한다.
//   ② Message Content Intent 를 포털에서 켜야 평문을 읽을 수 있다 → 4014 를 별도 사유로 올려
//      UI 가 "포털에서 스위치를 켜세요"라고 정확히 말하게 한다(그냥 '연결 실패'로 묶으면 못 고친다).
//   ③ 상호작용(버튼)에는 **3초 응답 창**이 있고 빈 본문을 거부한다 → `ackAction` 이 분기한다.
//
// 공개 문서 API 만 쓴다(https://discord.com/developers/docs). 의존성은 이미 있는 `ws` 하나.

/** 봇 초대 시 요구하는 권한 — 보기 + 보내기 + 기록 읽기. 그 이상 요구하지 않는다. */
const INVITE_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 16); // 68608

/**
 * 메시지 플래그 `SUPPRESS_EMBEDS` — 텔레그램 `disable_web_page_preview: true` 와 **같은 자리**다.
 * 억제하지 않으면 카드에 실린 URL(`WebFetch` 의 주소 등)을 디스코드 서버가 **긁어서** 미리보기를
 * 만든다 — §4 ⑩ "제3자로 나가는 것을 좁힌다" 는 정책이 링크 한 줄로 새는 자리다.
 */
const SUPPRESS_EMBEDS = 1 << 2; // 4

/** 디스코드 한 메시지의 길이 상한 안으로 접는다. */
function fitDiscord(text: string): string {
  if (text.length <= CHAT_DISCORD_MESSAGE_MAX) return text;
  let cut = text.slice(0, CHAT_DISCORD_MESSAGE_MAX - 1);
  // 잘린 끝에 `\` 가 홀수로 남으면 뒤에 붙일 `…` 를 그것이 먹는다 — 짝을 맞춰 떼어 낸다.
  let tail = 0;
  while (tail < cut.length && cut[cut.length - 1 - tail] === '\\') tail += 1;
  if (tail % 2 === 1) cut = cut.slice(0, -1);
  return cut + '…';
}

/**
 * `POST /channels/{id}/messages` 로 보낼 JSON 한 벌.
 *
 * **순수 함수로 떼어 둔 이유**는 여기 붙은 보호막 셋이 전부 **조용히** 사라지기 때문이다 —
 * 빠뜨려도 전송은 200 으로 성공하고, 틀렸다는 것은 폰 화면에서만 드러난다.
 *
 *   ① `allowed_mentions: { parse: [] }` — 카드 본문은 모델이 쓴 글과 파일 경로가 섞인 것이라
 *      `@everyone`·역할·사용자 멘션이 들어올 수 있다. 우리가 요구하는 권한에는 `MENTION_EVERYONE`
 *      이 없어 `@everyone` 은 발동하지 않지만 **역할·사용자 멘션은 권한 없이도 알림을 쏜다.**
 *      길드 채널로 묶인 옛 대화(`direct` 아님 배지가 붙는 것들)에서는 그 방의 사람이 우리 카드로
 *      호출된다 — 표시하려던 것이 **남에게 알림을 보내는 일**이 되어서는 안 된다.
 *   ② `flags: SUPPRESS_EMBEDS` — 위 상수의 이유.
 *   ③ 마크다운 이스케이프 — 디스코드에는 평문 스위치가 없다(`cards.escapeDiscordMarkdown`).
 */
export function buildDiscordMessage(card: ChatCard): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content: fitDiscord(escapeDiscordMarkdown(renderCard(card, CHAT_DISCORD_MESSAGE_MAX))),
    allowed_mentions: { parse: [] },
    flags: SUPPRESS_EMBEDS,
  };
  if (card.actions && card.actions.length > 0) {
    // action row 는 최대 5줄 × 5개 — 넘치는 버튼은 조용히 잘라 낸다(카드가 거부되는 것보다 낫다).
    body['components'] = chunk(card.actions, 5).slice(0, 5).map((row) => ({
      type: 1,
      components: row.map((a) => ({
        type: 2,
        style: a.style === 'primary' ? 1 : a.style === 'danger' ? 4 : 2,
        label: a.label,
        custom_id: a.actionId,
      })),
    }));
  }
  return body;
}

/**
 * 버튼 회신(`type 4`)에 실을 `data`. 본문이 비면 `null` — 그때는 `type 6` 으로 간다.
 * 메시지와 **같은 보호막**을 쓴다(이 회신도 채널에 그대로 보이는 한 줄이다).
 */
export function buildDiscordAckData(text: string): Record<string, unknown> | null {
  const said = fitDiscord(escapeDiscordMarkdown(text.trim()));
  if (!said) return null;
  return { content: said, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS };
}

/**
 * 상호작용 회신 주소 `<interaction id>:<interaction token>` 을 가른다.
 *
 * **첫 콜론만** 기준이다. interaction token 은 디스코드가 발급하는 불투명 문자열이라
 * 우리가 글자 집합을 정하지 못한다 — `split(':')` 로 갈라 두 번째 조각만 쓰면 콜론이 든
 * 토큰에서 **주소가 조용히 잘려** 회신이 404 로 사라지고, 누른 사람 화면에는 "이 상호작용에
 * 실패했습니다" 가 뜬다(결정 자체는 이미 적용된 뒤라 원인을 찾을 단서가 없다).
 */
export function splitAckToken(ackToken: string): { id: string; token: string } | null {
  const at = ackToken.indexOf(':');
  if (at <= 0) return null;
  const id = ackToken.slice(0, at);
  const token = ackToken.slice(at + 1);
  return token ? { id, token } : null;
}

interface DiscordUser { id: string; username?: string; global_name?: string | null; bot?: boolean }
interface GatewayPayload { op: number; d?: unknown; s?: number | null; t?: string | null }

export class DiscordChannel implements ChatChannel {
  readonly kind = 'discord' as const;

  private token: string | null = null;
  private ctx: ChatChannelContext | null = null;
  private appId: string | null = null;
  private ws: WebSocket | null = null;
  private generation = 0;
  private seq: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * 보낸 뒤 ACK(op 11)을 못 받은 하트비트 수.
   *
   * 이걸 안 세면 소켓이 `close` 이벤트 없이 반쯤 죽었을 때 상태는 `online` 인 채
   * **영원히 아무것도 받지 않는다** — 밖에서 권한 승인을 기다리다 60초 자동 결정을 맞는,
   * 이 축이 막으려던 바로 그 상황이다. 디스코드 문서도 "ACK 이 없으면 비정상 코드로 끊고
   * 재연결" 을 요구한다.
   */
  private missedAcks = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = CHAT_RECONNECT_MIN_MS;
  /**
   * 우리가 **의도해서** 끊었는가(op 7 재연결 요청 · op 9 세션 무효 · 좀비 소켓).
   *
   * 디스코드는 배포할 때마다 op 7 로 "다시 붙어라" 를 보낸다 — 드문 일이 아니다. 그것까지
   * `error: network` 로 올리면 그때마다 사이드바 점이 빨강으로 깜빡이고 "연결할 수 없습니다"
   * 가 뜬다. **정상적인 재연결이 실패로 보이면 사용자는 고칠 것이 없는데 고치려 든다** —
   * 토큰을 다시 넣고 봇을 다시 초대한다. 그래서 의도한 끊김은 `connecting` 으로 올린다.
   */
  private expectedClose = false;

  /** 토큰은 **인자로 받는다** — `verify()` 가 돌고 있는 세션의 토큰을 갈아끼우지 않게(telegram 과 동일). */
  private async rest<T>(token: string, path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
    const res = await fetch(`${CHAT_DISCORD_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => null) as T | null;
    return { status: res.status, body };
  }

  /** 토큰만 확인하고 끊는다 — 인스턴스 상태를 **한 글자도** 건드리지 않는다. */
  async verify(token: string): Promise<ChatVerifyResult> {
    try {
      const { status, body } = await this.rest<DiscordUser>(token, '/users/@me');
      if (status === 401) return { ok: false, error: 'token' };
      if (status !== 200 || !body) return { ok: false, error: status === 429 ? 'rate-limit' : 'network' };
      return {
        ok: true,
        botName: body.global_name ?? body.username ?? 'bot',
        botUsername: body.username ?? null,
        // 봇 계정은 user id 가 곧 application id 라 초대 URL 의 client_id 로 그대로 쓸 수 있다.
        appId: body.id,
      };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async start(token: string, ctx: ChatChannelContext): Promise<void> {
    await this.stop();
    this.token = token;
    this.ctx = ctx;
    this.generation += 1;
    this.backoff = CHAT_RECONNECT_MIN_MS;
    ctx.onStatus({ status: 'connecting' });

    const verified = await this.verify(token);
    if (!verified.ok) {
      ctx.onStatus({ status: 'error', error: verified.error });
      if (verified.error !== 'token') this.scheduleRetry(token, ctx);
      return;
    }
    this.appId = verified.appId;
    ctx.onStatus({
      status: 'connecting',
      error: null,
      botName: verified.botName,
      botUsername: verified.botUsername,
      appId: verified.appId,
    });
    await this.connectGateway(this.generation, token, ctx);
  }

  private scheduleRetry(token: string, ctx: ChatChannelContext): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, CHAT_RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => { void this.start(token, ctx); }, wait);
    ctx.log(`discord retry in ${Math.round(wait / 1000)}s`);
  }

  private async connectGateway(generation: number, token: string, ctx: ChatChannelContext): Promise<void> {
    let gatewayUrl = 'wss://gateway.discord.gg';
    try {
      const { status, body } = await this.rest<{ url?: string }>(token, '/gateway/bot');
      if (status === 200 && body?.url) gatewayUrl = body.url;
    } catch { /* 기본 주소로 시도한다 — 조회 실패가 곧 연결 실패는 아니다. */ }
    if (generation !== this.generation) return;

    const ws = new WebSocket(`${gatewayUrl}/?v=10&encoding=json`);
    this.ws = ws;
    this.missedAcks = 0;
    this.expectedClose = false;
    this.seq = null;

    ws.on('message', (raw: Buffer | string) => {
      if (generation !== this.generation) return;
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as GatewayPayload;
      } catch { return; }
      if (typeof payload.s === 'number') this.seq = payload.s;
      this.handlePayload(payload, ws, token, ctx);
    });

    ws.on('close', (code: number) => {
      if (generation !== this.generation) return;
      this.clearHeartbeat();
      this.ws = null;
      // RESUME 을 쓰지 않으므로 **다음 연결의 첫 하트비트는 `null` 부터**다. 옛 seq 를 그대로
      // 들고 가면 새 세션에 남의 번호를 말하는 셈이 된다.
      this.seq = null;
      // 사람이 고치기 전에는 재시도가 무의미한 셋 — 백오프를 돌리지 않고 사유를 그대로 올린다.
      // 4004 = 토큰 거부 / 4013 = intent 값 자체가 거부됨 / 4014 = 포털에서 특권 intent 가 꺼져 있음.
      if (code === 4004) { ctx.onStatus({ status: 'error', error: 'token' }); return; }
      if (code === 4013 || code === 4014) { ctx.onStatus({ status: 'error', error: 'intent' }); return; }
      const expected = this.expectedClose;
      this.expectedClose = false;
      if (expected) {
        // 우리가 의도해서 끊은 것 — 다시 붙는 중이지 **실패가 아니다**.
        ctx.onStatus({ status: 'connecting', error: null });
      } else {
        ctx.log(`discord gateway closed (${String(code)})`);
        ctx.onStatus({ status: 'error', error: 'network' });
      }
      this.scheduleRetry(token, ctx);
    });

    ws.on('error', (err: Error) => {
      if (generation !== this.generation) return;
      ctx.log(`discord gateway error: ${err.message}`);
    });
  }

  private handlePayload(payload: GatewayPayload, ws: WebSocket, token: string, ctx: ChatChannelContext): void {
    if (payload.op === 10) {
      const hello = payload.d as { heartbeat_interval?: number } | undefined;
      const interval = hello?.heartbeat_interval ?? 41_250;
      this.clearHeartbeat();
      this.missedAcks = 0;
      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // 지난 하트비트의 ACK 이 아직 안 왔다 = 반쯤 죽은 소켓. 끊어야 `close` 가 재연결을 부른다.
        if (this.missedAcks > CHAT_DISCORD_HEARTBEAT_MISS_MAX) {
          this.expectedClose = true;
          ctx.log('discord heartbeat unacknowledged — reconnecting');
          try { ws.close(CHAT_DISCORD_ZOMBIE_CLOSE_CODE); } catch { /* 이미 닫힘 */ }
          return;
        }
        this.missedAcks += 1;
        ws.send(JSON.stringify({ op: 1, d: this.seq }));
      }, interval);
      ws.send(JSON.stringify({
        op: 2,
        d: {
          token,
          intents: CHAT_DISCORD_INTENTS,
          properties: { os: process.platform, browser: 'vibisual', device: 'vibisual' },
        },
      }));
      return;
    }
    if (payload.op === 11) { this.missedAcks = 0; return; } // 하트비트 ACK — 소켓이 살아 있다.
    if (payload.op === 7 || payload.op === 9) {
      // 재연결/세션 무효 — 끊고 백오프 재시도(RESUME 은 쓰지 않는다. 놓친 이벤트는
      // 표시용 카드라 다음 것부터 받아도 되고, 명령은 사용자가 다시 보내면 된다).
      this.expectedClose = true;
      ctx.log(`discord gateway asked to reconnect (op ${String(payload.op)})`);
      try { ws.close(); } catch { /* 이미 닫힘 */ }
      return;
    }
    if (payload.op !== 0) return;

    if (payload.t === 'READY') {
      this.backoff = CHAT_RECONNECT_MIN_MS;
      const ready = payload.d as { user?: DiscordUser } | undefined;
      if (ready?.user?.id) this.appId = ready.user.id;
      ctx.onStatus({ status: 'online', error: null, ...(this.appId ? { appId: this.appId } : {}) });
      return;
    }
    if (payload.t === 'MESSAGE_CREATE') {
      const msg = payload.d as {
        channel_id?: string; guild_id?: string; content?: string; author?: DiscordUser;
      } | undefined;
      if (!msg?.channel_id || typeof msg.content !== 'string') return;
      if (msg.author?.bot) return; // 우리 자신·다른 봇의 말은 명령이 아니다.
      ctx.onInbound({
        type: 'text',
        chatId: msg.channel_id,
        label: msg.author?.global_name ?? msg.author?.username ?? msg.channel_id,
        // `guild_id` 가 없으면 봇과의 1:1 DM 이다. 길드 채널은 여럿이 보는 방이라
        // peer 키(= channel id)가 사람이 아니라 **그 방 전체**를 뜻하게 된다(§4 ④).
        direct: msg.guild_id === undefined,
        text: msg.content,
      });
      return;
    }
    if (payload.t === 'INTERACTION_CREATE') {
      const it = payload.d as {
        id?: string; token?: string; channel_id?: string; guild_id?: string; type?: number;
        data?: { custom_id?: string };
        member?: { user?: DiscordUser }; user?: DiscordUser;
      } | undefined;
      // type 3 = MESSAGE_COMPONENT(버튼). 그 밖(슬래시 명령 등)은 등록하지 않았으므로 무시.
      if (!it?.id || !it.token || !it.channel_id || it.type !== 3) return;
      const customId = it.data?.custom_id;
      if (!customId) return;
      const user = it.member?.user ?? it.user;
      ctx.onInbound({
        type: 'action',
        chatId: it.channel_id,
        label: user?.global_name ?? user?.username ?? it.channel_id,
        direct: it.guild_id === undefined,
        actionId: customId,
        ackToken: `${it.id}:${it.token}`,
      });
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.missedAcks = 0;
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.clearHeartbeat();
    this.expectedClose = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* 이미 닫힘 */ }
      this.ws = null;
    }
    this.ctx = null;
    // 토큰은 남긴다(telegram 과 같은 이유). **끄기 판정은 chat/index.ts `sendTo` 에서 한다.**
    return Promise.resolve();
  }

  async sendCard(chatId: string, card: ChatCard): Promise<void> {
    const token = this.token;
    if (!token) return;
    const body = buildDiscordMessage(card);
    try {
      const { status } = await this.rest(token, `/channels/${chatId}/messages`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (status >= 400) this.ctx?.log(`discord sendMessage failed (${String(status)})`);
    } catch (err) {
      this.ctx?.log(`discord sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 버튼이 눌렸음을 3초 안에 회신한다. **본문이 비면 type 4 를 쓸 수 없다** —
   * 디스코드는 빈 `content` 를 400 으로 거부하고, 그러면 회신이 없는 것과 같아져
   * 누른 사람 화면에 "이 상호작용에 실패했습니다" 가 뜬다(실제로는 처리됐는데도).
   * 할 말이 없을 때는 **type 6**(DEFERRED_UPDATE_MESSAGE)로 조용히 스피너만 푼다.
   */
  async ackAction(ackToken: string, text: string): Promise<void> {
    const pair = splitAckToken(ackToken);
    if (!pair) return;
    const { id, token } = pair;
    const data = buildDiscordAckData(text);
    const payload = data
      ? { type: 4, data } // CHANNEL_MESSAGE_WITH_SOURCE — 결과 한 줄을 붙인다.
      : { type: 6 };      // DEFERRED_UPDATE_MESSAGE — 아무것도 안 띄우고 확인만.
    try {
      await fetch(`${CHAT_DISCORD_API_BASE}/interactions/${id}/${token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* 버튼 회신은 표시 전용 — 결정 자체는 이미 적용됐다. */ }
  }

  /**
   * 디스코드는 "이 토큰을 든 사람에게 DM" 이라는 딥링크가 없다. 대신 **초대 URL** 을 QR 로 주고,
   * 봇이 보이는 곳에서 명령 한 줄로 마무리한다 — 사용자가 channel id 를 볼 일은 없다.
   * **다만 그 한 줄은 봇과의 1:1 DM 에서 보내야 한다**(§4 ④). 초대가 여전히 필요한 이유는
   * 디스코드가 공통 서버가 없는 봇에게 DM 을 보내지 못하게 막기 때문이다.
   */
  buildPairLink(token: string): ChatPairLink | null {
    if (!this.appId) return null;
    const url = `https://discord.com/oauth2/authorize?client_id=${this.appId}`
      + `&scope=bot&permissions=${String(INVITE_PERMISSIONS)}`;
    return { url, command: `${CHAT_DISCORD_PAIR_COMMAND} ${token}` };
  }
}
