import type { ChatCard, ChatChannelError, ChatChannelKind, ChatChannelStatus } from '@vibisual/shared';

// §4 메신저 원격제어 브리지 — 드라이버 계약 (판올림 번호 발급 대기)
//
// 메신저는 **아키텍처가 아니라 드라이버**다. 이 파일에 적힌 것만 지키면 새 메신저가 붙고,
// 페어링·라우팅·전송량 정책(chat/index.ts)은 한 줄도 바뀌지 않는다.
//
// 드라이버가 하는 일은 셋뿐이다:
//   ① 토큰 하나로 그 메신저에 **나가서** 붙는다(우리는 포트를 열지 않는다).
//   ② 들어온 것을 해석하지 않고 `ChatInbound` 로 그대로 올린다.
//   ③ `ChatCard` 를 그 메신저의 표현(인라인 키보드 / components 버튼)으로 그려 보낸다.
//
// 드라이버가 **하지 않는** 일: 누가 보냈는지 판정(화이트리스트), 명령 해석, 전송량 정책.
// 그건 전부 상위에 있다 — 그래야 메신저를 하나 더 붙여도 보안 판정이 두 벌이 되지 않는다.

/** 평문 한 줄이 들어왔다. */
export interface ChatInboundText {
  type: 'text';
  /** 그 메신저 안의 대화 식별자(텔레그램 chat.id / 디스코드 channel.id). 문자열로 통일. */
  chatId: string;
  /** 표시용 이름(사용자명·채널명). 없으면 드라이버가 chatId 를 넣는다. */
  label: string;
  /** 1:1 DM 인가(§4 ④ — 페어링은 이것만 받는다). 판정은 드라이버가, 사용은 상위가. */
  direct: boolean;
  text: string;
}

/** 카드에 붙인 버튼이 눌렸다. */
export interface ChatInboundAction {
  type: 'action';
  chatId: string;
  label: string;
  /** 1:1 DM 인가. 버튼은 이미 페어링된 대화에서만 오지만 계약을 두 종류가 나눠 갖지 않게 함께 싣는다. */
  direct: boolean;
  /** 우리가 `ChatAction.actionId` 로 실어 보냈던 값 그대로. */
  actionId: string;
  /**
   * "눌렸음"을 그 메신저에 되돌려 줄 때 필요한 불투명 값
   * (텔레그램 `callback_query.id` / 디스코드 `interaction.id:token`).
   * 상위는 내용을 해석하지 않고 `ackAction` 에 그대로 돌려준다.
   */
  ackToken: string;
}

export type ChatInbound = ChatInboundText | ChatInboundAction;

/** 드라이버가 상위에 올리는 상태 변화. 부분 갱신이라 모르는 필드는 생략한다. */
export interface ChatStatusPatch {
  status: ChatChannelStatus;
  error?: ChatChannelError;
  botName?: string | null;
  botUsername?: string | null;
  appId?: string | null;
}

/** 드라이버가 상위를 부르는 창구. 드라이버는 이것 말고 상위를 모른다. */
export interface ChatChannelContext {
  /** 들어온 것 하나. 판정은 상위가 한다. */
  onInbound(msg: ChatInbound): void;
  /** 연결/오류/봇 신원이 바뀌었다. */
  onStatus(patch: ChatStatusPatch): void;
  /** 진단 한 줄. **토큰이 섞인 URL 을 그대로 넘기지 않는다.** */
  log(line: string): void;
}

/** 토큰 검증 결과 — 저장 **전에** "이 토큰이 맞나"를 눈으로 확인시키는 값. */
export type ChatVerifyResult =
  | { ok: true; botName: string; botUsername: string | null; appId: string | null }
  | { ok: false; error: NonNullable<ChatChannelError> };

/** 페어링 티켓의 화면 표현 — 채널마다 방식이 다르다(딥링크 하나 vs 초대 URL + 명령 한 줄). */
export interface ChatPairLink {
  /** QR 로 그릴 원문. */
  url: string;
  /** URL 만으로 끝나지 않는 채널이 함께 띄울 명령문(없으면 null). */
  command: string | null;
}

/** 한 메신저 드라이버. */
export interface ChatChannel {
  readonly kind: ChatChannelKind;
  /** 토큰만 확인하고 끊는다(연결을 유지하지 않는다). */
  verify(token: string): Promise<ChatVerifyResult>;
  /** 붙어서 받기 시작한다. 실패해도 throw 하지 않고 `onStatus(error)` 로 알리며 재시도한다. */
  start(token: string, ctx: ChatChannelContext): Promise<void>;
  /** 완전히 끊는다(재시도 타이머 포함). */
  stop(): Promise<void>;
  /** 카드 한 장 전송. 실패는 삼키고 로그만 남긴다(표시 전용 경로라 작업을 막지 않는다). */
  sendCard(chatId: string, card: ChatCard): Promise<void>;
  /** 버튼이 눌렸음을 그 메신저에 회신(로딩 스피너 해제). */
  ackAction(ackToken: string, text: string): Promise<void>;
  /** 페어링 티켓 토큰을 그 채널의 딥링크/초대 표현으로 바꾼다. */
  buildPairLink(token: string): ChatPairLink | null;
}
