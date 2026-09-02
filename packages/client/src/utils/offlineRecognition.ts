/**
 * offlineRecognition.ts — **§5.5 #17-38 ⑫ 내 PC 에서 도는 인식기.**
 *
 * `speechRecognition.ts` 가 비워 둔 그 자리(#17-38 ⑩ "엔진을 하나 더 붙일 자리")를 채운다.
 * 밖으로 내는 모양은 **브라우저 내장과 똑같은 `SpeechRecognitionLike`** 다 — 그래야 마이크
 * 수명을 쥔 훅(`useVoiceDictation`)도, 파형·커서 끼워넣기·단축키도 한 줄도 안 바뀐다.
 *
 * ### 소리는 이 앱의 메인 스레드를 지나가지 않는다
 * 16kHz float32 는 초당 64KB 다. IPC 로 메인(=서버 코어, §3.7)에 부으면 §9 가 지켜 온 그
 * 스레드를 우리가 다시 먹는다. 그래서 표본은 **화면에서 엔진으로 곧장** 간다 — 서버가 하는
 * 일은 엔진을 띄우고 포트를 알려 주는 것까지다.
 *
 * ### 왜 `ScriptProcessorNode` 인가 (deprecated 인데도)
 * `AudioWorklet` 은 모듈을 **URL 로** 올려야 하는데 패키지 앱의 렌더러는 `file://` 이라
 * 그 URL 을 `blob:` 으로 만들어야 하고, 그건 CSP 한 줄에 조용히 막힌다(막히면 마이크는
 * 열렸는데 글자만 안 나오는, 원인을 못 읽는 상태가 된다). 받아쓰기는 몇 초짜리 짧은 경로라
 * 워클릿의 이점(전용 스레드)보다 **확실히 도는 쪽**이 낫다. Chromium 은 아직 제거 일정이 없다.
 */
import { VOICE_ASR, downsampleTo16k, float32Bytes } from '@vibisual/shared';
import type {
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from './speechRecognition.js';

/** 엔진이 돌려주는 JSON 한 줄. 우리가 읽는 것은 둘뿐이라 그 둘만 적는다. */
interface EngineResult {
  text?: string;
  is_final?: boolean;
}

export interface OfflineRecognitionOptions {
  /** 서버가 띄운 엔진이 듣고 있는 포트. */
  port: number;
  /** 이미 열려 있는 마이크. 이 모듈은 마이크를 열지 않는다(실패 원인이 갈려야 하므로 — #17-38 ⑥). */
  stream: MediaStream;
  /** 파형과 같은 컨텍스트를 쓴다 — 두 벌을 열면 표본율이 갈려 인식이 조용히 어긋난다. */
  audioContext: AudioContext;
}

/**
 * 엔진이 사는 호스트.
 *
 * 패키지 앱의 렌더러는 `file://` 이라 `location.hostname` 이 빈 문자열이다 → 루프백.
 * 모바일 웹 접속 모드(§4 v3.16)에서는 그 페이지를 준 호스트가 곧 엔진이 도는 기계다.
 */
export function engineHost(hostname: string): string {
  return hostname.length > 0 ? hostname : '127.0.0.1';
}

/** 한 프레임에 담을 표본 수를 넘겨 받은 버퍼를 20ms 조각으로 나눈다. */
function* frames(samples: Float32Array, size: number): Generator<Float32Array> {
  for (let i = 0; i < samples.length; i += size) {
    yield samples.subarray(i, Math.min(i + size, samples.length));
  }
}

/**
 * 인식기 한 대. `start()` 를 부르기 전에는 아무것도 열지 않는다.
 *
 * 브라우저 내장과 모양은 같지만 **`lang` 은 쓰지 않는다** — 이 모델은 40개 로케일을 가중치
 * 한 벌로 처리하고 언어를 스스로 가른다. 값을 받아 두기만 하고 버리는 것은 거짓말이 아니라
 * 인터페이스를 지키기 위한 것이고, 그 사실을 여기 적어 둔다.
 */
export function createOfflineRecognition(opts: OfflineRecognitionOptions): SpeechRecognitionLike {
  const { port, stream, audioContext } = opts;

  let socket: WebSocket | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  let closed = false;
  /** 사용자가 [완료]를 눌렀는가 — 그 뒤에 오는 마지막 결과까지 받고 나서 끝낸다. */
  let finishing = false;

  const rec: SpeechRecognitionLike = {
    lang: '',
    continuous: true,
    interimResults: true,
    maxAlternatives: 1,
    onstart: null,
    onend: null,
    onresult: null,
    onerror: null,
    onspeechend: null,
    start,
    stop,
    abort,
  };

  function emitResult(text: string, isFinal: boolean): void {
    const handler = rec.onresult;
    if (handler === null) return;
    const event: SpeechRecognitionEventLike = {
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal,
          length: 1,
          0: { transcript: text, confidence: 1 },
        },
      },
    };
    handler(event);
  }

  function emitError(code: string, message?: string): void {
    const handler = rec.onerror;
    if (handler === null) return;
    const event: SpeechRecognitionErrorEventLike = message === undefined ? { error: code } : { error: code, message };
    handler(event);
  }

  function teardownAudio(): void {
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* 이미 끊긴 노드 */ }
      processor = null;
    }
    if (source) {
      try { source.disconnect(); } catch { /* 이미 끊긴 노드 */ }
      source = null;
    }
    if (sink) {
      try { sink.disconnect(); } catch { /* 이미 끊긴 노드 */ }
      sink = null;
    }
  }

  function finish(): void {
    if (closed) return;
    closed = true;
    teardownAudio();
    const sock = socket;
    socket = null;
    if (sock) {
      sock.onmessage = null;
      sock.onerror = null;
      sock.onclose = null;
      try { sock.close(); } catch { /* 이미 닫힌 소켓 */ }
    }
    rec.onend?.();
  }

  function wireAudio(): void {
    source = audioContext.createMediaStreamSource(stream);
    // 버퍼가 작을수록 중간 글자가 빨리 뜨지만 콜백이 잦아진다. 4096@48kHz ≈ 85ms 가 균형점.
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    // ⚠ Chromium 은 **출력이 어딘가에 연결돼 있어야** `onaudioprocess` 를 돌린다.
    //   그렇다고 스피커에 그대로 물리면 자기 목소리가 되울린다 → 이득 0 인 노드를 사이에 둔다.
    sink = audioContext.createGain();
    sink.gain.value = 0;

    processor.onaudioprocess = (ev): void => {
      const sock = socket;
      if (sock === null || sock.readyState !== WebSocket.OPEN || finishing) return;
      const input = ev.inputBuffer.getChannelData(0);
      // `getChannelData` 는 **재사용되는 버퍼**를 준다 — 그대로 들고 있으면 다음 콜백이 덮어쓴다.
      const copy = new Float32Array(input);
      const resampled = downsampleTo16k(copy, audioContext.sampleRate);
      for (const frame of frames(resampled, VOICE_ASR.FRAME_SAMPLES)) {
        // subarray 는 원본 버퍼를 공유한다 — 그대로 보내면 프레임이 아니라 버퍼 전체가 실린다.
        sock.send(float32Bytes(new Float32Array(frame)));
      }
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioContext.destination);
  }

  function start(): void {
    if (socket !== null || closed) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`ws://${engineHost(window.location.hostname)}:${String(port)}`);
    } catch {
      emitError('network');
      return;
    }
    sock.binaryType = 'arraybuffer';
    socket = sock;

    sock.onopen = (): void => {
      if (closed) return;
      try {
        wireAudio();
      } catch {
        emitError('audio-capture');
        finish();
        return;
      }
      rec.onstart?.();
    };

    sock.onmessage = (ev): void => {
      if (typeof ev.data !== 'string') return;
      // 입력이 끝났다는 신호는 JSON 이 아니라 맨 문자열로 온다(2026-09-02 엔진 소스 확인).
      if (ev.data === 'Done!') {
        finish();
        return;
      }
      let parsed: EngineResult;
      try {
        parsed = JSON.parse(ev.data) as EngineResult;
      } catch {
        return; // 모르는 줄은 조용히 버린다 — 엔진 판올림이 줄을 하나 더 늘려도 죽지 않게.
      }
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      const isFinal = parsed.is_final === true;
      // ⚠ `text` 는 **그 토막의 누적**이지 새로 붙은 조각이 아니다. 이어 붙이면 말이 겹쳐 쌓인다.
      if (text.length > 0 || isFinal) emitResult(text, isFinal);
    };

    sock.onerror = (): void => {
      if (closed) return;
      emitError('network');
    };

    sock.onclose = (): void => {
      // 우리가 닫은 것이든 저쪽이 끊은 것이든 끝은 하나다 — 훅이 되살릴지 판정한다.
      finish();
    };
  }

  /** 말하던 마지막 토막을 확정해서 받고 끝낸다. 엔진에게 `Done` 을 보내면 마지막 결과가 온다. */
  function stop(): void {
    if (closed) return;
    finishing = true;
    teardownAudio(); // 더 보내지 않는다 — 보내면 `Done` 뒤에 표본이 붙어 결과가 한 번 더 밀린다.
    const sock = socket;
    if (sock === null || sock.readyState !== WebSocket.OPEN) {
      finish();
      return;
    }
    try {
      sock.send('Done');
    } catch {
      finish();
    }
    // 마지막 결과(또는 `Done!`)를 기다린다. 훅에도 안전판이 있지만, 소켓을 쥔 쪽에도 하나 둔다.
    setTimeout(finish, 1500);
  }

  /** 듣던 것을 버린다 — 마지막 토막을 기다리지 않는다(Escape). */
  function abort(): void {
    finishing = true;
    finish();
  }

  return rec;
}
