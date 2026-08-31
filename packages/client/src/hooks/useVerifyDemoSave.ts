import { useCallback, useState } from 'react';
import { VERIFICATION_DEMO_FRAMES_MAX } from '@vibisual/shared';
import type { VerificationDemoStep } from '@vibisual/shared';

import { useGraphStore } from '../stores/graphStore.js';
import type { PlaytestClip } from '../stores/capturePlaytest.js';
import { demoFrameTimes, type ClipRange } from '../components/BubbleMap/playtestClip.js';
import { extractClipFrames } from './clipFrames.js';

// §5.5 #17-35 ⑨ — 시연을 **검증 절차로 저장**한다.
//
// 순서는 서버 REST 규약 그대로 **레코드 먼저, 그림 나중**이다(⑨ REST). 그림은 몇 장이 될지 여기서
// 뽑아 봐야 알고, 한 장씩 올라가는 동안 사용자는 진행을 봐야 한다.
//
// 첨부 레일(§5.9 `useCapturePlaytestAttach`)과 **다른 곳에 올린다** — 그쪽은 입력창 draft 로 가는
// 일회성 그림이고, 이쪽은 다음 검증에도 계속 실릴 절차의 일부라 수명이 다르다(⑨-3).

export interface VerifyDemoSaveProgress {
  done: number;
  total: number;
}

export interface VerifyDemoSaveInput {
  agentId: string;
  subAgentId: string;
  clip: PlaytestClip;
  /** 사용자가 손잡이로 좁힌 구간. 프레임은 이 안에서만 뽑는다. */
  range: ClipRange;
  frameCount: number;
  label: string;
  steps: VerificationDemoStep[];
  expected?: string;
}

export interface VerifyDemoSave {
  busy: boolean;
  progress: VerifyDemoSaveProgress | null;
  /** 실패 사유 한 줄(조용한 무동작 ❌). i18n 키로 쓰이는 짧은 코드 또는 원문. */
  error: string | null;
  clearError: () => void;
  /** 저장한다. 성공하면 붙은 그림 장수, 실패하면 null. */
  save: (input: VerifyDemoSaveInput) => Promise<number | null>;
}

export function useVerifyDemoSave(): VerifyDemoSave {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<VerifyDemoSaveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createDemo = useGraphStore((s) => s.createVerificationDemo);
  const uploadFrame = useGraphStore((s) => s.uploadVerificationDemoFrame);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback(async (input: VerifyDemoSaveInput): Promise<number | null> => {
    setError(null);
    setBusy(true);
    const count = Math.max(0, Math.min(input.frameCount, VERIFICATION_DEMO_FRAMES_MAX));
    // 사람이 표시한 단계가 있으면 **그 순간**을 찍는다 — 프롬프트가 단계와 그림을 시각으로 짝지으므로
    // 등간격으로 뽑으면 그 짝이 거짓이 된다(⑨-4 `demoFrameTimes`).
    const times = count > 0 ? demoFrameTimes(input.range, count, input.steps.map((s) => s.atMs)) : [];
    setProgress({ done: 0, total: times.length });
    try {
      // 그림을 먼저 뽑는다 — 여기서 한 장도 못 뽑으면 레코드를 만들기 전에 멈춘다(빈 시연 방지).
      const frames = times.length > 0
        ? await extractClipFrames(
          input.clip,
          times,
          (index) => `${index}.png`,
          (done) => setProgress({ done, total: times.length }),
        )
        : [];
      if (times.length > 0 && frames.length === 0) {
        setError('noFrames');
        return null;
      }

      const created = await createDemo({
        agentId: input.agentId,
        subAgentId: input.subAgentId,
        label: input.label,
        sourceName: input.clip.sourceName,
        steps: input.steps,
        ...(input.expected ? { expected: input.expected } : {}),
        durationMs: Math.max(0, input.range.endMs - input.range.startMs),
      });
      if (typeof created === 'string') {
        setError(created);
        return null;
      }

      // 순서대로 올린다 — 서버가 붙는 순번으로 파일 이름을 짓기 때문에 병렬로 쏘면 순서가 섞인다.
      // 시각은 `times[i]` 가 아니라 **그 장이 실제로 찍힌 시각**을 쓴다(못 뽑은 장이 있으면 어긋난다).
      let attached = 0;
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        const ok = await uploadFrame(created.id, frame.file, Math.max(0, frame.timeMs - input.range.startMs));
        if (ok) attached += 1;
        setProgress({ done: i + 1, total: frames.length });
      }
      // 그림이 하나도 안 붙어도 절차(단계·기대 결과)는 이미 저장됐다 — 지우지 않는다.
      if (frames.length > 0 && attached === 0) setError('uploadFailed');
      return attached;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'saveFailed');
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [createDemo, uploadFrame]);

  return { busy, progress, error, clearError, save };
}
