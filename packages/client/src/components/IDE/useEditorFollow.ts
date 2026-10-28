import { useEffect, useMemo, useRef } from 'react';
import { selectIDEOverlay, useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneActions } from './idePane.js';
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
 * §5.5 #17-27 ⑪ [추종]의 여는 쪽 — 편집창은 연 파일이 없으면 렌더되지 않아 **편집창 밖**에 산다(다시 읽기·스크롤은 편집창).
 * 지금 열린 세션(전체 보기면 모든 세션)의 Edit 계열 도구 이벤트를 따른다(새 구독·REST ❌).
 * **꺼져 있어도 돈다** — "켜면 갈 곳"을 기억하고(`ideEditorFollowPending`), 못 따라가면 이유를 자국에 남긴다. 기억은 화면에 상주시키지 않는다.
 */
export function useEditorFollow(agentId: string, activeSessionId: string | null, narrow: boolean): void {
  const sessionKey = followSessionKey(agentId, activeSessionId);
  const enabled = useGraphStore((s) => s.ideEditorFollow[sessionKey] === true);
  const subAgents = useGraphStore((s) => (agentId ? s.subAgents[agentId] : undefined));

  // 볼 스트림 — 세션 탭이면 그 세션 하나, 전체 보기면 이 에이전트의 모든 세션.
  const watchedIds = useMemo(
    () => (activeSessionId !== null ? [activeSessionId] : (subAgents ?? []).map((sa) => sa.id)),
    [activeSessionId, subAgents],
  );

  // §9 **자기 키까지 내려가 구독한다** — `s.subAgentStreams` 맵은 줄마다 새 참조라, 통째로 구독하면 모든 IDE 창이 50ms(`WS_STREAM_BATCH_INTERVAL`)마다
  // `FOLLOW_SCAN_LIMIT` 건을 다시 훑는다. 보는 세션의 원시 문자열 하나(합계 길이 : 가장 늦은 시각)만 구독한다.
  const streamsVersion = useGraphStore((s) => {
    let total = 0;
    let newest = 0;
    for (const id of watchedIds) {
      const arr = s.subAgentStreams[id];
      if (!arr || arr.length === 0) continue;
      total += arr.length;
      const ts = arr[arr.length - 1]!.timestamp;
      if (ts > newest) newest = ts;
    }
    return `${total}:${newest}`;
  });
  const { openEditorFile: openFile } = useIDEPaneActions();
  const setSignal = useGraphStore((s) => s.setIdeEditorFollowSignal);
  const setLast = useGraphStore((s) => s.setIdeEditorFollowLast);
  const setPending = useGraphStore((s) => s.setIdeEditorFollowPending);
  const editorOpen = useIDEPaneValue((o) => o.activeEditorPath !== null);
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

    // 버퍼 자체는 구독하지 않고 **깨어난 그 시점의 최신값**을 읽는다(위 `streamsVersion` 참조).
    const streams = useGraphStore.getState().subAgentStreams;
    const sessionIds = watchedIds;

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
    enabled, agentId, activeSessionId, sessionKey, streamsVersion, watchedIds,
    rootPath, narrow, editorOpen, openFile, setSignal, setLast, setPending,
  ]);
}
