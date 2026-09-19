/**
 * §5.3 #12-1 · #12-2 — **서버에 걸려 있는 권한 요청·질문 카드를 다시 받아 온다.**
 *
 * 두 카드는 WS 로 한 번(`permission_request` · `ask_user_question`) 오고 끝이다. 새 연결이 받는 것은
 * ack + 전체 스냅샷뿐이라, 끊겨 있던 동안 걸린 카드는 다시 오지 않는다 — 폰 화면을 끈 사이 에이전트가
 * 권한을 물으면 화면을 다시 켜도 카드가 없어 작업이 멈춘 것처럼 보였다. 그 사이 풀린 카드는 반대로
 * 남아 있게 된다. 목록은 서버가 정본이므로 통째로 갈아 끼운다.
 *
 * 부팅(`PermissionPromptStack`)과 재연결(`reconnectResync.ts`)이 이 한 벌을 같이 쓴다.
 */
import type { AskUserQuestionRequest, PermissionRequest } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

export function restorePendingPrompts(isCancelled: () => boolean = () => false): void {
  fetch('/api/permission-pending')
    .then((r) => r.json())
    .then((data: { ok: boolean; pending?: PermissionRequest[] }) => {
      if (isCancelled() || !data.ok) return;
      useGraphStore.getState().setPendingPermissions(data.pending ?? []);
    })
    .catch(() => {});
  fetch('/api/ask-user-question/pending')
    .then((r) => r.json())
    .then((data: { ok: boolean; pending?: AskUserQuestionRequest[] }) => {
      if (isCancelled() || !data.ok) return;
      useGraphStore.getState().setPendingAskQuestions(data.pending ?? []);
    })
    .catch(() => {});
}
