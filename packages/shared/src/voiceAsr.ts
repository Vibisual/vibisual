/**
 * voiceAsr.ts — §5.5 #17-38 ⑫ **오프라인 받아쓰기 엔진**의 판정 정본.
 *
 * #17-38 ⑩ 은 인식기를 브라우저 내장(`webkitSpeechRecognition`) 하나로 두고, 갈아 끼울 자리를
 * `utils/speechRecognition.ts` 한 곳으로 모아 두었다. 그 자리를 이 모듈이 받는다 —
 * 구글이 크롬 밖(Electron)에서 그 API 를 막아 두어 **설치된 앱에서는 애초에 문장이 오지 않기**
 * 때문이다(사유만 뜨고 멎는다). 대신 사용자 PC 에서 도는 인식기를 **받아서** 쓴다.
 *
 * **왜 인스톨러에 동봉하지 않는가** — §5.19 (B) 가 세운 규약 그대로다. 모델이 650MB 라
 * 받아쓰기를 안 쓰는 사용자의 설치 파일이 그만큼 무거워지면 안 된다. 마이크를 처음 누를 때
 * 설치 창이 뜨고, 그 창이 진행률을 끝까지 들고 있다가 **끝나는 순간 스스로 물러나며 받아쓰기를
 * 시작**한다(§5.19 (B) "설치 창은 그 버블의 준비 과정 그 자체다" 와 같은 흐름).
 *
 * **왜 판정이 전부 순수 함수인가** — 자산 고르기·경로·언어 등급·오디오 변환은 전부 OS 별로
 * 갈리는데 개발기는 Windows 하나다. `platform`·`arch` 를 **인자로 받으면** 세 OS 의 조합을
 * Windows 에서 단위 테스트로 고정할 수 있다([multiplatform.md](../../../docs/rules/multiplatform.md)).
 */

import type { PlatformName } from './pathCase.js';

/** §5.5 #17-38 ⑫ — 홈(`~/.vibisual`) 아래에 놓이는 폴더 이름. §5.19 의 `engine`/`models` 와 형제. */
export const VOICE_ASR_ENGINE_DIR_NAME = 'voice-engine';
export const VOICE_ASR_MODEL_DIR_NAME = 'voice-model';

/**
 * 엔진 릴리스 **목록** 조회 URL — `…/releases/latest` 를 쓰지 않는다.
 *
 * §5.19 (D) 가 llama.cpp 에서 겪은 그 사고와 같은 계열이다: `latest` 자리에 우리가 쓸 자산이
 * 하나도 없는 릴리스가 앉으면 설치가 통째로 죽는다. 목록을 받아 **쓸 수 있는 자산을 실제로
 * 가진 가장 최근 릴리스**를 우리가 고른다. 판올림 번호를 코드에 박지 않는 이유도 같다.
 */
export const SHERPA_RELEASES_LIST_API =
  'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases?per_page=10';

/** 릴리스 목록에서 훑을 개수 — 쓸 자산을 가진 릴리스를 찾을 때까지 이만큼만 본다. */
export const VOICE_ASR_RELEASE_SCAN_MAX = 10;

export const VOICE_ASR = {
  /** 인식기가 받는 유일한 표본율. 마이크가 무엇이든 우리가 여기에 맞춰 준다. */
  SAMPLE_RATE: 16_000,
  /** 한 번에 보내는 표본 수(=20ms). 작을수록 중간 글자가 빨리 뜨고, 너무 작으면 왕복만 는다. */
  FRAME_SAMPLES: 320,
  /** 자식 프로세스가 뜨고 포트를 열 때까지 기다리는 한도. */
  ENGINE_START_TIMEOUT_MS: 20_000,
  /** 받다 끊긴 파일을 이어받을 때 한 번에 확인하는 크기. */
  DOWNLOAD_CHUNK_BYTES: 1 << 20,
  /** 내려받기 진행률을 화면에 미는 최소 간격 — 매 청크마다 밀면 그것만으로 프레임을 먹는다. */
  PROGRESS_PUSH_MS: 200,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 엔진 자산 고르기 — 플랫폼·아키텍처는 **인자**로 받는다
// ─────────────────────────────────────────────────────────────────────────────

/** 릴리스 자산 이름 속의 OS 토큰. `process.platform` 을 함수 안에서 읽지 않는다. */
export function voiceEnginePlatformToken(platform: PlatformName): string | null {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'osx';
  if (platform === 'linux') return 'linux';
  return null;
}

/**
 * 자산 이름 속의 아키텍처 토큰.
 * 리눅스만 `aarch64` 라고 적는다(win/mac 은 `arm64`) — 이 한 글자가 안 맞으면 전 자산이 탈락한다.
 */
export function voiceEngineArchToken(platform: PlatformName, arch: string): string | null {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return platform === 'linux' ? 'aarch64' : 'arm64';
  return null;
}

/** 실행본 이름 — 스트리밍 인식을 하는 것은 이 한 벌뿐이다(오프라인 판은 중간 글자가 없다). */
export function voiceEngineBinName(platform: PlatformName): string {
  return platform === 'win32'
    ? 'sherpa-onnx-online-websocket-server.exe'
    : 'sherpa-onnx-online-websocket-server';
}

/**
 * 이 자산을 우리가 쓸 수 있는가, 쓸 수 있다면 얼마나 좋은가.
 *
 * `null` = 못 쓴다. 숫자가 클수록 낫다. **거르는 쪽을 화이트리스트가 아니라 블랙리스트로 두면**
 * 새 자산 종류가 생겼을 때 조용히 그것을 골라 버린다 — 그래서 "반드시 있어야 하는 것"과
 * "있으면 안 되는 것"을 둘 다 본다.
 */
export function scoreVoiceEngineAsset(
  name: string,
  platform: PlatformName,
  arch: string,
): number | null {
  const os = voiceEnginePlatformToken(platform);
  const cpu = voiceEngineArchToken(platform, arch);
  if (os === null || cpu === null) return null;

  // 반드시 있어야 하는 것 — 이 셋 중 하나만 어긋나도 우리 자산이 아니다.
  if (!name.endsWith('.tar.bz2')) return null;
  if (!name.includes(`-${os}-${cpu}-`)) return null;
  if (!name.includes('-shared')) return null;

  // 있으면 안 되는 것.
  //  `-lib.` = 공유 라이브러리만 들어 있어 **실행본이 없다**(풀어도 서버가 안 나온다).
  //  `static` = 수백 MB. `jni` = 자바용. `gpu`/`cuda` = 런타임을 더 받아야 한다.
  //  `Debug`/`RelWithDebInfo` = 100MB 를 넘고 느리다.
  const bad = ['-lib.', 'static', 'jni', 'gpu', 'cuda', 'Debug', 'RelWithDebInfo'];
  for (const token of bad) if (name.includes(token)) return null;

  let score = 0;
  // TTS(음성 합성)는 우리가 안 쓴다 — 뺀 자산이 몇 MB 작다.
  if (name.includes('-no-tts')) score += 10;
  // Windows 는 CRT 링크 방식이 이름에 붙는다. **MT(정적 CRT)를 먼저** 고른다 —
  // MD 는 사용자 PC 에 MSVC 재배포 런타임이 깔려 있어야 뜨고, 없으면 아무 말 없이 죽는다.
  if (name.includes('-MT-Release')) score += 8;
  else if (name.includes('-MD-Release')) score += 4;
  else if (name.includes('-MT-MinSizeRel')) score += 3;
  else if (name.includes('-MD-MinSizeRel')) score += 2;
  // mac/linux 는 CRT 토큰이 없다. onnxruntime 판을 이름에 박은 변종보다 기본판을 먼저.
  else if (!name.includes('onnxruntime-')) score += 2;

  return score;
}

export interface VoiceEngineAssetLike {
  name: string;
  browser_download_url: string;
  size?: number;
}

/** 여러 자산 중 가장 나은 것 하나. 동점이면 이름 역순(대개 더 새 것)으로 못 박아 결과를 재현 가능하게. */
export function pickVoiceEngineAsset<T extends VoiceEngineAssetLike>(
  assets: readonly T[],
  platform: PlatformName,
  arch: string,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const asset of assets) {
    const score = scoreVoiceEngineAsset(asset.name, platform, arch);
    if (score === null) continue;
    if (score > bestScore || (score === bestScore && best !== null && asset.name > best.name)) {
      best = asset;
      bestScore = score;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 모델
// ─────────────────────────────────────────────────────────────────────────────

/** 인식기가 요구하는 네 조각. 하나라도 없으면 엔진이 뜨지 않는다. */
export type VoiceModelRole = 'encoder' | 'decoder' | 'joiner' | 'tokens';

export interface VoiceModelFile {
  role: VoiceModelRole;
  /** 저장소 안의 경로 = 디스크에 놓일 파일 이름. */
  file: string;
  /** 카탈로그가 알려 준 바이트 수. 받은 뒤 이 값과 대조한다(반쪽 파일을 성공으로 치지 않기 위해). */
  sizeBytes: number;
}

export interface VoiceModelSource {
  /** 허깅페이스 저장소. */
  repo: string;
  files: readonly VoiceModelFile[];
}

/**
 * 받을 곳 — **두 벌을 든다.**
 *
 * 여기 적힌 것은 NVIDIA `nemotron-3.5-asr-streaming-0.6b`(OpenMDW-1.1)를 sherpa-onnx 가 읽는
 * 모양으로 내보낸 것이다. 원본 저장소는 NVIDIA 것이지만 **그 형식 그대로는 우리 엔진이 못 읽어**
 * 제3자 export 를 받는다. 그런 저장소는 사라질 수 있으므로 앞의 것이 죽으면 뒤의 것으로 간다
 * (§5.19 (D) "박아 두면 그 자산이 사라진 날 설치가 죽는다" 의 같은 계열 대비).
 *
 * ⚠ **`tokens.txt` 를 저장소 사이에서 섞지 마라** — 두 저장소의 tokens 는 크기가 다르다.
 * 한 저장소의 네 파일은 한 벌로만 쓴다.
 */
export const VOICE_MODEL_SOURCES: readonly VoiceModelSource[] = [
  {
    repo: 'apbaxel/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-int8',
    files: [
      { role: 'encoder', file: 'encoder.int8.onnx', sizeBytes: 657_601_403 },
      { role: 'decoder', file: 'decoder.int8.onnx', sizeBytes: 14_978_075 },
      { role: 'joiner', file: 'joiner.int8.onnx', sizeBytes: 9_504_438 },
      { role: 'tokens', file: 'tokens.txt', sizeBytes: 131_440 },
    ],
  },
  {
    repo: 'Masterx/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11',
    files: [
      { role: 'encoder', file: 'encoder.int8.onnx', sizeBytes: 657_601_403 },
      { role: 'decoder', file: 'decoder.int8.onnx', sizeBytes: 14_978_075 },
      { role: 'joiner', file: 'joiner.int8.onnx', sizeBytes: 9_504_438 },
      { role: 'tokens', file: 'tokens.txt', sizeBytes: 144_528 },
    ],
  },
];

/** 모델 전체 크기 — 설치 창이 **받기 전에** 얼마인지 말하기 위한 값. */
export function voiceModelTotalBytes(source: VoiceModelSource): number {
  let total = 0;
  for (const f of source.files) total += f.sizeBytes;
  return total;
}

/** 직링크. `?download=true` 는 허깅페이스가 리다이렉트 대신 본문을 주게 하는 규약(§5.19 (E) 동일). */
export function voiceModelFileUrl(repo: string, file: string): string {
  const parts = file
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/');
  return `https://huggingface.co/${repo}/resolve/main/${parts}?download=true`;
}

/** 디스크에 놓인 이름 — 저장소가 달라도 역할이 같으면 같은 이름이라 엔진 인자가 안 흔들린다. */
export function voiceModelDiskName(role: VoiceModelRole): string {
  if (role === 'tokens') return 'tokens.txt';
  return `${role}.onnx`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 언어 — 이 모델이 무엇을 알아듣는가
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `primary` = 모델 카드의 transcription-ready 19 로케일.
 * `broad`   = broad-coverage 13 로케일(된다, 다만 한 등급 아래).
 * `none`    = 목록에 없다 — **된다고 말하지 않는다**(넘겨짚은 안내가 진짜 원인을 가린다).
 */
export type VoiceAsrLanguageTier = 'primary' | 'broad' | 'none';

const ASR_PRIMARY = new Set(['en', 'es', 'fr', 'it', 'pt', 'nl', 'de', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'vi', 'uk']);
const ASR_BROAD = new Set(['pl', 'sv', 'cs', 'nb', 'da', 'bg', 'fi', 'hr', 'sk', 'zh', 'hu', 'ro', 'et']);

/** UI 로케일(`ko`·`es-419`·`zh-CN` …)이 이 모델에서 어느 등급인지. */
export function voiceAsrLanguageTier(uiLocale: string): VoiceAsrLanguageTier {
  const base = uiLocale.split('-')[0]?.toLowerCase() ?? '';
  if (ASR_PRIMARY.has(base)) return 'primary';
  if (ASR_BROAD.has(base)) return 'broad';
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// 설치 상태
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 설치가 어느 걸음에 있는가.
 * `engine`→`model`→`verifying`→`ready` 가 정상 흐름이고, 중간에 끊으면 `canceled` 다.
 */
export type VoiceAsrInstallStage =
  | 'idle'
  | 'engine'
  | 'extracting'
  | 'model'
  | 'verifying'
  | 'ready'
  | 'canceled'
  | 'error';

/** WS `voice_asr_progress` payload + REST 동기 응답 dual-use(§5.19 `LocalEngineProgress` 와 같은 모양). */
export interface VoiceAsrInstallProgress {
  installId: string;
  stage: VoiceAsrInstallStage;
  /** 지금 받고 있는 것의 이름(자산 파일명 또는 모델 파일명). */
  item?: string;
  receivedBytes: number;
  /** 이번 걸음 전체 크기. 서버가 길이를 안 주면 0 — 그때는 막대 대신 받은 양만 보여 준다. */
  totalBytes: number;
  /** 설치 전체(엔진+모델)에서 이미 끝난 바이트 — 막대 하나로 보여 주기 위한 값. */
  doneBytes: number;
  /** 설치 전체 크기(엔진 자산 크기를 알기 전에는 모델 크기만 잡혀 있다). */
  grandTotalBytes: number;
  /** 사람이 그대로 읽을 실패 사유. */
  error?: string;
}

/** 지금 이 PC 가 받아쓰기를 할 수 있는가 — **플래그가 아니라 디스크의 실물**로 판정한다(§5.19 (B)). */
export interface VoiceAsrState {
  /** 엔진 실행본이 실제로 있는가. */
  engineInstalled: boolean;
  /** 모델 네 조각이 전부, 그리고 크기까지 맞게 있는가. */
  modelInstalled: boolean;
  /** 둘 다 참일 때만 참. 화면은 이 값 하나만 보면 된다. */
  ready: boolean;
  /** 설치돼 있으면 어느 판올림인지(엔진). 모르면 생략. */
  engineVersion?: string;
  /** 모델을 어느 저장소에서 받았는지. */
  modelRepo?: string;
  /** 두 폴더가 차지하는 바이트 — 지울 때 얼마가 도는지 사용자가 알아야 한다. */
  diskBytes: number;
  /** 지금 돌고 있는 설치가 있으면 그 진행 상황. */
  install?: VoiceAsrInstallProgress;
}

/** 막대 하나로 보여 줄 퍼센트(0~100). 총량을 모르면 0 을 돌려 화면이 막대 대신 받은 양을 쓰게 한다. */
export function voiceInstallPercent(p: VoiceAsrInstallProgress): number {
  if (p.stage === 'ready') return 100;
  if (p.grandTotalBytes <= 0) return 0;
  const done = p.doneBytes + p.receivedBytes;
  const pct = Math.floor((done / p.grandTotalBytes) * 100);
  return Math.max(0, Math.min(99, pct));
}

/** 진행 중인가 — 버튼을 잠글지, 창을 닫아도 되는지의 판정 한 곳. */
export function isVoiceInstallRunning(stage: VoiceAsrInstallStage): boolean {
  return stage === 'engine' || stage === 'extracting' || stage === 'model' || stage === 'verifying';
}

// ─────────────────────────────────────────────────────────────────────────────
// 오디오 — 마이크가 무엇이든 16kHz mono PCM16 으로
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 표본율을 16kHz 로 낮춘다.
 *
 * **평균이 아니라 선형 보간**이다 — 평균(박스 필터)은 배수가 아닌 비율(48000/16000=3 은 배수지만
 * 44100/16000=2.75625 는 아니다)에서 창 경계가 표본마다 어긋나 말끝이 뭉개진다. 브라우저가 주는
 * `AudioContext.sampleRate` 는 기기마다 44.1k·48k 로 갈리므로 배수를 가정할 수 없다.
 */
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  const target = VOICE_ASR.SAMPLE_RATE;
  if (inputRate === target || input.length === 0) return input;
  if (inputRate <= 0) return new Float32Array(0);
  const ratio = inputRate / target;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = (input[left] ?? 0) * (1 - frac) + (input[right] ?? 0) * frac;
  }
  return out;
}

/**
 * Float32 표본을 전선에 실을 바이트로.
 *
 * **int16 이 아니라 float32 다** — 엔진의 `OnMessage` 가 바이너리 프레임을 그대로
 * `reinterpret_cast<const float*>` 로 읽는다(2026-09-02 소스 확인). 16비트로 보내면 오류 없이
 * **잡음만 인식된다** — 가장 찾기 어려운 종류의 어긋남이라 여기 적어 둔다.
 * 바이트 순서는 리틀엔디언 native 이고 우리 대상(x64·arm64)은 셋 다 리틀엔디언이다.
 */
export function float32Bytes(input: Float32Array): Uint8Array {
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

// ─────────────────────────────────────────────────────────────────────────────
// 인식 결과
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WS `voice_asr_transcript` payload.
 *
 * **중간과 확정을 한 모양으로 보낸다** — 종전 브라우저 엔진도 `isFinal` 하나로 갈렸고,
 * 화면(`VoiceInputOverlay` = 중간, textarea = 확정)이 그 한 칸만 보고 갈라지므로
 * 두 벌의 메시지를 만들면 화면이 두 곳에서 판정하게 된다(#17-38 ① 과 같은 규율).
 */
export interface VoiceAsrTranscript {
  /** 어느 받아쓰기 세션의 것인가 — 창이 여럿이면 남의 말이 내 입력창에 들어갈 수 있다. */
  sessionId: string;
  text: string;
  /** 참이면 이 토막은 끝났다 → 입력창에 넣는다. 거짓이면 아직 듣는 중 → 위 줄에만 보인다. */
  isFinal: boolean;
}
