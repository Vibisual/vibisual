import {
  CHAT_RECONNECT_MAX_MS, CHAT_RECONNECT_MIN_MS, CHAT_TELEGRAM_API_BASE,
  CHAT_TELEGRAM_MESSAGE_MAX, CHAT_TELEGRAM_POLL_S,
} from '@vibisual/shared';
import type { ChatCard } from '@vibisual/shared';
import { chunk, renderCard } from './cards';
import type { ChatChannel, ChatChannelContext, ChatPairLink, ChatVerifyResult } from './types';

// §4 메신저 원격제어 브리지 — 텔레그램 드라이버 (판올림 번호 발급 대기)
//
// 이 드라이버가 이 축의 존재 이유를 가장 잘 보여 준다: **우리는 아무 포트도 열지 않는다.**
// `getUpdates` 를 30초씩 붙잡는 long-poll 로 우리가 나가서 받아오므로, 공유기 설정·인증서·
// CGNAT 이 전부 무관하다(§4 v3.16 모바일 웹이 인바운드라 막히던 자리).
//
// 공개 문서 API 만 쓴다(https://core.telegram.org/bots/api) — 화면 긁기·비공개 엔드포인트 ❌.
// 의존성도 없다(`fetch` 하나).

interface TgResponse<T> { ok: boolean; result?: T; error_code?: number; description?: string }
interface TgUser { id: number; first_name?: string; username?: string }
interface TgChat { id: number; type?: string; title?: string; username?: string; first_name?: string }
interface TgMessage { chat?: TgChat; text?: string; from?: TgUser }
interface TgCallbackQuery { id: string; data?: string; message?: TgMessage; from?: TgUser }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }

/** 텔레그램 chat 의 표시 이름 — 없으면 chatId 를 쓴다(표시 전용이라 실패해도 무해). */
function chatLabel(chat: TgChat | undefined, from: TgUser | undefined): string {
  return chat?.title ?? chat?.username ?? chat?.first_name ?? from?.username ?? from?.first_name
    ?? (chat ? String(chat.id) : 'unknown');
}

/**
 * 1:1 대화인가. 텔레그램은 `chat.type` 이 `private` 일 때만 사람 한 명과의 대화다
 * (`group`·`supergroup`·`channel` 은 여럿이 보는 방이다). **페어링은 이것만 받는다**(§4 ④).
 */
function isDirectChat(chat: TgChat | undefined): boolean {
  return chat?.type === 'private';
}

export class TelegramChannel implements ChatChannel {
  readonly kind = 'telegram' as const;

  private token: string | null = null;
  private ctx: ChatChannelContext | null = null;
  private botUsername: string | null = null;
  /** 세대 번호 — stop() 후 늦게 돌아온 응답이 다음 세대를 건드리지 못하게 한다. */
  private generation = 0;
  private offset = 0;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 백오프 대기 전용 타이머와 그 promise 의 resolve.
   *
   * 예전에는 `sleep` 이 `retryTimer` 를 함께 썼는데, `stop()` 이 그것을 `clearTimeout` 하면
   * **resolve 가 영영 안 불려** poll 루프가 그 자리에 매달린 채 `ctx` 를 붙잡았다(백오프 중에
   * 끌 때마다 하나씩 샜다). 타이머를 나누고, 끊을 때는 지우는 대신 **깨운다**.
   */
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepWake: (() => void) | null = null;
  private backoff = CHAT_RECONNECT_MIN_MS;

  /**
   * 토큰은 **인자로 받는다**. 예전에는 `this.token` 을 읽었는데, `verify()` 가 검증 동안
   * 그 필드를 후보 토큰으로 바꿨다 되돌리는 구조라, 그 창에 폴링 루프가 URL 을 조립하면
   * 틀린 토큰으로 나가고 → 401 → 401 분기는 재시도 없이 끝나 **멀쩡하던 채널이 죽었다**.
   * 토큰이 인자면 그 경합 자체가 성립하지 않는다.
   *
   * 토큰이 경로에 실리므로 **이 함수 밖으로 URL 을 내보내지 않는다**(로그에 토큰 유출 방지).
   */
  private async call<T>(token: string, method: string, body?: unknown, signal?: AbortSignal): Promise<TgResponse<T>> {
    const url = `${CHAT_TELEGRAM_API_BASE}/bot${token}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    };
    if (signal) init.signal = signal;
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({ ok: false })) as TgResponse<T>;
    if (!json.ok && json.error_code === undefined) json.error_code = res.status;
    return json;
  }

  /** 토큰만 확인하고 끊는다 — 인스턴스 상태를 **한 글자도** 건드리지 않는다. */
  async verify(token: string): Promise<ChatVerifyResult> {
    try {
      const res = await this.call<TgUser>(token, 'getMe');
      if (!res.ok || !res.result) {
        return { ok: false, error: res.error_code === 401 ? 'token' : res.error_code === 429 ? 'rate-limit' : 'network' };
      }
      const user = res.result;
      return {
        ok: true,
        botName: user.first_name ?? user.username ?? 'bot',
        botUsername: user.username ?? null,
        appId: null,
      };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async start(token: string, ctx: ChatChannelContext): Promise<void> {
    // 봇이 바뀌면 offset 도 새로 센다. getUpdates offset 은 **봇마다 독립**이라, 봇 A 의 높은
    // offset 을 봇 B 에 들이대면 B 의 대기 업데이트가 통째로 버려진다(재연결에서는 유지해야
    // 이미 처리한 것을 다시 받지 않으므로, 리셋 조건은 "토큰이 달라졌을 때" 하나다).
    const tokenChanged = this.token !== null && this.token !== token;
    await this.stop();
    if (tokenChanged) this.offset = 0;
    this.token = token;
    this.ctx = ctx;
    this.generation += 1;
    this.backoff = CHAT_RECONNECT_MIN_MS;
    ctx.onStatus({ status: 'connecting' });

    const verified = await this.verify(token);
    if (!verified.ok) {
      ctx.onStatus({ status: 'error', error: verified.error });
      // 토큰이 틀린 것이 아니면 잠시 뒤 다시 시도한다(인터넷이 늦게 붙는 경우가 흔하다).
      if (verified.error !== 'token') this.scheduleRetry(token, ctx);
      return;
    }
    this.botUsername = verified.botUsername;
    ctx.onStatus({
      status: 'online',
      error: null,
      botName: verified.botName,
      botUsername: verified.botUsername,
      appId: null,
    });
    void this.poll(this.generation, token);
  }

  private scheduleRetry(token: string, ctx: ChatChannelContext): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, CHAT_RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => { void this.start(token, ctx); }, wait);
    ctx.log(`telegram retry in ${Math.round(wait / 1000)}s`);
  }

  /** long-poll 루프. 한 바퀴가 곧 한 번의 아웃바운드 요청이다. */
  private async poll(generation: number, token: string): Promise<void> {
    while (generation === this.generation && this.ctx) {
      const ctx = this.ctx;
      const abort = new AbortController();
      this.abort = abort;
      try {
        const res = await this.call<TgUpdate[]>(token, 'getUpdates', {
          offset: this.offset,
          timeout: CHAT_TELEGRAM_POLL_S,
          allowed_updates: ['message', 'callback_query'],
        }, abort.signal);
        if (generation !== this.generation) return;

        if (!res.ok) {
          if (res.error_code === 401) {
            ctx.onStatus({ status: 'error', error: 'token' });
            return; // 토큰이 폐기된 것 — 재시도해도 같다.
          }
          // 409 = 다른 인스턴스가 같은 봇을 폴링 중. 재시도로 풀리는 종류라 백오프만 건다.
          ctx.log(`telegram getUpdates failed (${String(res.error_code)}): ${res.description ?? ''}`);
          ctx.onStatus({ status: 'error', error: res.error_code === 429 ? 'rate-limit' : 'network' });
          await this.sleep(this.nextBackoff());
          continue;
        }

        this.backoff = CHAT_RECONNECT_MIN_MS;
        ctx.onStatus({ status: 'online', error: null });
        for (const update of res.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          this.emit(update, ctx);
        }
      } catch (err) {
        if (generation !== this.generation) return; // stop() 이 끊은 것 — 정상 종료.
        ctx.log(`telegram poll error: ${err instanceof Error ? err.message : String(err)}`);
        ctx.onStatus({ status: 'error', error: 'network' });
        await this.sleep(this.nextBackoff());
      }
    }
  }

  private nextBackoff(): number {
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, CHAT_RECONNECT_MAX_MS);
    return wait;
  }

  /** 기다린다. `stop()` 이 불리면 타이머를 지우는 대신 **즉시 깨워** 루프가 정상 종료하게 한다. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepWake = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        this.sleepWake = null;
        resolve();
      }, ms);
    });
  }

  private wakeSleeper(): void {
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    const wake = this.sleepWake;
    this.sleepWake = null;
    if (wake) wake();
  }

  /** 들어온 것을 해석하지 않고 그대로 올린다 — 누구인지 판정하는 것은 상위의 일이다. */
  private emit(update: TgUpdate, ctx: ChatChannelContext): void {
    const cb = update.callback_query;
    if (cb) {
      const chat = cb.message?.chat;
      if (chat && cb.data) {
        ctx.onInbound({
          type: 'action',
          chatId: String(chat.id),
          label: chatLabel(chat, cb.from),
          direct: isDirectChat(chat),
          actionId: cb.data,
          ackToken: cb.id,
        });
      }
      return;
    }
    const msg = update.message;
    if (msg?.chat && typeof msg.text === 'string') {
      ctx.onInbound({
        type: 'text',
        chatId: String(msg.chat.id),
        label: chatLabel(msg.chat, msg.from),
        direct: isDirectChat(msg.chat),
        text: msg.text,
      });
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.wakeSleeper();
    if (this.abort) { this.abort.abort(); this.abort = null; }
    this.ctx = null;
    // 토큰은 남긴다 — sendCard 가 stop 뒤 마지막 한 장을 보내려 할 수 있다(실패해도 무해).
    // **끄기 판정은 여기가 아니라 카드가 나가는 곳에서 한다**(chat/index.ts `sendTo`) —
    // sendCard 는 폴링이 아니라 REST 라, 드라이버를 멈춰도 토큰만 있으면 그대로 나가기 때문.
    return Promise.resolve();
  }

  async sendCard(chatId: string, card: ChatCard): Promise<void> {
    const token = this.token;
    if (!token) return;
    const text = renderCard(card, CHAT_TELEGRAM_MESSAGE_MAX);
    const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
    if (card.actions && card.actions.length > 0) {
      // callback_data 는 64바이트 상한 — 상위가 짧은 actionId 를 만든다(chat/index.ts).
      body['reply_markup'] = {
        inline_keyboard: chunk(card.actions, 2).map((row) => row.map((a) => ({ text: a.label, callback_data: a.actionId }))),
      };
    }
    try {
      const res = await this.call(token, 'sendMessage', body);
      if (!res.ok) this.ctx?.log(`telegram sendMessage failed (${String(res.error_code)})`);
    } catch (err) {
      this.ctx?.log(`telegram sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async ackAction(ackToken: string, text: string): Promise<void> {
    const token = this.token;
    if (!token) return;
    try {
      // 텔레그램은 빈 text 도 정상이다(스피너만 풀린다) — 디스코드와 달리 분기가 필요 없다.
      await this.call(token, 'answerCallbackQuery', { callback_query_id: ackToken, text });
    } catch { /* 버튼 스피너 해제는 표시 전용 — 실패해도 결정 자체는 이미 적용됐다. */ }
  }

  /** 딥링크 — 스캔 → [시작] → `/start <token>`. 사용자는 chat id 를 볼 일이 없다. */
  buildPairLink(token: string): ChatPairLink | null {
    if (!this.botUsername) return null;
    return { url: `https://t.me/${this.botUsername}?start=${token}`, command: null };
  }
}
