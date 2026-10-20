import { SESSION_MEMO, SESSION_MEMO_LINK_KINDS, type SessionMemoLink, type SessionMemoLinkKind } from '@vibisual/shared';
import type { ContextMenuItem } from './IDEContextMenu.js';
import type { MenuText } from '../../hooks/textFieldContextMenu.js';
import type { PromptRailEntry } from './promptRail.js';
import { promptLinkLabel, type TextRange } from './memoLinks.js';
import { MemoLinkIcon } from './memoLinkIcons.js';

/**
 * memoLinkMenu.tsx — §5.5 #17-36 ⑫ 메모 입력칸 우클릭의 **링크 항목 목록**(화면·통신 없음).
 *
 * 무엇이 흐려지고 무엇이 펼쳐지는지는 화면을 띄우지 않고도 답이 나와야 한다 — 그래서 목록 만들기를
 * 컴포넌트에서 떼어 여기 두고 `memoLinkMenu.test.ts` 로 못 박는다(`textFieldContextMenu.ts` 와 같은 판단).
 *
 * 목록의 뼈대는 둘이다.
 *  - **새로 걸기** — 글자 항목 아래 [링크 ▸] 하나. 그 아래가 종류 목록이고 **첫 자리가 세션 글 위치**다
 *    (사용자 지시). 고른 글자가 없으면 흐리고 이유를 단다.
 *  - **이미 걸린 링크 위** — [링크로 이동] · [링크 다시 고르기 ▸] · [링크 해제]. 다시 고르기는 새로 걸기와
 *    **같은 종류 목록**을 연다(동작만 "범위는 두고 가리키는 곳만 바꾼다"로 다르다).
 *
 * 종류 목록은 표(`SESSION_MEMO_LINK_KINDS`)를 그대로 돈다 — 종류가 늘면 아래 `KIND_ITEMS` 에 한 칸이
 * 비어 컴파일러가 알린다.
 */

/** [다른 세션 ▸] 의 한 줄. `id` 가 null 이면 메인 탭이다. */
export interface MemoLinkSessionOption {
  id: string | null;
  label: string;
}

/** 종류 목록을 짓는 데 필요한 지금 화면의 사실들. */
export interface MemoLinkKindContext {
  /** 이 화면의 내 입력(위→아래 = 오래된 것부터). 목록에는 최근 것부터 상한까지 선다. */
  prompts: readonly PromptRailEntry[];
  /** 이 에이전트의 다른 세션 탭(지금 화면은 빠져 있다). */
  sessions: readonly MemoLinkSessionOption[];
  /** 내 입력 옆에 적을 시각(HH:MM) — 시각이 없는 입력은 비운다. */
  formatTime: (at: number) => string;
}

/** 종류 목록에서 고른 것 — 새로 걸기·다시 고르기가 같은 손잡이를 쓴다. */
export interface MemoLinkKindHandlers {
  /** [대화에서 직접 고르기] — 고르기 모드로 들어간다. */
  pick: () => void;
  /** 내 입력 하나를 그 자리로. */
  prompt: (entry: PromptRailEntry) => void;
  session: (option: MemoLinkSessionOption) => void;
  /** 파일 고르기 창을 연다. */
  file: () => void;
  /** 웹 주소 창을 연다. */
  url: () => void;
}

const NOOP = (): void => {};

type KindItemBuilder = (ctx: MemoLinkKindContext, h: MemoLinkKindHandlers, t: MenuText) => ContextMenuItem;

const KIND_ITEMS: Record<SessionMemoLinkKind, KindItemBuilder> = {
  stream: (ctx, h, t) => {
    // 최근 것이 위 — 방금 쓴 입력을 잇는 일이 가장 흔하다.
    const recent = [...ctx.prompts].reverse().slice(0, SESSION_MEMO.LINK_PROMPT_MAX);
    return {
      id: 'link-kind-stream',
      label: t('ide.memo.link.kind.stream'),
      icon: <MemoLinkIcon name="stream" />,
      onClick: NOOP,
      children: [
        {
          id: 'link-pick',
          label: t('ide.memo.link.pick'),
          note: t('ide.memo.link.pickNote'),
          icon: <MemoLinkIcon name="pick" />,
          onClick: h.pick,
        },
        ...recent.map((entry, i): ContextMenuItem => ({
          id: `link-prompt-${entry.id}`,
          label: promptLinkLabel(entry.text) || entry.id,
          icon: <MemoLinkIcon name="prompt" />,
          ...(entry.at !== undefined ? { hint: ctx.formatTime(entry.at) } : {}),
          ...(i === 0 ? { separatorBefore: true } : {}),
          onClick: () => h.prompt(entry),
        })),
      ],
    };
  },
  session: (ctx, h, t) => {
    const none = ctx.sessions.length === 0;
    return {
      id: 'link-kind-session',
      label: t('ide.memo.link.otherSession'),
      icon: <MemoLinkIcon name="session" />,
      onClick: NOOP,
      // 갈 탭이 없으면 펼칠 것도 없다 — 이유를 달아 흐린다(있다가 없어지는 항목 ❌).
      ...(none
        ? { disabled: true, disabledTitle: t('ide.memo.link.noSessions') }
        : {
            children: ctx.sessions.map((option): ContextMenuItem => ({
              id: `link-session-${option.id ?? 'main'}`,
              label: option.label,
              icon: <MemoLinkIcon name="session" />,
              onClick: () => h.session(option),
            })),
          }),
    };
  },
  // 창을 여는 두 줄은 이름 끝에 `…` 가 붙는다(메뉴의 관례 — 누르면 무언가를 더 묻는다).
  file: (_ctx, h, t) => ({
    id: 'link-kind-file',
    label: t('ide.memo.link.addFile'),
    icon: <MemoLinkIcon name="file" />,
    onClick: h.file,
  }),
  url: (_ctx, h, t) => ({
    id: 'link-kind-url',
    label: t('ide.memo.link.addUrl'),
    icon: <MemoLinkIcon name="url" />,
    onClick: h.url,
  }),
};

/** 종류 목록 — 표의 순서 그대로(첫 자리 = 세션 글 위치). */
export function buildMemoLinkKindItems(ctx: MemoLinkKindContext, h: MemoLinkKindHandlers, t: MenuText): ContextMenuItem[] {
  return SESSION_MEMO_LINK_KINDS.map((kind) => KIND_ITEMS[kind](ctx, h, t));
}

/** 우클릭 순간의 링크 사정. */
export interface MemoLinkMenuState {
  /** 우클릭이 다룰 **이미 걸린** 링크 — 캐럿이 그 안이거나 고른 범위가 그 링크와 같을 때. */
  link: SessionMemoLink | null;
  /** 새로 걸 범위(앞뒤 공백을 뗀 것). 고른 글자가 없으면 null. */
  range: TextRange | null;
  /** 새로 걸면 걷히는 옛 링크가 있나 — 있으면 줄 아래에 그 사실을 적는다. */
  replaces: boolean;
  /** 개수 상한이라 더 걸 수 없나. */
  atLimit: boolean;
}

export interface MemoLinkMenuHandlers {
  follow: () => void;
  remove: () => void;
  /** 종류 목록(`buildMemoLinkKindItems`) — 새로 걸기면 거는 손잡이, 링크 위면 다시 고르는 손잡이가 실려 있다. */
  kinds: ContextMenuItem[];
  /** [링크로 이동] 오른쪽에 흐리게 적을 손버릇(`Ctrl+클릭` — 표기는 호출부가 플랫폼대로 만든다). */
  followHint: string;
}

/**
 * 글자 항목 아래에 이어 붙일 링크 항목들(맨 앞 줄에 구분선).
 */
export function buildMemoLinkMenuItems(state: MemoLinkMenuState, h: MemoLinkMenuHandlers, t: MenuText): ContextMenuItem[] {
  if (state.link) {
    return [
      { id: 'link-follow', label: t('ide.memo.link.follow'), hint: h.followHint, separatorBefore: true, onClick: h.follow },
      { id: 'link-repick', label: t('ide.memo.link.repick'), children: h.kinds, onClick: NOOP },
      { id: 'link-remove', label: t('ide.memo.link.remove'), onClick: h.remove },
    ];
  }
  const can = state.range !== null && !state.atLimit;
  if (!can) {
    return [{
      id: 'link',
      label: t('ide.memo.link.menu'),
      separatorBefore: true,
      disabled: true,
      disabledTitle: state.range === null
        ? t('ide.editor.ctx.needSelection')
        : t('ide.memo.link.limit', { max: SESSION_MEMO.LINK_MAX }),
      onClick: NOOP,
    }];
  }
  return [{
    id: 'link',
    label: t('ide.memo.link.menu'),
    separatorBefore: true,
    children: h.kinds,
    ...(state.replaces ? { note: t('ide.memo.link.replacesNote') } : {}),
    onClick: NOOP,
  }];
}
