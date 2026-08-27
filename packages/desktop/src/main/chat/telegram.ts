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
interface TgChat { id: number; title?: string; username?: string; first_name?: string }
interface TgMessage { chat?: TgChat; text?: string; from?: TgUser }
interface TgCallbackQuery { id: string; data?: string; message?: TgMessage; from?: TgUser }
interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }

/** 텔레그램 chat 의 표시 이름 — 없으면 chatId 를 쓴다(표시 전용이라 실패해도 무해). */
function chatLabel(chat: TgChat | undefined, from: TgUser | undefined): string {
  return chat?.title ?? chat?.username ?? chat?.first_name ?? from?.username ?? from?.first_name
    ?? (chat ? String(chat.id) : 'unknown');
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
  private backoff = CHAT_RECONNECT_MIN_MS;

  /** 토큰이 경로에 실리므로 이 함수 밖으로 URL 을 내보내지 않는다(로그에 토큰 유출 방지). */
  private async call<T>(method: string, body?: unknown, signal?: AbortSignal): Promise<TgResponse<T>> {
    const url = `${CHAT_TELEGRAM_API_BASE}/bot${this.token ?? ''}/${method}`;
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

  async verify(token: string): Promise<ChatVerifyResult> {
    const previous = this.token;
    this.token = token;
    try {
      const res = await this.call<TgUser>('getMe');
      if (!res.ok || !res.result) {
        return { ok: false, error: res.error_code === 401 ? 'token' : 'network' };
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
    } finally {
      // verify 는 연결을 유지하지 않는다 — 돌기 시작한 세션의 토큰을 덮어쓰지 않게 되돌린다.
      if (previous !== null) this.token = previous;
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
    void this.poll(this.generation);
  }

  private scheduleRetry(token: string, ctx: ChatChannelContext): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, CHAT_RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => { void this.start(token, ctx); }, wait);
    ctx.log(`telegram retry in ${Math.round(wait / 1000)}s`);
  }

  /** long-poll 루프. 한 바퀴가 곧 한 번의 아웃바운드 요청이다. */
  private async poll(generation: number): Promise<void> {
    while (generation === this.generation && this.token && this.ctx) {
      const ctx = this.ctx;
      const abort = new AbortController();
      this.abort = abort;
      try {
        const res = await this.call<TgUpdate[]>('getUpdates', {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { this.retryTimer = setTimeout(resolve, ms); });
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
        text: msg.text,
      });
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.abort) { this.abort.abort(); this.abort = null; }
    this.ctx = null;
    // 토큰은 남긴다 — sendCard 가 stop 뒤 마지막 한 장을 보내려 할 수 있다(실패해도 무해).
    return Promise.resolve();
  }

  async sendCard(chatId: string, card: ChatCard): Promise<void> {
    const text = renderCard(card, CHAT_TELEGRAM_MESSAGE_MAX);
    const body: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
    if (card.actions && card.actions.length > 0) {
      // callback_data 는 64바이트 상한 — 상위가 짧은 actionId 를 만든다(chat/index.ts).
      body['reply_markup'] = {
        inline_keyboard: chunk(card.actions, 2).map((row) => row.map((a) => ({ text: a.label, callback_data: a.actionId }))),
      };
    }
    try {
      const res = await this.call('sendMessage', body);
      if (!res.ok) this.ctx?.log(`telegram sendMessage failed (${String(res.error_code)})`);
    } catch (err) {
      this.ctx?.log(`telegram sendMessage error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async ackAction(ackToken: string, text: string): Promise<void> {
    try {
      await this.call('answerCallbackQuery', { callback_query_id: ackToken, text });
    } catch { /* 버튼 스피너 해제는 표시 전용 — 실패해도 결정 자체는 이미 적용됐다. */ }
  }

  /** 딥링크 — 스캔 → [시작] → `/start <token>`. 사용자는 chat id 를 볼 일이 없다. */
  buildPairLink(token: string): ChatPairLink | null {
    if (!this.botUsername) return null;
    return { url: `https://t.me/${this.botUsername}?start=${token}`, command: null };
  }
}
