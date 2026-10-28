import { memo, useEffect, useRef, useState } from 'react';

import { useCaptureStream } from '../../hooks/useCaptureStream.js';
import { useCaptureRecorder } from '../../hooks/useCaptureRecorder.js';
import { useCapturePlaytestStore } from '../../stores/capturePlaytest.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useVerifyDemoStore, verifyRecorderKey, type VerifyRecordingTarget } from '../../stores/verifyDemo.js';

// §5.5 #17-35 ⑨⑩ — 시연 녹화 호스트(그리지 않는다). 검증 뷰가 녹화기를 쥐면 뷰가 접힐 때 언마운트가 녹화를 끊는다 — IDE 가 열린 동안 사는 자리에 둔다.
// 재사용만(⑨-1): `useCaptureStream` · `useCaptureRecorder` · `capturePlaytest`. 새 캡처 레이어 ❌.

/** 멈춤을 걸어 둔 뒤 **클립이 실제로 나오기를** 기다리는 동안 들고 있는 것. */
interface PendingClose {
  target: VerifyRecordingTarget;
  /** 멈추기 직전에 맨 앞에 있던 클립 id — 새 클립이 나왔는지 판정하는 기준. */
  previousTopClipId: string | undefined;
  waitingForClip: boolean;
}

export const VerifyRecorderHost = memo(function VerifyRecorderHost(): React.JSX.Element | null {
  const target = useVerifyDemoStore((s) => s.recordingFor);
  const sourceMap = useVerifyDemoStore((s) => s.source);
  const setStream = useVerifyDemoStore((s) => s.setStream);
  const stopRecordingTarget = useVerifyDemoStore((s) => s.stopRecording);
  const openWindow = useVerifyDemoStore((s) => s.openWindow);
  const setRunClip = useVerifyDemoStore((s) => s.setRunClip);

  // 멈춘 뒤 클립을 기다리는 동안의 값 — state 여야 한다(구독이 렌더에서 키를 정해, ref 면 빈 키만 본다).
  const [pending, setPending] = useState<PendingClose | null>(null);
  const prevTargetRef = useRef<VerifyRecordingTarget | null>(null);
  const previousTopClipIdRef = useRef<string | undefined>(undefined);
  const [preparedTarget, setPreparedTarget] = useState<VerifyRecordingTarget | null>(null);
  const [attemptedTarget, setAttemptedTarget] = useState<VerifyRecordingTarget | null>(null);

  const subAgentId = target?.subAgentId ?? pending?.target.subAgentId ?? prevTargetRef.current?.subAgentId ?? '';
  const source = subAgentId ? sourceMap[subAgentId] : undefined;
  const recorderKey = subAgentId ? verifyRecorderKey(subAgentId) : 'verify:idle';
  // 대상이 사라진 뒤에도 같은 소스로 스트림을 잡고 있어야 마지막 조각이 안 잘린다.
  const lastSourceIdRef = useRef<string | undefined>(undefined);
  if (source?.sourceId) lastSourceIdRef.current = source.sourceId;

  // 대상이 없으면 스트림을 붙이지 않는다(CPU). 단 멈춘 뒤 클립이 나올 때까지(`pending`, 정지 요청 직후 렌더 포함)는 트랙을 쥔다 — 먼저 끊으면 마지막 조각이 잘린다.
  const holdStream = !!target || !!pending || !!prevTargetRef.current;
  const { stream, error: streamError } = useCaptureStream(source?.sourceId ?? lastSourceIdRef.current, holdStream);

  const recorder = useCaptureRecorder({
    captureBubbleId: recorderKey,
    sourceName: source?.sourceName ?? '',
    stream,
  });

  // 사이드바 미리보기가 이 스트림을 건다(호스트는 화면을 그리지 않는다).
  useEffect(() => {
    setStream(stream, streamError ?? recorder.error);
  }, [recorder.error, setStream, stream, streamError]);

  // 스트림이 붙으면 녹화를 시작한다. 스트림 획득은 비동기라 "시작 눌렀는데 아무 일도 없음"을
  // 피하려면 여기서 이어 붙여야 한다(누른 시점엔 아직 스트림이 없다).
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!target) return;
    // 스트림 도착 전에 취소해도 이전 회차의 클립을 새 것으로 오인하지 않는다.
    previousTopClipIdRef.current = useCapturePlaytestStore.getState().clips[verifyRecorderKey(target.subAgentId)]?.[0]?.id;
    startedForRef.current = null;
    recorder.clearError();
    setPreparedTarget(target);
  }, [target, recorder.clearError]);
  useEffect(() => {
    if (!target || preparedTarget !== target || !stream) return;
    const token = `${target.subAgentId}:${target.purpose}:${target.runId ?? ''}`;
    if (startedForRef.current === token) return;
    startedForRef.current = token;
    recorder.start();
    setAttemptedTarget(target);
  }, [preparedTarget, recorder, stream, target]);

  useEffect(() => {
    if (!target || preparedTarget !== target) return;
    if (streamError || (attemptedTarget === target && recorder.error && !recorder.recording)) {
      stopRecordingTarget();
    }
  }, [attemptedTarget, preparedTarget, recorder.error, recorder.recording, stopRecordingTarget, streamError, target]);

  // 길이 제한·소스 종료도 onstop 으로 클립을 만든다. target 을 먼저 내리는 수동 정지만
  // 기다리면 자동 종료된 시연은 창으로 이어지지 않고, 뒤늦은 정지는 없는 다음 클립을 기다린다.
  const recordedClipId = useCapturePlaytestStore((s) => s.clips[recorderKey]?.[0]?.id);
  useEffect(() => {
    if (target && startedForRef.current && recordedClipId && recordedClipId !== previousTopClipIdRef.current) {
      stopRecordingTarget();
    }
  }, [recordedClipId, stopRecordingTarget, target]);

  // 대상이 사라지면 녹화기를 마감만 한다 — `stop()` 뒤 `onstop` 이 한 틱 늦어 여기서 집으면 직전 클립이다. 처리는 "새 클립이 나왔을 때" 에서.
  useEffect(() => {
    const prev = prevTargetRef.current;
    prevTargetRef.current = target;
    if (!prev || target) return;
    startedForRef.current = null;
    const key = verifyRecorderKey(prev.subAgentId);
    const state = useCapturePlaytestStore.getState();
    // 스트림을 얻기 전에 취소했거나 녹화기 생성에 실패했다면 기다릴 클립도 없다.
    setPending({
      target: prev,
      previousTopClipId: previousTopClipIdRef.current,
      waitingForClip: !!state.recording[key],
    });
    recorder.stop();
  }, [recorder, target]);

  // 새 클립이 나왔다 — 무엇을 기다리고 있었는지에 따라 갈린다.
  const pendingKey = pending ? verifyRecorderKey(pending.target.subAgentId) : '';
  const topClipId = useCapturePlaytestStore((s) => (pendingKey ? s.clips[pendingKey]?.[0]?.id : undefined));
  useEffect(() => {
    if (!pending) return;
    if (!topClipId || topClipId === pending.previousTopClipId) {
      if (!pending.waitingForClip || (recorder.error && !recorder.recording)) setPending(null);
      return;
    }
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
  }, [openWindow, pending, recorder.error, recorder.recording, setRunClip, topClipId]);

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
