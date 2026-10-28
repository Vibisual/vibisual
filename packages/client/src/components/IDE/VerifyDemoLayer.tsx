import { memo, useCallback } from 'react';
import type { CaptureSourceInfo } from '@vibisual/shared';

import { useVerifyDemoStore } from '../../stores/verifyDemo.js';
import { CaptureSourcePicker } from '../BubbleMap/CaptureSourcePicker.js';
import { VerifyRecorderHost } from './VerifyRecorderHost.js';
import { VerifyDemoWindow } from './VerifyDemoWindow.js';

// §5.5 #17-35 ⑨⑩ — 시연 녹화 상시 층(녹화 호스트 · §5.9 피커 그대로 · 시연 창). 검증 뷰가 아니라 여기 둔다 — 뷰가 접혀도 녹화가 끊기면 안 된다.

export const VerifyDemoLayer = memo(function VerifyDemoLayer(): React.JSX.Element {
  const pickerFor = useVerifyDemoStore((s) => s.pickerFor);
  const closePicker = useVerifyDemoStore((s) => s.closePicker);
  const setSource = useVerifyDemoStore((s) => s.setSource);
  const setTarget = useVerifyDemoStore((s) => s.setTarget);
  const startRecording = useVerifyDemoStore((s) => s.startRecording);
  const demoWindow = useVerifyDemoStore((s) => s.window);
  const closeWindow = useVerifyDemoStore((s) => s.closeWindow);

  const handlePick = useCallback((src: CaptureSourceInfo) => {
    if (!pickerFor) return;
    setSource(pickerFor.subAgentId, { sourceId: src.id, sourceName: src.name, sourceKind: src.kind });
    if (pickerFor.purpose === 'connect') {
      setTarget(pickerFor.subAgentId, { kind: 'desktop', sourceId: src.id, sourceName: src.name, sourceKind: src.kind });
    }
    closePicker();
    // 시연을 찍으려고 연 피커면 고른 즉시 녹화로 이어진다 — 고르고 다시 [녹화]를 누르게 하면
    // 그 사이에 화면이 이미 바뀐다(사용자가 보여 주려던 그 순간을 놓친다).
    if (pickerFor.purpose === 'demo') {
      startRecording({ agentId: pickerFor.agentId, subAgentId: pickerFor.subAgentId, purpose: 'demo' });
    }
  }, [closePicker, pickerFor, setSource, setTarget, startRecording]);

  return (
    <>
      <VerifyRecorderHost />
      <CaptureSourcePicker open={!!pickerFor} onClose={closePicker} onPick={handlePick} />
      {demoWindow && (
        <VerifyDemoWindow
          agentId={demoWindow.agentId}
          subAgentId={demoWindow.subAgentId}
          clipId={demoWindow.clipId}
          mode={demoWindow.mode}
          onClose={closeWindow}
        />
      )}
    </>
  );
});
