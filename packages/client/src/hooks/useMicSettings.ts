import { useCallback, useEffect, useState } from 'react';
import { micSettingsTarget } from '@vibisual/shared';
import { clientOs } from '../utils/platform.js';
import { browserMicSettingsHint } from '../utils/microphoneSettings.js';

/** 마이크는 접속 기기의 것. 데스크톱 셸만 서버의 OS 설정을 열고 웹은 브라우저 권한을 안내한다. */
export interface MicSettingsHandle {
  /** 이 실행 환경에서 OS 마이크 설정 창을 열 수 있는가. */
  openable: boolean;
  /** 그 창에서 무엇을 만져야 하는지 가리키는 번역 키. 열 수 없어도 글로는 안내한다. */
  hintKey: string;
  /** 설정 창을 연다. 열지 못했으면 `false`(화면이 글 안내로 물러선다). */
  open: () => Promise<boolean>;
}

export function useMicSettings(): MicSettingsHandle {
  const desktop = typeof window !== 'undefined' && window.api !== undefined;
  const [openable, setOpenable] = useState(false);
  const [hintKey, setHintKey] = useState(() => desktop
    ? micSettingsTarget(clientOs()).hintKey
    : browserMicSettingsHint(typeof navigator === 'undefined' ? undefined : navigator));

  useEffect(() => {
    // 원격 웹에서 이 API 를 호출하면 폰 대신 서버 PC 의 설정을 열게 된다.
    if (!desktop) return;
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const res = await fetch('/api/mic-settings');
        if (!res.ok) return;
        const body = (await res.json()) as { openable?: boolean; hintKey?: string };
        if (!alive) return;
        setOpenable(body.openable === true);
        if (typeof body.hintKey === 'string' && body.hintKey.length > 0) setHintKey(body.hintKey);
      } catch {
        /* 서버에 못 닿는 판 — 단정하지 않는다(버튼을 안 그릴 뿐 안내문은 남는다). */
      }
    })();
    return () => { alive = false; };
  }, [desktop]);

  const open = useCallback(async (): Promise<boolean> => {
    if (!desktop) return false;
    try {
      const res = await fetch('/api/mic-settings/open', { method: 'POST' });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  }, [desktop]);

  return { openable, hintKey, open };
}
