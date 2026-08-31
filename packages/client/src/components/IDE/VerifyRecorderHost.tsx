import { memo, useEffect, useRef, useState } from 'react';

import { useCaptureStream } from '../../hooks/useCaptureStream.js';
import { useCaptureRecorder } from '../../hooks/useCaptureRecorder.js';
import { useCapturePlaytestStore } from '../../stores/capturePlaytest.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useVerifyDemoStore, verifyRecorderKey, type VerifyRecordingTarget } from '../../stores/verifyDemo.js';

// §5.5 #17-35 ⑨⑩ — 시연 녹화 **호스트**(화면에 아무것도 그리지 않는다).
//
// 왜 따로 있는가: 녹화기를 검증 뷰(사이드바)가 쥐면, 활동바에서 다른 항목을 눌러 그 뷰가 접히는
// 순간 언마운트 정리가 녹화를 끊는다 — ⑩(검증이 도는 동안의 화면)은 몇 분씩 도는 일이라 그 사이
// 사용자가 사이드바를 한 번도 안 건드릴 거라고 가정할 수 없다. 그래서 **IDE 가 열려 있는 동안 늘
// 살아 있는 자리**에 스트림과 녹화기를 두고, 사이드바는 스토어를 통해 상태만 본다.
//
// 재사용만 한다(⑨-1) — `useCaptureStream`(getUserMedia desktop) · `useCaptureRecorder`(MediaRecorder
// + 길이 상한 자동 정지) · `capturePlaytest`(클립 보관·개수 상한). 새 캡처 레이어 ❌.

/** 멈춤을 걸어 둔 뒤 **클립이 실제로 나오기를** 기다리는 동안 들고 있는 것. */
interface PendingClose {
  target: VerifyRecordingTarget;
  /** 멈추기 직전에 맨 앞에 있던 클립 id — 새 클립이 나왔는지 판정하는 기준. */
  previousTopClipId: string | undefined;
}

export const VerifyRecorderHost = memo(function VerifyRecorderHost(): React.JSX.Element | null {
  const target = useVerifyDemoStore((s) => s.recordingFor);
  const sourceMap = useVerifyDemoStore((s) => s.source);
  const setStream = useVerifyDemoStore((s) => s.setStream);
  const stopRecordingTarget = useVerifyDemoStore((s) => s.stopRecording);
  const openWindow = useVerifyDemoStore((s) => s.openWindow);
  const setRunClip = useVerifyDemoStore((s) => s.setRunClip);

  // 멈춤을 걸어 둔 뒤 클립이 나오기를 기다리는 동안 들고 있는 것(아래 "새 클립이 나왔을 때" 참조).
  //
  // ref 가 아니라 **state** 인 이유: 아래 구독이 "어느 키의 클립을 기다릴지"를 렌더에서 정하므로,
  // ref 로 두면 그 값이 바뀌어도 다시 렌더되지 않아 구독이 영영 빈 키를 본다(클립이 나와도 못 듣는다).
  const [pending, setPending] = useState<PendingClose | null>(null);

  const subAgentId = target?.subAgentId ?? pending?.target.subAgentId ?? '';
  const source = subAgentId ? sourceMap[subAgentId] : undefined;
  const recorderKey = subAgentId ? verifyRecorderKey(subAgentId) : 'verify:idle';
  // 대상이 사라진 뒤에도 같은 소스로 스트림을 잡고 있어야 마지막 조각이 안 잘린다.
  const lastSourceIdRef = useRef<string | undefined>(undefined);
  if (source?.sourceId) lastSourceIdRef.current = source.sourceId;

  // 대상이 없으면 스트림을 붙이지 않는다 — 안 찍는 동안 화면을 계속 읽으면 CPU 만 태운다.
  //
  // 다만 **멈춘 뒤에도 클립이 나올 때까지는 놓지 않는다**(`pending`): 트랙을 먼저 끊으면 마지막
  // 조각이 잘려 나가고, 사용자는 자기가 마지막에 보여 준 그 동작이 빠진 줄 모른다.
  const holdStream = !!target || !!pending;
  const { stream, error: streamError } = useCaptureStream(source?.sourceId ?? lastSourceIdRef.current, holdStream);

  const recorder = useCaptureRecorder({
    captureBubbleId: recorderKey,
    sourceName: source?.sourceName ?? '',
    stream,
  });

  // 사이드바 미리보기가 이 스트림을 건다(호스트는 화면을 그리지 않는다).
  useEffect(() => {
    setStream(stream, streamError);
  }, [setStream, stream, streamError]);

  // 스트림이 붙으면 녹화를 시작한다. 스트림 획득은 비동기라 "시작 눌렀는데 아무 일도 없음"을
  // 피하려면 여기서 이어 붙여야 한다(누른 시점엔 아직 스트림이 없다).
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !stream) return;
    const token = `${target.subAgentId}:${target.purpose}:${target.runId ?? ''}`;
    if (startedForRef.current === token) return;
    startedForRef.current = token;
    recorder.start();
  }, [recorder, stream, target]);

  // 대상이 사라지면(사용자가 [정지], 또는 그 검증이 닫힘) 녹화기를 마감한다.
  //
  // **클립은 여기서 바로 집을 수 없다** — `MediaRecorder.stop()` 은 즉시 끝나지 않고 `onstop` 이
  // 한 틱 뒤에 온다. 그 자리에서 목록 맨 앞을 읽으면 방금 찍은 것이 아니라 **직전 클립**(또는 아무것도)
  // 을 집는다. 그래서 무엇을 기다리는지만 적어 두고, 실제 처리는 아래 "새 클립이 나왔을 때" 로 미룬다.
  const prevTargetRef = useRef<VerifyRecordingTarget | null>(null);
  useEffect(() => {
    const prev = prevTargetRef.current;
    prevTargetRef.current = target;
    if (!prev || target) return;
    startedForRef.current = null;
    const key = verifyRecorderKey(prev.subAgentId);
    setPending({
      target: prev,
      previousTopClipId: useCapturePlaytestStore.getState().clips[key]?.[0]?.id,
    });
    recorder.stop();
  }, [recorder, target]);

  // 새 클립이 나왔다 — 무엇을 기다리고 있었는지에 따라 갈린다.
  const pendingKey = pending ? verifyRecorderKey(pending.target.subAgentId) : '';
  const topClipId = useCapturePlaytestStore((s) => (pendingKey ? s.clips[pendingKey]?.[0]?.id : undefined));
  useEffect(() => {
    if (!pending || !topClipId || topClipId === pending.previousTopClipId) return;
    setPending(null);
    if (pending.target.purpose === 'demo') {
      // 절차로 만들 차례다 — 멈춘 사람이 다음에 할 일이 그것이다.
      openWindow({
        agentId: pending.target.agentId,
        subAgentId: pending.target.subAgentId,
        clipId: topClipId,
        mode: 'save',
      });
    } else if (pending.target.runId) {
      // ⑩ 증거 — 그 줄에 [화면 보기] 가 붙는다. 판정에는 영향을 주지 않는다.
      setRunClip(pending.target.runId, topClipId);
    }
  }, [openWindow, pending, setRunClip, topClipId]);

  // ⑩ — 검증이 닫히면(판정·중지·오류 무엇이든) 스스로 멈춘다. 사람이 다시 누를 필요가 없다.
  const runs = useGraphStore((s) => (subAgentId ? s.verificationRuns[subAgentId] : undefined));
  useEffect(() => {
    if (!target || target.purpose !== 'run' || !target.runId) return;
    const run = runs?.find((r) => r.id === target.runId);
    // 목록에서 아예 사라졌으면(사용자가 지움) 그것도 끝난 것이다.
    if (!run || (run.status !== 'running' && run.status !== 'queued')) stopRecordingTarget();
  }, [runs, stopRecordingTarget, target]);

  return null;
});
