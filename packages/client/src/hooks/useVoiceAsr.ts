import { useCallback, useEffect } from 'react';
import type { VoiceAsrState } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

/**
 * useVoiceAsr — **§5.5 #17-38 ⑫ 받아쓰기가 준비됐는지 묻고, 없으면 받아 오는 손잡이.**
 *
 * 상태는 서버가 **디스크를 보고** 판정한 것을 그대로 읽는다(§3.1·§5.19 (B)) — 여기서
 * "받아 뒀던 것 같다"를 기억해 두지 않는다. 사용자가 폴더를 지웠으면 다시 설치 창이 뜨는 것이
 * 맞고, 그 판정을 클라이언트가 흉내 내면 두 자리가 다르게 말한다.
 */
export function useVoiceAsr(): {
  state: VoiceAsrState | null;
  refresh: () => Promise<VoiceAsrState | null>;
  install: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
  /** 엔진을 띄우고 표본을 보낼 포트를 받는다. 준비 안 됐으면 `null`. */
  openSession: (sessionId: string) => Promise<number | null>;
  closeSession: (sessionId: string) => void;
} {
  const state = useGraphStore((s) => s.voiceAsr);
  const applyState = useGraphStore((s) => s.applyVoiceAsrState);

  const refresh = useCallback(async (): Promise<VoiceAsrState | null> => {
    try {
      const res = await fetch('/api/voice-asr');
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; state?: VoiceAsrState };
      const next = body.state ?? null;
      applyState(next);
      return next;
    } catch {
      // 서버에 못 닿는 판(부팅 직후)에서는 **아무것도 단정하지 않는다** — null 이 곧 "아직 모름"이고,
      // 화면은 그때 버튼을 잠그는 대신 다시 묻는다.
      return null;
    }
  }, [applyState]);

  const install = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/voice-asr/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch {
      /* 진행·실패는 WS `voice_asr_progress` 가 말한다 — 여기서 두 번 말하지 않는다. */
    }
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/voice-asr/install/cancel', { method: 'POST' });
    } catch {
      /* 이미 끝났을 수 있다. */
    }
  }, []);

  const remove = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/voice-asr', { method: 'DELETE' });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const openSession = useCallback(async (sessionId: string): Promise<number | null> => {
    try {
      const res = await fetch('/api/voice-asr/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; port?: number };
      return typeof body.port === 'number' && body.port > 0 ? body.port : null;
    } catch {
      return null;
    }
  }, []);

  const closeSession = useCallback((sessionId: string): void => {
    // 끝내는 길은 실패해도 화면이 달라질 것이 없다 — 기다리지 않는다.
    void fetch('/api/voice-asr/session/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
  }, []);

  // 창이 처음 뜰 때 한 번 묻는다. 마이크를 누르는 순간에 또 묻지만, 미리 알아 두면
  // 버튼의 안내 문구(설치 필요 / 바로 됨)가 누르기 전에 맞는다.
  useEffect(() => {
    if (state === null) void refresh();
  }, [state, refresh]);

  return { state, refresh, install, cancel, remove, openSession, closeSession };
}
