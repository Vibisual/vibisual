import { useCallback, useState } from 'react';

import { studioCommand } from './studioCommands.js';
import type { StudioCommandContext } from './studioCommandTypes.js';
import { pushRecent } from './studioPaletteModel.js';

export interface StudioPaletteHost {
  readonly open: boolean;
  readonly openPalette: () => void;
  readonly close: () => void;
  /** 이 창에서 최근 실행한 명령(창 세션 동안만 — 저장하지 않는다, §3.2). */
  readonly recent: readonly string[];
  /** 팔레트를 닫고 그 명령을 실행한다 — 키로 부를 때와 같은 `run`·같은 조건. */
  readonly run: (context: StudioCommandContext, id: string, arg?: string) => void;
}

/** §5.13 (V) 37-22 — 팔레트 열림·최근 명령(셸 로컬 상태). */
export function useStudioPalette(): StudioPaletteHost {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const openPalette = useCallback((): void => setOpen(true), []);
  const close = useCallback((): void => setOpen(false), []);
  const run = useCallback((context: StudioCommandContext, id: string, arg?: string): void => {
    const command = studioCommand(id);
    setOpen(false);
    if (!command || (command.enabled && !command.enabled(context))) return;
    setRecent((r) => pushRecent(r, id));
    command.run(context, { shift: false, ...(arg !== undefined ? { arg } : {}) });
  }, []);
  return { open, openPalette, close, recent, run };
}
