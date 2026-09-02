import { describe, expect, it } from 'vitest';
import {
  VOICE_ASR,
  VOICE_MODEL_SOURCES,
  downsampleTo16k,
  float32Bytes,
  isVoiceInstallRunning,
  pickVoiceEngineAsset,
  scoreVoiceEngineAsset,
  voiceAsrLanguageTier,
  voiceEngineArchToken,
  voiceEngineBinName,
  voiceEnginePlatformToken,
  voiceInstallPercent,
  voiceModelDiskName,
  voiceModelFileUrl,
  voiceModelTotalBytes,
  type VoiceAsrInstallProgress,
} from '@vibisual/shared';
import { voiceExtractAttempts } from './voiceAsrService.js';
import { engineEnvFor } from './voiceRecognizerService.js';

/**
 * §5.5 #17-38 ⑫ — 오프라인 받아쓰기 판정 고정.
 *
 * **세 OS 를 Windows 한 대에서 확인하는 유일한 방법**이라 판정은 전부 `platform` 을 인자로
 * 받는다([multiplatform.md](../../../../docs/rules/multiplatform.md)). 자산 이름은 2026-09-02
 * `k2-fsa/sherpa-onnx` v1.13.7 릴리스에서 그대로 따 왔다 — 지어낸 이름으로 고정하면 그 표는
 * 실제 릴리스와 어긋난 채 초록으로 남는다.
 */

// 실제 릴리스 자산 이름(발췌).
const WIN_ASSETS = [
  'sherpa-onnx-v1.13.7-win-x64-shared-MD-Debug.tar.bz2',
  'sherpa-onnx-v1.13.7-win-x64-shared-MD-Release-no-tts.tar.bz2',
  'sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2',
  'sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts.tar.bz2',
  'sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts-lib.tar.bz2',
  'sherpa-onnx-v1.13.7-win-x64-jni.tar.bz2',
  'sherpa-onnx-v1.13.7-cuda-13.x-cudnn-9.x-onnxruntime1.27.1-win-x64-cuda.tar.bz2',
  'sherpa-onnx-streaming-asr-x64-v1.13.7.exe',
];
const MAC_ARM_ASSETS = [
  'sherpa-onnx-v1.13.7-osx-arm64-shared.tar.bz2',
  'sherpa-onnx-v1.13.7-osx-arm64-shared-no-tts.tar.bz2',
  'sherpa-onnx-v1.13.7-osx-arm64-shared-no-tts-lib.tar.bz2',
  'sherpa-onnx-v1.13.7-osx-arm64-static.tar.bz2',
  'sherpa-onnx-v1.13.7-onnxruntime-1.28.0-osx-arm64-shared.tar.bz2',
];
const LINUX_ASSETS = [
  'sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2',
  'sherpa-onnx-v1.13.7-linux-x64-shared-no-tts.tar.bz2',
  'sherpa-onnx-v1.13.7-linux-x64-shared-lib.tar.bz2',
  'sherpa-onnx-v1.13.7-linux-x64-static-no-tts.tar.bz2',
  'sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2',
  'sherpa-onnx-v1.13.7-linux-aarch64-shared-gpu-onnxruntime-1.18.1.tar.bz2',
];

const asAssets = (names: readonly string[]): { name: string; browser_download_url: string }[] =>
  names.map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` }));

describe('엔진 자산 고르기', () => {
  it('OS·아키텍처 토큰은 리눅스 arm 만 aarch64 라고 적는다', () => {
    expect(voiceEnginePlatformToken('win32')).toBe('win');
    expect(voiceEnginePlatformToken('darwin')).toBe('osx');
    expect(voiceEnginePlatformToken('linux')).toBe('linux');
    expect(voiceEnginePlatformToken('aix')).toBeNull();

    expect(voiceEngineArchToken('darwin', 'arm64')).toBe('arm64');
    expect(voiceEngineArchToken('linux', 'arm64')).toBe('aarch64');
    expect(voiceEngineArchToken('win32', 'x64')).toBe('x64');
    expect(voiceEngineArchToken('linux', 'riscv64')).toBeNull();
  });

  it('실행본 이름은 win 만 .exe 다', () => {
    expect(voiceEngineBinName('win32')).toBe('sherpa-onnx-online-websocket-server.exe');
    expect(voiceEngineBinName('darwin')).toBe('sherpa-onnx-online-websocket-server');
    expect(voiceEngineBinName('linux')).toBe('sherpa-onnx-online-websocket-server');
  });

  it('실행본이 없는 자산(-lib)·static·jni·cuda 는 아예 후보가 아니다', () => {
    expect(scoreVoiceEngineAsset('sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts-lib.tar.bz2', 'win32', 'x64')).toBeNull();
    expect(scoreVoiceEngineAsset('sherpa-onnx-v1.13.7-linux-x64-static-no-tts.tar.bz2', 'linux', 'x64')).toBeNull();
    expect(scoreVoiceEngineAsset('sherpa-onnx-v1.13.7-win-x64-jni.tar.bz2', 'win32', 'x64')).toBeNull();
    expect(
      scoreVoiceEngineAsset('sherpa-onnx-v1.13.7-cuda-13.x-cudnn-9.x-onnxruntime1.27.1-win-x64-cuda.tar.bz2', 'win32', 'x64'),
    ).toBeNull();
    // 압축이 아닌 것(설치 실행본)도 아니다.
    expect(scoreVoiceEngineAsset('sherpa-onnx-streaming-asr-x64-v1.13.7.exe', 'win32', 'x64')).toBeNull();
  });

  it('Windows 는 MT(정적 CRT) + no-tts 를 고른다 — MD 는 재배포 런타임이 없으면 안 뜬다', () => {
    const picked = pickVoiceEngineAsset(asAssets(WIN_ASSETS), 'win32', 'x64');
    expect(picked?.name).toBe('sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts.tar.bz2');
  });

  it('mac arm 은 기본 판 no-tts 를 고른다 — onnxruntime 판을 박은 변종보다 먼저', () => {
    const picked = pickVoiceEngineAsset(asAssets(MAC_ARM_ASSETS), 'darwin', 'arm64');
    expect(picked?.name).toBe('sherpa-onnx-v1.13.7-osx-arm64-shared-no-tts.tar.bz2');
  });

  it('linux x64 는 no-tts, linux arm 은 aarch64 cpu 판을 고른다', () => {
    expect(pickVoiceEngineAsset(asAssets(LINUX_ASSETS), 'linux', 'x64')?.name).toBe(
      'sherpa-onnx-v1.13.7-linux-x64-shared-no-tts.tar.bz2',
    );
    expect(pickVoiceEngineAsset(asAssets(LINUX_ASSETS), 'linux', 'arm64')?.name).toBe(
      'sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu.tar.bz2',
    );
  });

  it('맞는 자산이 없으면 null — 엉뚱한 것을 집어 오지 않는다', () => {
    expect(pickVoiceEngineAsset(asAssets(WIN_ASSETS), 'darwin', 'arm64')).toBeNull();
    expect(pickVoiceEngineAsset([], 'win32', 'x64')).toBeNull();
  });
});

describe('모델', () => {
  it('저장소마다 네 조각을 전부 든다', () => {
    expect(VOICE_MODEL_SOURCES.length).toBeGreaterThanOrEqual(2);
    for (const src of VOICE_MODEL_SOURCES) {
      const roles = src.files.map((f) => f.role).sort();
      expect(roles).toEqual(['decoder', 'encoder', 'joiner', 'tokens']);
      for (const f of src.files) expect(f.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('전체 크기는 600MB 대다 — 화면이 받기 전에 말하는 값', () => {
    const first = VOICE_MODEL_SOURCES[0];
    expect(first).toBeDefined();
    if (!first) return;
    const total = voiceModelTotalBytes(first);
    expect(total).toBeGreaterThan(600_000_000);
    expect(total).toBeLessThan(800_000_000);
  });

  it('디스크 이름은 역할이 정한다 — 저장소가 달라도 엔진 인자가 안 흔들린다', () => {
    expect(voiceModelDiskName('encoder')).toBe('encoder.onnx');
    expect(voiceModelDiskName('tokens')).toBe('tokens.txt');
  });

  it('직링크는 resolve/main + download=true', () => {
    expect(voiceModelFileUrl('a/b', 'encoder.int8.onnx')).toBe(
      'https://huggingface.co/a/b/resolve/main/encoder.int8.onnx?download=true',
    );
  });
});

describe('언어 등급', () => {
  it('우리 12 로케일 중 인도네시아어만 목록에 없다', () => {
    const primary = ['ko', 'en', 'ja', 'de', 'es', 'es-419', 'fr', 'hi', 'it', 'pt-BR'];
    for (const loc of primary) expect(voiceAsrLanguageTier(loc)).toBe('primary');
    expect(voiceAsrLanguageTier('zh-CN')).toBe('broad');
    expect(voiceAsrLanguageTier('id')).toBe('none');
  });

  it('모르는 로케일은 된다고 말하지 않는다', () => {
    expect(voiceAsrLanguageTier('xx-YY')).toBe('none');
    expect(voiceAsrLanguageTier('')).toBe('none');
  });
});

describe('설치 진행률', () => {
  const base: VoiceAsrInstallProgress = {
    installId: 'i',
    stage: 'model',
    receivedBytes: 0,
    totalBytes: 0,
    doneBytes: 0,
    grandTotalBytes: 0,
  };

  it('총량을 모르면 0 — 화면이 막대 대신 받은 양을 쓰게 한다', () => {
    expect(voiceInstallPercent({ ...base, receivedBytes: 100 })).toBe(0);
  });

  it('두 걸음을 합쳐 하나의 막대로 센다', () => {
    expect(voiceInstallPercent({ ...base, doneBytes: 25, receivedBytes: 25, grandTotalBytes: 100 })).toBe(50);
  });

  it('끝나기 전에는 100 을 찍지 않는다 — 다 찼는데 창이 남아 있으면 멈춘 것으로 읽힌다', () => {
    expect(voiceInstallPercent({ ...base, doneBytes: 100, receivedBytes: 0, grandTotalBytes: 100 })).toBe(99);
    expect(voiceInstallPercent({ ...base, stage: 'ready', grandTotalBytes: 100 })).toBe(100);
  });

  it('도는 중인 걸음만 참이다', () => {
    expect(isVoiceInstallRunning('engine')).toBe(true);
    expect(isVoiceInstallRunning('extracting')).toBe(true);
    expect(isVoiceInstallRunning('model')).toBe(true);
    expect(isVoiceInstallRunning('verifying')).toBe(true);
    expect(isVoiceInstallRunning('ready')).toBe(false);
    expect(isVoiceInstallRunning('canceled')).toBe(false);
    expect(isVoiceInstallRunning('error')).toBe(false);
    expect(isVoiceInstallRunning('idle')).toBe(false);
  });
});

describe('오디오 변환', () => {
  it('같은 표본율이면 그대로 돌려준다(불필요한 복사 ❌)', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(input, VOICE_ASR.SAMPLE_RATE)).toBe(input);
  });

  it('48kHz → 16kHz 는 길이가 1/3', () => {
    const input = new Float32Array(4800);
    expect(downsampleTo16k(input, 48_000).length).toBe(1600);
  });

  it('배수가 아닌 44.1kHz 에서도 길이가 비율을 따른다', () => {
    const input = new Float32Array(4410);
    // 4410 / (44100/16000) = 1600
    expect(downsampleTo16k(input, 44_100).length).toBe(1600);
  });

  it('선형 보간이라 첫 표본은 원본 그대로다', () => {
    const input = new Float32Array([1, 0, 0, 0, 0, 0]);
    const out = downsampleTo16k(input, 48_000);
    expect(out[0]).toBeCloseTo(1, 6);
  });

  it('표본율이 0 이하면 빈 버퍼 — 나눗셈이 무한대가 되지 않게', () => {
    expect(downsampleTo16k(new Float32Array([1, 2]), 0).length).toBe(0);
  });

  it('전선에 싣는 것은 float32 바이트다(int16 ❌ — 보내면 잡음만 인식된다)', () => {
    const input = new Float32Array([1, -1]);
    const bytes = float32Bytes(input);
    expect(bytes.byteLength).toBe(8);
    expect(new Float32Array(bytes.buffer, bytes.byteOffset, 2)[0]).toBe(1);
  });
});

describe('압축 풀기 후보', () => {
  it('Windows 는 System32 bsdtar 를 절대 경로로 먼저 쓴다(PATH 의 GNU tar 는 C: 를 호스트로 읽는다)', () => {
    const attempts = voiceExtractAttempts('a.tar.bz2', 'dest', 'win32', 'S:/sys/tar.exe');
    expect(attempts[0]?.cmd).toBe('S:/sys/tar.exe');
    expect(attempts[1]?.cmd).toBe('tar');
  });

  it('mac·linux 는 tar 한 벌 — -xf 가 bzip2 를 스스로 가린다', () => {
    for (const p of ['darwin', 'linux'] as const) {
      const attempts = voiceExtractAttempts('a.tar.bz2', 'dest', p);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.cmd).toBe('tar');
      expect(attempts[0]?.args).toEqual(['-xf', 'a.tar.bz2', '-C', 'dest']);
    }
  });
});

describe('엔진 환경변수', () => {
  it('Windows 는 손대지 않는다 — DLL 은 실행본 옆에서 찾는다', () => {
    const env = engineEnvFor({ PATH: 'p' }, ['/lib'], 'win32');
    expect(env['LD_LIBRARY_PATH']).toBeUndefined();
    expect(env['DYLD_LIBRARY_PATH']).toBeUndefined();
  });

  it('mac 은 DYLD_, linux 는 LD_ 이고 기존 값 앞에 붙는다', () => {
    const mac = engineEnvFor({ DYLD_LIBRARY_PATH: '/old' }, ['/a', '/b'], 'darwin');
    expect(mac['DYLD_LIBRARY_PATH']).toBe('/a:/b:/old');
    const linux = engineEnvFor({}, ['/a'], 'linux');
    expect(linux['LD_LIBRARY_PATH']).toBe('/a');
  });

  it('줄 디렉터리가 없으면 그대로 — 빈 경로를 넣어 링커를 헷갈리게 하지 않는다', () => {
    const env = engineEnvFor({ LD_LIBRARY_PATH: '/old' }, [], 'linux');
    expect(env['LD_LIBRARY_PATH']).toBe('/old');
  });
});
