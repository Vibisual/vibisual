import { useMemo } from 'react';
import { ImageLightboxView } from '../components/IDE/ImageAnnotator.js';

/** 메모 첨부는 불변 판본에 속하므로 편집 결과는 공용 도구의 복사·내려받기로 내보낸다. */
export function MemoImageEditor({ src, close }: { src: string; close: () => void }): React.JSX.Element {
  const state = useMemo(() => ({ url: src, origin: { slot: 'memo', cell: null } }), [src]);
  return <ImageLightboxView state={state} agentId="" activeSessionId={null} canAttach={false} onClose={close} />;
}
