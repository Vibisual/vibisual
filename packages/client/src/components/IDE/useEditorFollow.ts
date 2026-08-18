import { useEffect, useRef } from 'react';
import { selectIDEOverlay, useGraphStore } from '../../stores/graphStore.js';
import {
  followOpenSkipReason,
  followSessionKey,
  latestCompletedEdit,
  newestEventTimestamp,
  type CompletedEdit,
} from './editorFollow.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';

/**
 * useEditorFollow.ts — §5.5 #17-27 ⑪ [추종] 토글의 **여는 쪽**.
 *
 * 편집창(`IDEEditorPane`)은 열어 둔 파일이 하나도 없으면 아예 렌더되지 않으므로(#17-27 ①),
 * "새 편집이 왔으니 파일을 열어라" 를 그 안에서 들을 수가 없다. 그래서 이 훅은 **편집창 밖**
 * (IDE 오버레이 본체)에 산다 — 여기서 열고, 다시 읽기·스크롤·강조는 편집창이 신호를 받아 한다.
 *
 * (g) — 보는 것은 **지금 열려 있는 세션**이므로 따라가는 것도 그 세션이다. 신호의 출처는 그 세션의
 * 스트림에 이미 흐르는 Edit 계열 도구 이벤트(diff 카드가 쓰는 그것)이고, 새 구독·새 REST 는 없다.
 * 세션 탭이 없는 전체 보기에서는 그 에이전트의 모든 세션을 본다(그 화면이 실제로 모두를 보여 준다).
 *
 * (h) — 이 훅은 **꺼져 있을 때도 돈다**. 꺼져 있으면 따라가는 대신 "켜면 갈 곳" 한 건을 기억해 두고
 * (`ideEditorFollowPending` — 켜는 순간 그리로 데려간다), 켜져 있는데 못 따라갔으면 **그 이유**를 자국에
 * 남긴다 — 조용히 넘어가면 사용자에게 "고장" 과 "따라갈 것이 없음" 이 같은 그림이 된다.
 * 기억은 **화면에 상주하지 않는다**(건수 배지는 스캔 창 밖으로 밀릴 때마다 흔들려 걷어냈다).
 */
export function useEditorFollow(agentId: string, activeSessionId: string | null, narrow: boolean): void {
  const sessionKey = followSessionKey(agentId, activeSessionId);
  const enabled = useGraphStore((s) => s.ideEditorFollow[sessionKey] === true);
  const streams = useGraphStore((s) => s.subAgentStreams);
  const subAgents = useGraphStore((s) => (agentId ? s.subAgents[agentId] : undefined));
  const openFile = useGraphStore((s) => s.openIDEEditorFile);
  const setSignal = useGraphStore((s) => s.setIdeEditorFollowSignal);
  const setLast = useGraphStore((s) => s.setIdeEditorFollowLast);
  const setPending = useGraphStore((s) => s.setIdeEditorFollowPending);
  const editorOpen = useGraphStore((s) => selectIDEOverlay(s).activeEditorPath !== null);
  const rootPath = useIDEProjectRoot();

  /**
   * 여기까지는 이미 따라갔다는 기준선(편집 **완료** 시각).
   * `null` = 아직 기준선을 잡기 전 — 토글을 켠 **그 순간의 최신 이벤트**로 채우고 넘어간다.
   * 그래야 켜자마자 옛 편집으로 화면이 튀지 않는다(#17-27 ⑪ (e)).
   */
  const seenRef = useRef<number | null>(null);
  /** 꺼져 있는 동안의 기준선 — 배지가 세는 "끈 뒤로 쌓인" 편집의 시작점. 켜짐 기준선과 섞이면 안 된다. */
  const offSeenRef = useRef<number | null>(null);

  // 끄거나 켜거나 세션을 옮기면 기준선을 버린다 — 다른 세션에서 쌓인 편집을 몰아서 따라가지 않게.
  useEffect(() => {
    seenRef.current = null;
    offSeenRef.current = null;
  }, [enabled, sessionKey]);

  useEffect(() => {
    if (!agentId) return;

    // 볼 스트림 고르기 — 세션 탭이면 그 세션 하나, 전체 보기면 이 에이전트의 모든 세션.
    const sessionIds = activeSessionId !== null
      ? [activeSessionId]
      : (subAgents ?? []).map((sa) => sa.id);

    /** 지금 스트림들의 가장 최근 시각 — 기준선을 처음 잡을 때 쓴다. */
    const newestAcross = (): number => {
      let newest = 0;
      for (const id of sessionIds) {
        const ts = newestEventTimestamp(streams[id] ?? []);
        if (ts > newest) newest = ts;
      }
      return newest;
    };

    /** 기준선 이후 완료된 편집 중 **가장 최근 한 건** — 세션들에 걸쳐 고른다. */
    const scanAcross = (since: number): CompletedEdit | null => {
      let latest: CompletedEdit | null = null;
      for (const id of sessionIds) {
        const found = latestCompletedEdit(streams[id] ?? [], since);
        if (found && (!latest || found.at > latest.at)) latest = found;
      }
      return latest;
    };

    // ── 꺼져 있을 때 — 따라가지 않고, "켜면 볼 것이 있다" 만 세어 둔다 ──────────────────
    if (!enabled) {
      if (offSeenRef.current === null) {
        offSeenRef.current = newestAcross();
        setPending(null);
        return;
      }
      const latest = scanAcross(offSeenRef.current);
      if (!latest) return;
      const file = editorFileFromAbsPath(latest.filePath, rootPath);
      // 켜도 못 따라갈 편집은 담아 두지 않는다 — 켰는데 아무 일도 없으면 그 기억이 거짓말이 된다.
      if (followOpenSkipReason(file.relPath, narrow, editorOpen) !== null) return;
      setPending({
        sessionKey,
        relPath: file.relPath,
        absPath: file.absPath,
        name: file.name,
        newString: latest.newString,
        at: latest.at,
      });
      return;
    }

    // ── 켜져 있을 때 — 완료가 확인된 마지막 편집을 따라간다 ────────────────────────────
    if (seenRef.current === null) {
      seenRef.current = newestAcross();
      return;
    }

    const latest = scanAcross(seenRef.current);
    if (!latest) return;
    // 따라갈 수 없는 편집이어도 기준선은 넘긴다 — 같은 편집을 매 갱신마다 다시 판정하지 않게.
    seenRef.current = latest.at;

    const file = editorFileFromAbsPath(latest.filePath, rootPath);
    const skip = followOpenSkipReason(file.relPath, narrow, editorOpen);
    if (skip) {
      // 못 따라갔어도 **무엇을 왜 못 따라갔는지**는 남긴다(추종 띠·상태바 칩이 이 자국을 읽는다).
      setLast({
        sessionKey,
        relPath: file.relPath,
        absPath: file.absPath,
        name: file.name,
        startLine: null,
        endLine: null,
        reloaded: false,
        at: latest.at,
        skip,
      });
      return;
    }

    openFile(file);
    setSignal({
      sessionKey,
      relPath: file.relPath,
      absPath: file.absPath,
      newString: latest.newString,
      at: latest.at,
    });
  }, [
    enabled, agentId, activeSessionId, sessionKey, streams, subAgents,
    rootPath, narrow, editorOpen, openFile, setSignal, setLast, setPending,
  ]);
}
