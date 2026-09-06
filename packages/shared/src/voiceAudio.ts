/**
 * voiceAudio.ts — **§5.5 #17-38 ⑰⑱ 마이크가 말만 담게, 붙어 나온 말은 띄워서.**
 *
 * `voiceInput.ts` 는 인식된 글을 **어디에 꽂을지**(커서 자리·실패 사유·단축키)를 맡는다.
 * 이 파일이 맡는 것은 그 앞뒤다 — **소리를 어떻게 받을 것인가**(제약)와 **받아 온 글을 어떻게
 * 다듬을 것인가**(띄어쓰기). 둘 다 사용자가 실제로 겪은 두 가지 고장에서 나왔다:
 * "컴퓨터의 소리까지 전부 다 마이크에 들어간다" 와 "띄어쓰기가 전혀 안 된다".
 *
 * 왜 shared 인가: 둘 다 **순수 판정**이라 화면을 띄우지 않고 단위 테스트로 고정된다. 특히
 * 오디오 제약은 win/mac/linux 가 각기 다른 기본값으로 도는 자리라, 우리가 값을 명시하지
 * 않으면 어느 OS 에서 무엇이 켜졌는지 확인할 방법이 영영 없다.
 *
 * 띄어쓰기 **규칙 본체**는 [voiceKoSpacing.ts](./voiceKoSpacing.ts) 에 따로 있다 — 조사·어미
 * 목록과 경계 판정은 그 자체로 한 덩어리라, 오디오 제약과 한 파일에 섞으면 둘 다 안 읽힌다.
 */
import { respaceKorean } from './voiceKoSpacing.js';

// ─────────────────────────────────────────────────────────────────────────────
// ⑰ 마이크가 **말만** 담게 한다 — 스피커로 나간 소리를 되받지 않는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 마이크를 열 때 거는 제약 — **에코 제거·잡음 억제·자동 이득**을 명시적으로 켠다.
 *
 * 종전에는 `getUserMedia({ audio: true })` 였다. 짧고 무해해 보이지만 이 한 줄이 **스피커로
 * 나간 소리를 마이크가 되받는 것을 막을 기회를 통째로 버린다.** `audio: true` 는 "기본값에
 * 맡긴다"는 뜻이고, 그 기본값은 브라우저·OS·장치 드라이버가 각자 정한다 — Chromium 은 대개
 * 켜 주지만 **Electron 의 `file://` 렌더러에서는 그 보장이 없고**, 장치가 노출한 능력에 따라
 * 조용히 꺼진 채로 열린다. 확인할 길이 없으니 사용자에게는 "받아쓰기가 원래 이렇다"로 읽힌다.
 *
 * 그래서 셋을 **이름을 불러** 켠다:
 *
 * - `echoCancellation` — 이것 하나가 "컴퓨터 소리가 들어온다"의 정답이다. 스피커로 나간 신호를
 *   참조로 두고 마이크 입력에서 빼는 처리(AEC)라, 영상·회의 소리·알림음이 받아쓰기로 들어가는
 *   것을 막는다. **헤드폰을 쓰면 애초에 안 생기는 문제**지만 우리 사용자는 스피커로 듣는다.
 * - `noiseSuppression` — 팬·에어컨·키보드 같은 **정상 잡음**을 깎는다. AEC 가 못 잡는 쪽이다
 *   (그건 스피커 소리가 아니라 방의 소리라 참조 신호가 없다).
 * - `autoGainControl` — 멀리서 말해도 세기를 끌어올린다. 인식기는 표본 세기에 민감해서 작게
 *   들어온 말은 글자가 통째로 빠진다.
 *
 * ⚠ **`ideal` 로 건다 — `exact` 가 아니다.** 장치가 못 하는 처리를 `exact` 로 요구하면
 * `OverconstrainedError` 로 **마이크가 아예 안 열린다**. 잡음이 남는 것보다 받아쓰기가 통째로
 * 죽는 쪽이 훨씬 나쁘다. `ideal` 은 "할 수 있으면 해 달라"라서 못 하는 장치에서도 열린다.
 *
 * ⚠ **`channelCount: 1`** — 인식기는 첫 채널만 읽는다(`getChannelData(0)`). 스테레오로 열리면
 * 한쪽 채널만 인식에 쓰이므로, 애초에 모노로 받아 두는 편이 마이크 배열 장치에서 유리하다.
 *
 * ⚠ **표본율은 걸지 않는다.** 어떤 표본율로 받든 `downsampleTo16k` 로 맞춘다
 * (`offlineRecognition`). 여기서 16k 를 요구하면 그것을 못 내는 장치에서 제약만 늘고 얻는 것이
 * 없다 — 우리가 이미 그 일을 하고 있다.
 *
 * @param deviceId 사용자가 고른 마이크. 비었으면 OS 기본 장치(처리 제약만 건다).
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
 * 지금 이 트랙이 **실제로** 그 처리들을 켜고 열렸는가 — 제약은 부탁이지 보장이 아니다.
 *
 * `ideal` 로 걸었으므로 장치가 못 하면 조용히 꺼진 채 열린다(그게 `exact` 를 안 쓴 이유다).
 * 꺼진 것을 **알 수 있어야** 화면이 "헤드폰을 쓰시면 낫습니다"를 말할 수 있다 — 말해 주지
 * 않으면 사용자는 우리가 아무 일도 안 한 줄 안다.
 *
 * `MediaTrackSettings` 를 **인자로 받는다** — `MediaStreamTrack` 을 여기서 만지면 이 판정은
 * jsdom 이 없는 우리 클라 테스트에서 영영 검증되지 않는다(멀티플랫폼 규칙과 같은 규율).
 * 브라우저가 그 키를 **아예 보고하지 않는 경우**(Firefox 계열)와 `false` 로 보고하는 경우를
 * 가른다 — 모르는 것을 "꺼짐"으로 접으면 멀쩡한 판에서 경고가 뜬다.
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

/**
 * **에코 제거가 확실히 꺼진 채로 열렸는가.** 이때만 화면이 헤드폰을 권한다.
 *
 * `null`(모름)에는 말하지 않는다 — 넘겨짚은 안내가 진짜 원인을 가리는 쪽이 더 나쁘다는
 * ⑥ 과 같은 규율이다. 실제로 꺼진 판에서만 한 줄 뜬다.
 */
export function shouldWarnEcho(p: VoiceAudioProcessing): boolean {
  return p.echoCancellation === false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑱ 붙어 나온 말을 띄운다 — 규칙 본체는 [voiceKoSpacing.ts](./voiceKoSpacing.ts) 한 곳
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인식된 토막을 **입력창에 넣기 직전에** 다듬는다 — 지금은 한국어 띄어쓰기 복원 하나다.
 *
 * `mergeVoiceText` 와 자리를 나눈 이유: 저쪽은 **토막과 기존 글 사이**의 경계를 다루고
 * (커서 자리·앞뒤 공백), 이쪽은 **토막 안**을 다룬다. 한 함수에 합치면 "이미 있던 글까지 다시
 * 띄우는" 일이 생긴다 — 사람이 손으로 쓴 글을 우리 규칙이 헤집으면 안 된다.
 *
 * `enabled` 를 **인자로 받는다** — 사용자가 끌 수 있어야 한다. 규칙 기반이라 틀리는 자리가
 * 있고, 그때 되돌릴 길이 없으면 받아쓰기 자체를 못 쓰게 된다.
 */
export function polishVoiceChunk(text: string, enabled: boolean): string {
  if (!enabled) return text;
  return respaceKorean(text);
}
