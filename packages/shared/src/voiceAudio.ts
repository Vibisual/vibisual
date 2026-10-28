/**
 * §5.5 #17-38 ⑰⑱ — 마이크가 말만 담게(오디오 제약), 붙어 나온 글은 띄워서(다듬기). 글을 어디 꽂을지는 `voiceInput.ts`, 띄어쓰기 규칙은 `voiceKoSpacing.ts`.
 * 오디오 제약은 OS 마다 기본값이 달라 명시하지 않으면 무엇이 켜졌는지 확인할 길이 없다 — 순수 판정이라 단위 테스트로 고정한다.
 */
import { respaceKorean } from './voiceKoSpacing.js';

// ─────────────────────────────────────────────────────────────────────────────
// ⑰ 마이크가 **말만** 담게 한다 — 스피커로 나간 소리를 되받지 않는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 에코 제거·잡음 억제·자동 이득을 이름을 불러 켠다 — `audio: true` 면 Electron `file://` 렌더러에서 장치에 따라 조용히 꺼진 채 열린다.
 * `echoCancellation` 이 "컴퓨터 소리가 들어온다"의 답이다(스피커로 듣는 사용자). `noiseSuppression` = 방의 정상 잡음, `autoGainControl` = 작은 말이 빠지지 않게.
 * ⚠ `exact` 가 아니라 `ideal` — 못 하는 장치에 `exact` 면 `OverconstrainedError` 로 마이크가 안 열린다. ⚠ `channelCount: 1`(인식기는 첫 채널만 읽는다).
 * ⚠ 표본율은 걸지 않는다(`downsampleTo16k` 가 맞춘다 — 걸면 제약만 는다).
 * @param deviceId 고른 마이크. 비었으면 OS 기본 장치.
 */
export function voiceAudioConstraints(deviceId?: string | null): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: { ideal: 1 },
  };
  const id = (deviceId ?? '').trim();
  // 고른 장치도 **`ideal`** 이다 — 그 장치가 빠진 뒤(USB 마이크를 뽑았다) `exact` 로 걸려 있으면
  //   기본 마이크로 넘어가지 못하고 실패한다. 사용자는 왜 안 되는지 알 길이 없다.
  return id.length > 0 ? { ...base, deviceId: { ideal: id } } : base;
}

/**
 * 트랙이 그 처리들을 실제로 켜고 열렸는가(`ideal` 은 부탁일 뿐) — 꺼진 것을 알아야 헤드폰을 권한다. `MediaTrackSettings` 를 인자로 받아 DOM 없이 시험한다.
 * 보고하지 않음(Firefox 계열, `null`)과 `false` 를 가른다 — 모름을 꺼짐으로 접으면 멀쩡한 판에서 경고가 뜬다.
 */
export interface VoiceAudioProcessing {
  /** 에코 제거가 켜졌는가. `null` = 브라우저가 알려 주지 않았다(≠ 꺼짐). */
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

export function readVoiceProcessing(settings: MediaTrackSettings | null | undefined): VoiceAudioProcessing {
  const read = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const s = settings ?? {};
  return {
    echoCancellation: read(s.echoCancellation),
    noiseSuppression: read(s.noiseSuppression),
    autoGainControl: read(s.autoGainControl),
  };
}

/** 에코 제거가 확실히 꺼졌을 때만 헤드폰을 권한다 — `null`(모름)에는 말하지 않는다(넘겨짚은 안내가 원인을 가린다). */
export function shouldWarnEcho(p: VoiceAudioProcessing): boolean {
  return p.echoCancellation === false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑱ 붙어 나온 말을 띄운다 — 규칙 본체는 [voiceKoSpacing.ts](./voiceKoSpacing.ts) 한 곳
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 토막을 입력창에 넣기 직전에 다듬는다(지금은 한국어 띄어쓰기). 토막 안만 다룬다 — 기존 글과의 경계는 `mergeVoiceText`(합치면 사람이 쓴 글까지 다시 띄운다).
 * `enabled` 로 끌 수 있어야 한다 — 규칙 기반이라 틀리는 자리가 있다.
 */
export function polishVoiceChunk(text: string, enabled: boolean): string {
  if (!enabled) return text;
  return respaceKorean(text);
}
