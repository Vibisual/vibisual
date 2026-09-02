import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VOICE_INPUT,
  isFatalVoiceError,
  mapMediaError,
  mapVoiceError,
  voiceRecognitionLang,
  type VoiceInputErrorCode,
  type VoiceInputStatus,
} from '@vibisual/shared';
import { createOfflineRecognition } from '../utils/offlineRecognition.js';
import type { SpeechRecognitionLike } from '../utils/speechRecognition.js';
import { createVoiceOpenGate, type VoicePortResult } from './voiceOpenGate.js';

/**
 * useVoiceDictation — **§5.5 #17-38 마이크 한 대의 수명을 쥐는 훅.**
 *
 * 하는 일은 셋이다: ① 마이크를 열고 닫는다, ② 인식기를 붙였다 뗀다, ③ 지금 들어오는 소리의
 * 세기를 화면이 그릴 수 있게 내어 준다. **글을 어디에 넣을지는 모른다** — 최종 토막을
 * `onCommit` 으로 넘기고 끝낸다(입력창은 그 콜백을 받는 쪽이 안다).
 *
 * ### 왜 마이크를 직접 여는가 (인식기가 알아서 여는데도)
 * 실패의 **원인이 갈리기 때문**이다. 인식기만 부르면 권한 거부·장치 없음·서비스 불가가 전부
 * 뭉뚱그려 오지만, `getUserMedia` 를 먼저 부르면 "마이크 자체가 막혔다"를 그 자리에서 알 수
 * 있어 화면이 사용자가 **실제로 할 수 있는 일**(권한 허용 / 장치 연결)을 말할 수 있다.
 * 덤으로 그 스트림에서 파형을 뽑는다 — 인식기는 소리 세기를 알려 주지 않는다.
 *
 * ### 파형은 왜 React 상태가 아닌가
 * 초당 스물 몇 번 도는 자리라 상태로 올리면 입력창 전체가 그만큼 다시 그려진다(타이핑 지연의
 * 원인이 된다). `analyserRef` 만 넘기고 **그리는 쪽이 rAF 로 DOM 을 직접** 만진다 — 탭바의
 * 가려진 실행 표시(#17-9)와 같은 규율.
 */

export interface UseVoiceDictationOptions {
  /** 화면 언어 — 그대로 인식 언어가 된다(`voiceRecognitionLang`). */
  locale: string;
  /** 이 입력창이 받아쓰기를 받을 수 있는가. false 면 켜지지 않고 단축키도 먹지 않는다. */
  enabled: boolean;
  /** 최종 확정된 토막. 입력창이 커서 자리에 끼워 넣는다. */
  onCommit: (chunk: string) => void;
  /**
   * §5.5 #17-38 ⑫ — 인식기를 띄우고 표본을 보낼 포트를 받아 온다.
   * 실패는 **사유까지 갈라서** 돌려준다([voiceOpenGate.ts](./voiceOpenGate.ts)) — 아직 안 받은
   * 것과 받아 뒀는데 엔진이 안 뜬 것은 사용자가 할 일이 서로 다르다.
   */
  resolvePort: () => Promise<VoicePortResult>;
  /** 아직 안 받았을 때. 설치 창을 여는 것은 이 콜백을 받는 쪽의 일이다. */
  onNeedsInstall: () => void;
  /** 다 듣고 났을 때 — 엔진을 붙들고 있던 손을 놓는다(유휴가 되면 서버가 자식을 내린다). */
  onSessionEnd: () => void;
}

export interface VoiceDictationHandle {
  status: VoiceInputStatus;
  /** 멎은 사유. `status !== 'error'` 여도 남아 있을 수 있다(치명적이지 않은 실패의 흔적). */
  error: VoiceInputErrorCode | null;
  /** 아직 확정되지 않은 말 — 오버레이에만 보이고 입력창에는 넣지 않는다. */
  interim: string;
  /** 이 환경에 인식기가 있는가(된다는 보장은 아니다 — `utils/speechRecognition` 주석). */
  supported: boolean;
  /** 파형을 그릴 쪽이 읽어 갈 분석기. 듣는 중이 아니면 `null`. */
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  /** 듣기 시작. 이미 듣는 중이면 아무 일도 하지 않는다. */
  start: () => void;
  /** 듣기를 끝낸다 — 말하던 마지막 토막은 확정해서 넣는다. */
  stop: () => void;
  /** 취소 — 듣던 것을 버린다(Escape). */
  cancel: () => void;
  /** 켜기/끄기 한 손짓(버튼·단축키 공용). */
  toggle: () => void;
  /** 실패 안내를 내린다. 사유는 사용자가 읽은 뒤에만 사라진다(스스로 사라지면 못 읽는다). */
  dismissError: () => void;
}

/**
 * 인식기가 스스로 끝난 뒤 **곧바로** 다시 끝나는 일이 이만큼 이어지면 되살리기를 그만둔다.
 * (엔진이 조용히 거절하는 판에서 무한 재시작이 되는 것을 막는 안전판.)
 */
const RESTART_STORM_LIMIT = 4;
/** 위 판정의 "곧바로" — 이보다 짧게 살다 끝났으면 한 번으로 센다. */
const RESTART_STORM_MS = 700;
/** [완료]를 누른 뒤 마지막 결과를 기다려 주는 시간(ms). 이 안에 `onend` 가 없으면 그냥 거둔다. */
const STOP_GRACE_MS = 1200;

export function useVoiceDictation(options: UseVoiceDictationOptions): VoiceDictationHandle {
  const { locale, enabled, onCommit, resolvePort, onNeedsInstall, onSessionEnd } = options;

  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [error, setError] = useState<VoiceInputErrorCode | null>(null);
  const [interim, setInterim] = useState('');

  // 콜백·설정은 ref 로 들고 다닌다 — 인식기는 한 번 붙인 핸들러로 계속 도는데, 매 렌더마다
  //   새 함수로 갈아 끼우면 그 사이에 온 결과가 옛 클로저로 들어간다.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const resolvePortRef = useRef(resolvePort);
  resolvePortRef.current = resolvePort;
  const onNeedsInstallRef = useRef(onNeedsInstall);
  onNeedsInstallRef.current = onNeedsInstall;
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** 사용자가 켜 둔 상태인가 — 인식기가 스스로 끝났을 때 되살릴지 판정하는 유일한 근거. */
  const wantListeningRef = useRef(false);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** [완료] 뒤 마지막 결과를 기다리는 타이머 — 엔진이 끝났다고 알리지 않는 판의 안전판. */
  const stopGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const restartStormRef = useRef(0);
  /**
   * 켜기 한 번의 표를 발급·판정한다 — "여는 중이니 막는다"가 아니라 "나중 것만 살아남는다".
   * 왜 참·거짓이 아닌지는 [voiceOpenGate.ts](./voiceOpenGate.ts) 머리말에 있다.
   */
  const gateRef = useRef(createVoiceOpenGate());

  /** 열어 둔 것을 전부 되돌린다. 어디서 실패해 들어와도 남는 자원이 없어야 한다. */
  const teardown = useCallback(() => {
    // 도는 켜기를 먼저 낡은 것으로 만든다 — 이 뒤에 그 흐름이 자원을 심으면 거둘 사람이 없다.
    gateRef.current.abandon();
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (stopGuardRef.current !== null) {
      clearTimeout(stopGuardRef.current);
      stopGuardRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      // 핸들러부터 뗀다 — 떼기 전에 멈추면 그 `onend` 가 되살리기를 한 번 더 부른다.
      rec.onstart = null;
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onspeechend = null;
      try { rec.abort(); } catch { /* 이미 끝난 인식기 — 무시 */ }
      recognitionRef.current = null;
    }
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) void ctx.close().catch(() => { /* 이미 닫힌 컨텍스트 */ });
    const stream = streamRef.current;
    streamRef.current = null;
    // 트랙을 멈춰야 OS 의 "사용 중" 표시(윈도 트레이·mac 주황 점)가 내려간다.
    if (stream) stream.getTracks().forEach((track) => track.stop());
    // 엔진을 쥐고 있던 손을 놓는다. 여기서 안 놓으면 650MB 짜리 자식이 계속 살아 있는다.
    onSessionEndRef.current();
  }, []);

  const finish = useCallback((code: VoiceInputErrorCode | null) => {
    wantListeningRef.current = false;
    teardown();
    setInterim('');
    setStatus(code === null ? 'idle' : 'error');
    if (code !== null) setError(code);
  }, [teardown]);

  /** 인식기 한 대를 붙인다(마이크와 오디오 컨텍스트는 이미 열려 있다는 전제). */
  const attachRecognition = useCallback(
    (stream: MediaStream, audioContext: AudioContext, port: number): VoiceInputErrorCode | null => {
    let rec: SpeechRecognitionLike;
    try {
      rec = createOfflineRecognition({ port, stream, audioContext });
    } catch {
      return 'unsupported';
    }

    // 이 모델은 40개 로케일을 가중치 한 벌로 처리하고 언어를 스스로 가른다 — 값은 넘겨 두지만
    // 엔진이 읽지 않는다(§5.5 #17-38 ⑧ 의 "화면 언어 = 인식 언어" 는 그대로 유효하다).
    rec.lang = voiceRecognitionLang(localeRef.current);
    // 한 문장 말하고 끊기는 것이 아니라 **끌 때까지** 듣는다 — 명령은 대개 한 문장이 아니다.
    rec.continuous = true;
    // 말하는 도중을 화면에 보여 주기 위해 필요하다(확정 전 글자는 입력창에 넣지 않는다).
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      startedAtRef.current = Date.now();
      setStatus('listening');
    };

    rec.onresult = (event) => {
      let committed = '';
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result === undefined) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) committed += text;
        else pending += text;
      }
      if (committed.trim().length > 0) onCommitRef.current(committed);
      setInterim(pending);
    };

    rec.onerror = (event) => {
      const code = mapVoiceError(event.error);
      if (!isFatalVoiceError(code)) {
        // 잠깐 말이 없었거나(no-speech) 우리가 껐을 뿐(aborted) — 화면을 건드리지 않는다.
        //   `onend` 가 곧 이어 오고, 켜 둔 상태라면 거기서 되살린다.
        return;
      }
      finish(code);
    };

    rec.onend = () => {
      if (!wantListeningRef.current) return;
      // Chromium 은 `continuous` 여도 조용하면 스스로 끝낸다 — 사용자가 끄지 않았으면 되살린다.
      const lived = Date.now() - startedAtRef.current;
      restartStormRef.current = lived < RESTART_STORM_MS ? restartStormRef.current + 1 : 0;
      if (restartStormRef.current >= RESTART_STORM_LIMIT) {
        // 이 판에서는 인식기가 조용히 거절하고 있다 — 무한 재시작 대신 사유를 남기고 멎는다.
        finish('unknown');
        return;
      }
      try {
        rec.start();
      } catch {
        finish('unknown');
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      return 'unknown';
    }
    return null;
    },
    [finish],
  );

  const start = useCallback(() => {
    if (!enabled) return;
    // 이미 켜져 있으면 두 벌 열지 않는다. **여는 중이라는 이유로는 막지 않는다** — 껐다가 다시
    //   켜는 누름까지 삼키면, 엔진이 뜨는 몇 초 동안 버튼이 죽은 것처럼 보인다(voiceOpenGate).
    if (wantListeningRef.current) return;
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      setStatus('error');
      setError('device');
      return;
    }

    const token = gateRef.current.begin();
    wantListeningRef.current = true;
    restartStormRef.current = 0;
    setError(null);
    setInterim('');
    setStatus('starting');

    /** 이 켜기가 아직 살아 있는가 — 그 사이에 껐거나(끄기) 다시 켰으면(새 세대) 아니다. */
    const alive = (): boolean => gateRef.current.isCurrent(token) && wantListeningRef.current;
    /**
     * 낡은 켜기가 물러나며 **자기가 연 것만** 되돌린다(ref 에 심기 전이라 `teardown` 이 모른다).
     *
     * 엔진을 쥔 손은 **더 새 켜기가 없을 때만** 놓는다. 새 켜기가 같은 열쇠로 다시 쥐었는데
     * 여기서 놓으면, 말하는 도중에 서버가 그 650MB 짜리 자식을 유휴로 보고 내린다.
     */
    const rollback = (stream: MediaStream | null, ctx: AudioContext | null): void => {
      if (stream !== null) stream.getTracks().forEach((track) => track.stop());
      if (ctx !== null) void ctx.close().catch(() => { /* 이미 닫힌 컨텍스트 */ });
      if (gateRef.current.isCurrent(token)) onSessionEndRef.current();
    };

    void (async (): Promise<void> => {
      /**
       * ① **인식기가 준비됐는지부터 묻는다 — 마이크는 그 다음이다.**
       * 순서를 뒤집으면, 아직 안 받은 사용자는 마이크가 한 번 켜졌다 곧바로 꺼지는 것을 본다
       * (OS 의 "사용 중" 표시가 깜빡인다). 그건 설치 안내가 아니라 고장으로 읽힌다.
       */
      const resolved = await resolvePortRef.current();
      if (!alive()) {
        rollback(null, null);
        return;
      }
      if (!resolved.ok) {
        if (resolved.reason === 'needs-install') {
          wantListeningRef.current = false;
          gateRef.current.abandon();
          setStatus('idle');
          onNeedsInstallRef.current();
        } else {
          // 받아 둔 것은 있는데 엔진이 안 떴다 — 설치 창이 아니라 사유를 보여 준다.
          finish('network');
        }
        return;
      }
      const { port } = resolved;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // 여는 사이에 껐거나 다시 켰으면 지금 연 것을 바로 되돌린다(좀비 마이크 방지).
        if (!alive()) {
          rollback(stream, null);
          return;
        }

        // 파형과 인식은 **같은 컨텍스트**를 쓴다 — 두 벌을 열면 표본율이 갈려 인식이 조용히 어긋난다.
        let ctx: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        try {
          ctx = new AudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = VOICE_INPUT.FFT_SIZE;
          // 막대가 소리보다 늦게 따라오지 않게 평활은 약하게.
          analyser.smoothingTimeConstant = 0.6;
          ctx.createMediaStreamSource(stream).connect(analyser);
          if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
        } catch {
          analyser = null;
        }
        // ⚠ `resume()` 도 기다리는 자리다 — 심기 **직전에** 한 번 더 본다. 낡은 켜기가 여기서
        //   ref 를 덮어쓰면, 살아 있는 켜기의 마이크를 아무도 못 거두는 좀비로 만든다.
        if (!alive()) {
          rollback(stream, ctx);
          return;
        }

        // 여기서부터 이 켜기가 주인이다 — 심고 나면 이후 실패는 전부 `teardown` 이 거둔다.
        streamRef.current = stream;
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;

        if (ctx === null) {
          // 종전에는 파형만 잃고 넘어갔지만, 이제 이 컨텍스트가 **표본을 보내는 길**이기도 하다.
          finish('device');
          return;
        }

        const failure = attachRecognition(stream, ctx, port);
        if (failure !== null) {
          finish(failure);
          return;
        }

        // 켜 둔 채 자리를 떠도 마이크가 영원히 열려 있지 않게 하는 안전판.
        maxTimerRef.current = setTimeout(() => {
          maxTimerRef.current = null;
          if (wantListeningRef.current) finish(null);
        }, VOICE_INPUT.MAX_SESSION_MS);
      } catch (err: unknown) {
        // 낡은 켜기의 실패는 화면에 옮기지 않는다 — 지금 살아 있는 켜기까지 함께 멎는다.
        if (!alive()) return;
        const name = err instanceof Error ? err.name : String(err);
        finish(mapMediaError(name));
      }
    })();
  }, [enabled, attachRecognition, finish]);

  const stop = useCallback(() => {
    if (!wantListeningRef.current) return;
    wantListeningRef.current = false;
    // 화면은 곧바로 내린다 — 누른 사람은 끝났다고 여긴다.
    setStatus('idle');
    setInterim('');

    const rec = recognitionRef.current;
    if (rec === null) {
      teardown();
      return;
    }

    /**
     * ⚠ **여기서 곧바로 거두면 마지막 말이 사라진다.**
     * `stop()` 은 `abort()` 와 달리 "말하던 토막을 확정해서 마저 돌려 달라"는 뜻이라, 마지막
     * `onresult` 가 **비동기로 뒤늦게** 온다. 그 전에 핸들러를 떼면 방금 한 말이 입력창에
     * 닿지 못한다. 그래서 엔진이 끝났다고 알릴 때(`onend`)까지 기다렸다가 거둔다.
     *
     * 다만 **기다리는 것은 인식기 하나뿐**이다. 마이크·오디오 컨텍스트는 지금 놓는다:
     *   ① 인식기는 이미 `stop()` 안에서 오디오 배선을 끊었으므로 더 쓸 일이 없고,
     *   ② 기다리는 사이에 사용자가 다시 켜면 그 켜기가 `streamRef` 를 덮어써 **여기 있던
     *      마이크를 아무도 못 끄는 좀비**로 만든다(OS 의 "사용 중" 표시가 켜진 채 남는다).
     * 인식기만 ref 에서 미리 떼어 두면 아래 `teardown()` 이 그것만 건너뛰고 나머지를 거둔다.
     */
    recognitionRef.current = null;
    teardown();

    let collected = false;
    const collect = (): void => {
      if (collected) return;
      collected = true;
      // 다시 켰든 아니든 **이 인식기**는 거둔다 — 새 세션의 것은 ref 를 통해 따로 산다.
      rec.onstart = null;
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onspeechend = null;
      try { rec.abort(); } catch { /* 이미 끝난 인식기 — 무시 */ }
    };
    rec.onend = collect;
    // `onend` 를 주지 않는 판을 위한 안전판 — 이것이 없으면 소켓이 열린 채 남는다.
    //   ⚠ `teardown()` 이 이 시계를 지우므로 **거둔 뒤에** 감는다(순서가 뒤집히면 곧바로 지워진다).
    if (stopGuardRef.current !== null) clearTimeout(stopGuardRef.current);
    stopGuardRef.current = setTimeout(() => {
      stopGuardRef.current = null;
      collect();
    }, STOP_GRACE_MS);

    try {
      rec.stop();
    } catch {
      collect();
    }
  }, [teardown]);

  const cancel = useCallback(() => {
    if (!wantListeningRef.current) return;
    finish(null);
  }, [finish]);

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop();
    else start();
  }, [start, stop]);

  const dismissError = useCallback(() => {
    setError(null);
    setStatus((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  // 받을 수 없는 상태가 되면(읽기 전용 전환·세션 교체) 듣던 것을 멈춘다.
  useEffect(() => {
    if (!enabled && wantListeningRef.current) finish(null);
  }, [enabled, finish]);

  // 창이 사라질 때 마이크가 남지 않게 — 이 훅이 여는 자원의 마지막 회수 지점.
  useEffect(() => () => {
    wantListeningRef.current = false;
    teardown();
  }, [teardown]);

  return {
    status,
    error,
    interim,
    // 인식기를 우리가 들고 오므로 이 환경에 있느냐는 물음은 사라졌다 — 없으면 **받으면 된다**.
    supported: true,
    analyserRef,
    start,
    stop,
    cancel,
    toggle,
    dismissError,
  };
}
