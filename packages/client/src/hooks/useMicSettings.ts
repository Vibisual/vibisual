import { useCallback, useEffect, useState } from 'react';

/**
 * useMicSettings — **§5.5 #17-38 ⑮ "OS 설정 창을 열 수 있는가"를 서버에게 묻는 손잡이.**
 *
 * 판정을 클라이언트가 흉내 내지 않는 이유는 `useVoiceAsr` 와 같다 — 열 수 있는지는 **이 앱이
 * 어떤 형태로 떠 있는가**(데스크톱 앱인가 웹 단독인가)와 **어느 OS 인가**에 달렸고, 그 둘을
 * 아는 것은 서버뿐이다. 화면이 `navigator.platform` 으로 짐작하면 웹 접속 모드에서 **접속한
 * 기기의 OS** 를 보게 되어(폰에서 붙으면 안드로이드) 엉뚱한 안내가 뜬다.
 *
 * 못 물어봤을 때는 `openable=false` 로 둔다 — 눌러도 아무 일이 없는 버튼을 그리는 것보다
 * 글로 안내하는 쪽이 정직하다(⑬ "실패는 사유까지 말한다").
 */
export interface MicSettingsHandle {
  /** 이 실행 환경에서 OS 마이크 설정 창을 열 수 있는가. */
  openable: boolean;
  /** 그 창에서 무엇을 만져야 하는지 가리키는 번역 키. 열 수 없어도 글로는 안내한다. */
  hintKey: string;
  /** 설정 창을 연다. 열지 못했으면 `false`(화면이 글 안내로 물러선다). */
  open: () => Promise<boolean>;
}

export function useMicSettings(): MicSettingsHandle {
  const [openable, setOpenable] = useState(false);
  // 못 물어본 동안에도 말은 해야 한다 — linux 안내가 가장 무난한 기본값이다(창을 열지 않는 쪽).
  const [hintKey, setHintKey] = useState('ide.mainArea.voiceMicSettingsHintLinux');

  useEffect(() => {
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
  }, []);

  const open = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/mic-settings/open', { method: 'POST' });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  }, []);

  return { openable, hintKey, open };
}
