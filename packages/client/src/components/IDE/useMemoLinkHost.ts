import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeMemoLinkUrl, type SessionMemoLinkTarget } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';
import { useIDESlotKey } from './ideSlot.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { useSelectSessionInSplit } from './useSplitDrop.js';
import { toStreamPathCandidate } from './streamPathLinks.js';
import { resolveExternalPath, resolveWorkspacePath, revealExternalPath } from './useWorkspacePathKind.js';
import { openWorkspaceTarget } from './openWorkspaceTarget.js';
import { formatPromptStamp } from './promptStamp.js';
import type { PromptRailEntry } from './promptRail.js';
import type { MemoLinkSessionOption } from './memoLinkMenu.js';

/**
 * useMemoLinkHost.ts — §5.5 #17-36 ⑫ 메모 링크가 **이 IDE 화면에 묻는 것**과 **따라가는 길**.
 *
 * 메모 판(`SessionMemoLayer`)은 대화 위에 떠 있을 뿐 대화가 무엇인지 모른다 — 내 입력 목록, 이 에이전트의
 * 다른 세션, 프로젝트 루트, 그리고 "그 자리로 스크롤"은 본문(`IDEMainArea`)의 것이다. 그래서 본문이 이
 * 묶음 하나를 판에 내려 준다.
 *
 * ⚠ **값이 아니라 함수로 내려 준다.** 내 입력·세션 목록은 스트리밍 중에도 바뀌는데, 값을 프롭으로 꿰면
 * 바뀔 때마다 판(`memo()`)과 카드들이 다시 그려진다. 메뉴를 여는 순간 한 번 읽으면 충분하므로 함수가
 * 맞다 — 묶음의 정체(참조)는 처음부터 끝까지 같다.
 *
 * 따라가는 길은 전부 **이미 있는 창구**다(새 열기 레일 ❌).
 *  - 세션 글 위치 → 같은 화면이면 본문의 점프(북마크 이동과 같은 `scrollToBookmark`·`performBookmarkScroll`),
 *    다른 세션이면 북마크 이동이 쓰는 `openIDEOverlay({ focus })` 그대로.
 *  - 다른 세션 → 그 탭을 누른 것과 같다(`useSelectSessionInSplit` — 분할 칸도 같은 규칙).
 *  - 파일 → 본문 경로 링크(#17-27 ⑬)와 같은 판정·같은 창구(`toStreamPathCandidate` → 디스크 확인 →
 *    `openWorkspaceTarget`, 루트 밖은 탐색기).
 *  - 웹 주소 → 기본 브라우저(`window.open` → main 의 `shell.openExternal`, #17-3 웹 검색과 같은 길).
 */

/** 링크가 가리키는 세션의 지금 모습 — 링크 상자가 이름을 쓰고, 닫혔으면 그 사실을 말한다. */
export interface MemoLinkSessionInfo {
  label: string;
  alive: boolean;
}

export interface MemoLinkHost {
  /** 이 화면의 내 입력(위→아래). 메뉴를 열 때 한 번 읽는다(구독 ❌). */
  prompts: () => readonly PromptRailEntry[];
  /** [다른 세션 ▸] 후보 — 이 화면 세션은 빠진다. 이름은 탭 줄과 같은 규칙(사용자 지정 → 기본). */
  sessions: () => readonly MemoLinkSessionOption[];
  sessionInfo: (sessionId: string | null) => MemoLinkSessionInfo;
  /** 내 입력 옆에 적을 시각(말풍선과 같은 `오늘 10:52` 표기). */
  formatTime: (at: number) => string;
  /** 이 화면 프로젝트의 루트(파일 고르기·경로 판정의 기준). 모르면 null. */
  rootPath: () => string | null;
  /** 링크를 따라간다. 갈 수 없으면 false(닫힌 세션·없는 파일·받을 수 없는 주소). */
  open: (target: SessionMemoLinkTarget) => Promise<boolean>;
}

export interface MemoLinkHostInputs {
  agentId: string;
  /** 이 화면(칸)의 세션 — null 이면 메인 탭. */
  activeSessionId: string | null;
  /** 커스텀 에이전트에는 메인 탭이 없다(탭 줄의 `!isCustom` 규칙). */
  isCustom: boolean;
  prompts: readonly PromptRailEntry[];
  /** 같은 화면 안에서 그 항목·그 글로 스크롤하고 칠한다(본문 소유). */
  jumpToStream: (anchorId: string | undefined, text: string) => void;
}

/** 그 세션이 지금 있나 — 메인 탭(null)은 훅 에이전트에만 있다. */
function sessionAlive(agentId: string, isCustom: boolean, sessionId: string | null): boolean {
  if (sessionId === null) return !isCustom;
  return (useGraphStore.getState().subAgents[agentId] ?? []).some((s) => s.id === sessionId);
}

/**
 * 파일 링크를 연다 — 본문 경로 링크와 **같은 판정·같은 창구**. 루트 안은 갈래대로(편집창·그림·앱·실행…),
 * 루트 밖은 시스템 탐색기 하나뿐이다(#17-27 ⑬ (d)). 디스크에 없으면 false.
 */
export async function openMemoFileLink(
  raw: string,
  rootPath: string | null,
  paneKey: string | null,
  runFailNote: string,
): Promise<boolean> {
  const candidate = toStreamPathCandidate(raw, rootPath);
  if (!candidate || !rootPath) return false;
  if (candidate.scope === 'inside') {
    const resolved = await resolveWorkspacePath(rootPath, candidate.relPath);
    if (resolved.kind === 'missing') return false;
    await openWorkspaceTarget(
      {
        relPath: candidate.relPath,
        absPath: resolved.absPath,
        kind: resolved.kind,
        ...(resolved.executable ? { executable: true } : {}),
        lines: candidate.lines,
      },
      rootPath,
      runFailNote,
      paneKey,
    );
    return true;
  }
  const outside = await resolveExternalPath(candidate.absPath);
  if (outside.kind === 'missing') return false;
  revealExternalPath(candidate.absPath);
  return true;
}

/** 웹 주소를 기본 브라우저로. 정화를 한 번 더 지난 주소만 연다(저장값이 손상돼도 `javascript:` 가 새지 않게). */
export function openMemoUrl(url: string): boolean {
  const safe = normalizeMemoLinkUrl(url);
  if (!safe || typeof window === 'undefined' || typeof window.open !== 'function') return false;
  try {
    window.open(safe, '_blank', 'noopener,noreferrer');
  } catch {
    return false;
  }
  return true;
}

export function useMemoLinkHost(inputs: MemoLinkHostInputs): MemoLinkHost {
  const { t, i18n } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const paneKey = useIDEPaneKey();
  const selectSession = useSelectSessionInSplit(useIDESlotKey());

  // 묶음의 정체를 고정하려고 최신 값은 전부 ref 로 읽는다(위 ⚠).
  const latest = useRef({ inputs, rootPath, paneKey, selectSession, t, language: i18n.language });
  latest.current = { inputs, rootPath, paneKey, selectSession, t, language: i18n.language };

  return useMemo<MemoLinkHost>(() => {
    const labelOf = (agentId: string, sessionId: string | null): string | null => {
      const { t: tt } = latest.current;
      if (sessionId === null) return tt('ide.tabbar.agentTabLabel');
      const st = useGraphStore.getState();
      const sub = (st.subAgents[agentId] ?? []).find((s) => s.id === sessionId);
      return sub ? (st.subAgentLabels[sub.id] ?? sub.label) : null;
    };
    return {
      prompts: () => latest.current.inputs.prompts,
      sessions: () => {
        const { agentId, activeSessionId, isCustom } = latest.current.inputs;
        const out: MemoLinkSessionOption[] = [];
        if (!isCustom && activeSessionId !== null) {
          out.push({ id: null, label: labelOf(agentId, null) ?? '' });
        }
        for (const sub of useGraphStore.getState().subAgents[agentId] ?? []) {
          if (sub.id === activeSessionId) continue;
          out.push({ id: sub.id, label: labelOf(agentId, sub.id) ?? sub.label });
        }
        return out;
      },
      sessionInfo: (sessionId) => {
        const { agentId, isCustom } = latest.current.inputs;
        const alive = sessionAlive(agentId, isCustom, sessionId);
        return { label: alive ? (labelOf(agentId, sessionId) ?? '') : '', alive };
      },
      formatTime: (at) => formatPromptStamp(at, latest.current.language)?.text ?? '',
      rootPath: () => latest.current.rootPath,
      open: async (target) => {
        const { inputs: cur, rootPath: root, paneKey: pk, selectSession: select, t: tt } = latest.current;
        switch (target.kind) {
          case 'stream': {
            if (target.sessionId === cur.activeSessionId) {
              cur.jumpToStream(target.anchorId, target.text);
              return true;
            }
            if (!sessionAlive(cur.agentId, cur.isCustom, target.sessionId)) return false;
            // 다른 세션의 자리 — 북마크 이동과 같은 길(그 창에 세션을 세우고, 선 다음에 그 자리로).
            useGraphStore.getState().openIDEOverlay(cur.agentId, {
              focus: {
                sessionId: target.sessionId,
                bookmark: { text: target.text, ...(target.anchorId ? { anchorId: target.anchorId } : {}) },
              },
            });
            return true;
          }
          case 'session': {
            if (!sessionAlive(cur.agentId, cur.isCustom, target.sessionId)) return false;
            select(target.sessionId);
            return true;
          }
          case 'file':
            return openMemoFileLink(target.path, root, pk, tt('ide.streamRenderer.pathLink.runFailed'));
          case 'url':
            return openMemoUrl(target.url);
        }
      },
    };
  }, []);
}
